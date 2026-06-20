// ═══════════════════════════════════════════════════════════
//  AC INSTALL — ใบงานติดตั้งแอร์
//  Phase 41: line items + receipt + LINE
//  Phase 43: ตัดสต็อกจากคลังในรถ (mobile) + auto-transfer จากบ้านถ้าไม่พอ
//  Phase 88.12: + ปิดงาน/แนบสลิป/AI verify (workflow ช่างส่ง→admin ยืนยัน)
// ═══════════════════════════════════════════════════════════

import { postJournalForServiceJob } from "./accounting/auto_post.js";
import { aggregateNeedByKey } from "./stock_precheck.js";
import { normalizeServiceJobStatus, serviceJobNoteWithReviewMarker } from "./service_status.js";
import { applyDraftFields, bindServiceDraft, clearServiceDraft, loadServiceDraft } from "./service_drafts.js";
import { makePickerTouchGuard, renderPickerCart, updateCartBadges } from "./picker_cart.js";

// Module-level state
let _items = [];           // [{product_id, name, qty, unit_price, line_total, warehouse_id, warehouse_name}]
const _showPicker = false;
const _pickerSearch = "";
let _lastSavedJob = null;  // ถ้ามีค่า → form อยู่ใน read-only (lock items, edit ได้แค่ note)

const escHtml = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const AC_DRAFT_KEY = "ac_install";
const AC_DRAFT_FIELDS = [
  ["#acName", "name"],
  ["#acPhone", "phone"],
  ["#acAddress", "address"],
  ["#acProduct", "product"],
  ["#acQty", "qty"],
  ["#acLabor", "labor"],
  ["#acDiscount", "discount"],
  ["#acNote", "note"],
  ["#acStatusSel", "status"],
  ["#acPaymentMethod", "paymentMethod"]
];

// ═══════════════════════════════════════════════════════════
//  Phase 43 — Mobile warehouse helpers
// ═══════════════════════════════════════════════════════════

// คืน warehouses ที่ is_mobile = true (รถ)
function _getMobileWarehouses(state) {
  return (state.warehouses || []).filter(w => w.is_mobile === true);
}

// คืน home warehouse แรกที่ active (บ้าน — สำหรับ auto-transfer source)
function _getHomeWarehouse(state) {
  // Priority: ชื่อ "บ้าน" > !is_mobile + active แรก
  const wh = state.warehouses || [];
  return wh.find(w => (w.name || "").includes("บ้าน")) ||
         wh.find(w => w.is_mobile !== true) ||
         null;
}

// คืน array ของ stock per mobile warehouse: [{ warehouse_id, warehouse_name, stock }]
function _getMobileStocks(p, state) {
  const mobileWh = _getMobileWarehouses(state);
  return mobileWh
    .map(w => {
      const ws = (state.warehouseStock || []).find(s =>
        String(s.product_id) === String(p.id) && String(s.warehouse_id) === String(w.id)
      );
      return { warehouse_id: w.id, warehouse_name: w.name, stock: Number(ws?.stock || 0) };
    })
    .filter(s => s.stock > 0);
}

// คืน stock ในบ้าน (home) — เผื่อ auto-transfer
function _getHomeStock(p, state) {
  const home = _getHomeWarehouse(state);
  if (!home) return null;
  const ws = (state.warehouseStock || []).find(s =>
    String(s.product_id) === String(p.id) && String(s.warehouse_id) === String(home.id)
  );
  return { warehouse_id: home.id, warehouse_name: home.name, stock: Number(ws?.stock || 0) };
}

// คืน stock รวมทั้งหมด (mobile + home + legacy) — สำหรับ picker filter "มีของในระบบมั้ย"
function _getTotalStock(p, state) {
  return Number(p.stock || 0) +
    (state.warehouseStock || [])
      .filter(w => String(w.product_id) === String(p.id))
      .reduce((s, w) => s + Number(w.stock || 0), 0);
}

export function renderAcInstallPage(ctx) {
  const { state, money, showToast } = ctx;
  const container = document.getElementById("page-ac_install");
  if (!container) return;
  const draft = loadServiceDraft(AC_DRAFT_KEY);
  if (!_lastSavedJob && Array.isArray(draft?.items)) {
    _items = draft.items.map(it => ({ ...it }));
  }

  // ★ Phase 40 — สินค้าแอร์ในสต็อก (รุ่นหลัก)
  // Phase 43: filter เฉพาะที่มีใน mobile (รถ) — ถ้าไม่มีในรถเลย ก็ขึ้นใน dropdown ได้ ถ้ามีในบ้าน (auto-transfer)
  const acProducts = (state.products || []).filter(p => {
    const name = (p.name || p.model || "").toLowerCase();
    const category = (p.category || "").toLowerCase();
    const matchesAc = (
      category.includes("ปรับอากาศ") ||
      category.includes("แอร์") ||
      category.includes("air") ||
      name.includes("แอร์") ||
      name.includes("air") ||
      (parseInt(p.btu) > 0)
    );
    if (!matchesAc) return false;
    // มีในรถ หรือ มีในบ้าน (เผื่อ auto-transfer)
    const mobileTotal = _getMobileStocks(p, state).reduce((s, x) => s + x.stock, 0);
    const homeStock = _getHomeStock(p, state)?.stock || 0;
    return (mobileTotal + homeStock) > 0;
  });

  const productOptions = acProducts.map(p => {
    const mobileTotal = _getMobileStocks(p, state).reduce((s, x) => s + x.stock, 0);
    const homeStock = _getHomeStock(p, state)?.stock || 0;
    const btu = parseInt(p.btu || 0);
    const btuLabel = btu > 0 ? `${btu.toLocaleString()} BTU — ` : "";
    const stockTag = mobileTotal > 0
      ? `🚐 รถ:${mobileTotal}${homeStock > 0 ? ` 📦 บ้าน:${homeStock}` : ""}`
      : `📦 บ้าน:${homeStock} (ต้องโอนขึ้นรถ)`;
    return `<option value="${p.id}" data-price="${p.price_install || p.price || 0}" data-btu="${p.btu || 0}">${escHtml(p.name || p.model)} — ${btuLabel}${money(p.price_install || p.price || 0)} (${stockTag})</option>`;
  }).join("");

  container.innerHTML = `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <h3 style="color:var(--primary2);margin-bottom:4px">🏗️ ใบงานติดตั้งแอร์</h3>
          <p class="sku" style="margin:0">เลือกรุ่นแอร์ + เพิ่มอุปกรณ์จากสต็อก + คำนวณราคา</p>
          <button id="acAiBtn" type="button" aria-label="AI ช่วยกรอกใบงานนี้"
            style="margin-top:10px;display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border:none;border-radius:12px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer">🤖 AI ช่วยกรอกใบงานนี้</button>
        </div>
        <button id="acTransferBtn" class="btn light" style="font-size:12px;padding:8px 12px;background:#dbeafe;color:#1e40af;border:1px solid #93c5fd;font-weight:700;white-space:nowrap" title="โอนสต็อกจากบ้านขึ้นรถก่อนเริ่มงาน">🔄 โอนสต็อก บ้าน→รถ</button>
      </div>
    </div>

    <!-- ข้อมูลลูกค้า -->
    <div class="panel">
      <div class="set-section-title">👤 ข้อมูลลูกค้า</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
        <div>
          <label class="set-field-label">ชื่อลูกค้า</label>
          <input type="text" id="acName" placeholder="ชื่อ-นามสกุล" />
        </div>
        <div>
          <label class="set-field-label">เบอร์โทร</label>
          <input type="tel" id="acPhone" placeholder="08X-XXXXXXX" />
        </div>
      </div>
      <label class="set-field-label" style="margin-top:8px">ที่อยู่ติดตั้ง</label>
      <textarea id="acAddress" rows="2" placeholder="บ้านเลขที่ หมู่ ตำบล อำเภอ จังหวัด" style="width:100%;border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit;resize:vertical"></textarea>
    </div>

    <!-- เลือกรุ่นแอร์ -->
    <div class="panel">
      <div class="set-section-title">❄️ เลือกรุ่นแอร์</div>
      ${acProducts.length > 0
        ? `<select id="acProduct"><option value="">-- เลือกรุ่น --</option>${productOptions}</select>`
        : `<div class="sku" style="text-align:center;padding:12px;color:#92400e;background:#fef3c7;border-radius:10px">⚠️ ไม่มีสินค้าแอร์ที่มีสต็อก — เพิ่มสินค้า/รับเข้าคลังก่อน</div>`
      }
      <div style="margin-top:10px">
        <label class="set-field-label">จำนวน (เครื่อง)</label>
        <input type="number" id="acQty" value="1" min="1" max="10" />
      </div>
    </div>

    <!-- ★ Phase 41: อุปกรณ์เพิ่มเติม (line items จากสต็อก) -->
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="set-section-title" style="margin:0">🔧 อุปกรณ์เพิ่มเติม (จากสต็อก)</div>
        <button id="acAddItemBtn" class="btn primary" style="font-size:12px;padding:6px 12px">+ เพิ่มอุปกรณ์</button>
      </div>
      <div id="acItemsList"></div>
      <div style="font-size:11px;color:#94a3b8;margin-top:6px">💡 ค่าท่อทองแดง / ขาตั้ง / สายไฟ — เพิ่มเป็นอุปกรณ์จากสต็อก หรือสร้างสินค้าหมวด "อุปกรณ์งานติดตั้งแอร์" ก่อน</div>
    </div>

    <!-- ค่าแรง + ส่วนลด -->
    <div class="panel">
      <div class="set-section-title">💰 ค่าแรง / ส่วนลด</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
        <div>
          <label class="set-field-label">ค่าแรงติดตั้ง (฿)</label>
          <input type="number" id="acLabor" value="0" min="0" step="100" />
        </div>
        <div>
          <label class="set-field-label">ส่วนลด (฿)</label>
          <input type="number" id="acDiscount" value="0" min="0" step="100" />
        </div>
      </div>
      <label class="set-field-label" style="margin-top:10px">หมายเหตุ</label>
      <input type="text" id="acNote" placeholder="เช่น วันนัดติดตั้ง, รายละเอียดเพิ่มเติม..." />
    </div>

    <!-- 🔚 ปิดงาน + แนบสลิป + AI verify (Phase 88.12) -->
    <div class="panel" style="border:2px solid #fef3c7;background:#fffbeb">
      <div class="set-section-title" style="color:#78350f">🔚 ปิดงาน (กรณีงานเสร็จ + รับเงินแล้ว)</div>
      <div style="font-size:11px;color:#92400e;margin-bottom:10px;line-height:1.6">
        💡 ช่าง — เลือก <b>"📨 รออนุมัติ"</b> + แนบสลิป → ส่งให้แอดมินยืนยัน<br>
        แอดมิน — เลือก <b>"ส่งมอบแล้ว"</b> → ระบบลงรายได้อัตโนมัติ ✨
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:10px">
        <div>
          <label class="set-field-label">สถานะงาน</label>
          <select id="acStatusSel" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;font:inherit;background:#fff">
            <option value="pending">⏳ รอดำเนินการ</option>
            <option value="in_progress">🔄 กำลังดำเนินการ</option>
            <option value="done">✅ เสร็จแล้ว</option>
            <option value="pending_review">📨 รออนุมัติ (ช่างส่ง — รอแอดมิน)</option>
          </select>
          <!-- Phase 88.15: ลบ delivered/closed ออก — admin only ใน drawer ใบรับงาน -->
        </div>
        <div>
          <label class="set-field-label">วิธีรับเงิน</label>
          <select id="acPaymentMethod" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;font:inherit;background:#fff">
            <option value="">— ยังไม่ระบุ —</option>
            <option value="cash">💵 เงินสด → Dr 1110</option>
            <option value="transfer">🏦 โอน/QR → Dr 1130</option>
          </select>
        </div>
      </div>
      <label class="set-field-label" style="margin-top:6px">📷 แนบสลิปรับเงิน (รูป — ถ้ามี)</label>
      <div id="acSlipPreview" style="margin-top:6px"></div>
      <input type="file" id="acSlipFile" accept="image/*" capture="environment" style="display:none" />
      <input type="file" id="acSlipGalleryFile" accept="image/*" style="display:none" />
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        <button type="button" id="acSlipCameraBtn" class="btn light" style="font-size:12px;padding:8px 14px">📷 ถ่ายรูป</button>
        <button type="button" id="acSlipGalleryBtn" class="btn light" style="font-size:12px;padding:8px 14px">🖼️ แกลลอรี่</button>
        <button type="button" id="acSlipVerifyBtn" class="btn light" style="font-size:12px;padding:8px 14px;display:none">🤖 ตรวจ AI</button>
      </div>
      <div id="acSlipVerifyResult" style="margin-top:8px"></div>
    </div>

    <!-- สรุปราคา -->
    <div id="acPriceSummary" class="panel" style="text-align:center">
      <div class="sku">ราคารวมทั้งหมด</div>
      <div style="font-size:36px;font-weight:900;color:var(--primary2)">฿ 0</div>
    </div>

    <button id="acSaveBtn" class="set-save-btn">💾 บันทึกใบงานติดตั้ง</button>
    <div id="acStatus" class="hidden panel mt16"></div>
    <div id="acAfterSave"></div>
  `;

  applyDraftFields(container, draft, AC_DRAFT_FIELDS);
  // Render initial items list
  _renderItemsList(container, money);
  const saveDraftNow = bindServiceDraft(container, AC_DRAFT_KEY, AC_DRAFT_FIELDS, () => ({ items: _items }));

  // ★ Phase 88.12: Slip upload + AI verify (port จาก service_form.js)
  let _slipUrl = "";
  container.querySelector("#acAiBtn")?.addEventListener("click", () => window.BoonsookAI?.open());

  const slipCameraEl  = container.querySelector("#acSlipFile");
  const slipGalleryEl = container.querySelector("#acSlipGalleryFile");
  const slipCameraBtn = container.querySelector("#acSlipCameraBtn");
  const slipGalleryBtn= container.querySelector("#acSlipGalleryBtn");
  const slipVerifyBtn = container.querySelector("#acSlipVerifyBtn");
  const slipPreview   = container.querySelector("#acSlipPreview");
  const slipResult    = container.querySelector("#acSlipVerifyResult");
  slipCameraBtn?.addEventListener("click", () => slipCameraEl?.click());
  slipGalleryBtn?.addEventListener("click", () => slipGalleryEl?.click());

  const _verifyAcSlip = async (dataUrl) => {
    if (!slipResult) return;
    // ★ Phase 92.66: /api/verify-slip อยู่ใน REQUIRE_AUTH_ENDPOINTS — ต้องแนบ Supabase JWT ของ staff ที่ login
    //   (anonKey เป็น sb_publishable_... ไม่ใช่ JWT → verifyAuthToken reject = 401). ไม่มี token/หมดอายุ → ขอ login ใหม่
    const _slipToken = window._sbAccessToken;
    const _slipAuthErrHtml = `<div style="padding:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:12px">🔒 ต้องเข้าสู่ระบบก่อนตรวจสลิป — เซสชันหมดอายุหรือยังไม่ได้ล็อกอิน กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง</div>`;
    if (!_slipToken) { slipResult.innerHTML = _slipAuthErrHtml; return; }
    slipResult.innerHTML = `<div style="padding:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;color:#1e40af;font-size:12px">🤖 AI กำลังตรวจสลิป...</div>`;
    const expectedAmount = Number(container.querySelector("#acPriceSummary")?.textContent?.match(/[\d,]+/)?.[0]?.replace(/,/g,"") || 0);
    const expectedRecipient = (window.state?.profile?.shop_name || window.state?.storeInfo?.name || "บุญสุข").trim();
    try {
      const r = await fetch("/api/verify-slip", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + _slipToken }, body: JSON.stringify({ image: dataUrl, expected_amount: expectedAmount, expected_recipient: expectedRecipient }) });
      // 401 = token หมดอายุ/ถูกเพิกถอนระหว่างทาง → ขอ login ใหม่ แทน error กว้าง ๆ
      // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L1 user-event (auth re-login — last-wins UI acceptable)
      if (r.status === 401) { slipResult.innerHTML = _slipAuthErrHtml; return; }
      const j = await r.json();
      // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L1 user-event (slip-verify button — last-wins UI acceptable)
      if (!j.ok) { slipResult.innerHTML = `<div style="padding:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:12px">❌ ${escHtml(j.error || "verify fail")}</div>`; return; }
      const d = j.data || {}, v = j.verification || {};
      const isSafe = v.is_safe === true;
      const wHtml = (v.warnings || []).map(w => `<div style="color:#b91c1c;font-size:11px">${escHtml(w)}</div>`).join("");
      const note = d.tampering_note || (d.tampering_signs?.[0]) || "";
      // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L1 user-event (slip-verify button — last-wins UI acceptable)
      slipResult.innerHTML = `
        <div style="padding:10px;background:${isSafe?'#f0fdf4':'#fffbeb'};border:1px solid ${isSafe?'#86efac':'#fde68a'};border-radius:8px;font-size:12px">
          <div style="font-weight:700;color:${isSafe?'#15803d':'#92400e'};margin-bottom:6px">${isSafe?'✅ ผ่านการตรวจสอบ':'⚠️ ต้องตรวจเพิ่มเติม'}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;color:#0f172a">
            <div><b>ผู้โอน:</b> ${escHtml(d.sender_name||'-')}</div>
            <div><b>ผู้รับ:</b> ${escHtml(d.recipient_name||'-')}</div>
            <div><b>ยอด:</b> ${d.amount?Number(d.amount).toLocaleString():'-'}</div>
            <div><b>วันที่:</b> ${escHtml(d.datetime||'-')}</div>
          </div>
          <div style="margin-top:6px;font-size:11px;color:#64748b">Confidence: ${d.confidence||'?'}/100 · Tampering: ${d.tampering_score||0}/100</div>
          ${wHtml}
          ${note?`<div style="font-size:10px;color:#92400e;margin-top:4px">• ${escHtml(note)}</div>`:''}
        </div>`;
    // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L1 user-event (slip-verify catch — last-wins UI)
    } catch(e) { slipResult.innerHTML = `<div style="color:#dc2626;font-size:12px;padding:8px">❌ ${escHtml(e.message)}</div>`; }
  };

  slipVerifyBtn?.addEventListener("click", async () => {
    if (!_slipUrl) return;
    try { const r = await fetch(_slipUrl); const blob = await r.blob(); const du = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); }); await _verifyAcSlip(du); }
    catch(e) { if (slipResult) slipResult.innerHTML = `<div style="color:#dc2626;font-size:12px">❌ ${escHtml(e.message)}</div>`; }
  });

  const _onSlipPick = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      slipPreview.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:8px;background:#fff;border:1px solid #e2e8f0;border-radius:10px"><img src="${ev.target.result}" style="width:60px;height:60px;object-fit:cover;border-radius:6px" /><div style="flex:1"><div id="acSlipStatus" style="color:#0284c7;font-size:12px;font-weight:600">⏳ กำลังอัปโหลด...</div><div style="font-size:11px;color:#64748b">${escHtml(f.name)}</div></div></div>`;
    };
    reader.readAsDataURL(f);
    try {
      const cfg = window.SUPABASE_CONFIG;
      const token = window._sbAccessToken || cfg.anonKey;
      const ts = Date.now();
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
      const filePath = `service-slips/ac_${ts}_${Math.random().toString(36).slice(2,8)}.${ext}`;
      const upRes = await fetch(`${cfg.url}/storage/v1/object/proofs/${filePath}`, { method: "POST", headers: { "apikey": cfg.anonKey, "Authorization": `Bearer ${token}`, "Content-Type": f.type || "image/jpeg", "x-upsert": "true" }, body: f });
      if (!upRes.ok) throw new Error("HTTP " + upRes.status);
      _slipUrl = `${cfg.url}/storage/v1/object/public/proofs/${filePath}`;
      const s = container.querySelector("#acSlipStatus");
      if (s) { s.textContent = "✅ อัปโหลดสำเร็จ"; s.style.color = "#059669"; }
      if (slipVerifyBtn) slipVerifyBtn.style.display = "inline-block";
      const pm = container.querySelector("#acPaymentMethod")?.value || "";
      if (/transfer|qr/.test(pm)) {
        const du = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
        await _verifyAcSlip(du);
      }
    } catch(err) {
      const s = container.querySelector("#acSlipStatus");
      if (s) { s.textContent = "⚠️ อัปโหลดล้มเหลว"; s.style.color = "#dc2626"; }
    }
  };
  slipCameraEl?.addEventListener("change", _onSlipPick);
  slipGalleryEl?.addEventListener("change", _onSlipPick);

  // Expose for save handler ใน same closure
  container._getAcSlipUrl = () => _slipUrl;

  function updateTotal() {
    const sel = container.querySelector("#acProduct");
    const productPrice = sel ? parseFloat(sel.selectedOptions[0]?.dataset?.price || 0) : 0;
    const qty = parseInt(container.querySelector("#acQty").value) || 1;
    const labor = parseFloat(container.querySelector("#acLabor").value) || 0;
    const discount = parseFloat(container.querySelector("#acDiscount").value) || 0;

    const acPrice = productPrice * qty;
    const itemsTotal = _items.reduce((s, it) => s + Number(it.line_total || 0), 0);
    const net = Math.max(0, acPrice + itemsTotal + labor - discount);

    container.querySelector("#acPriceSummary").innerHTML = `
      <div class="sku">ราคารวมทั้งหมด</div>
      <div style="font-size:36px;font-weight:900;color:var(--primary2)">${money(net)}</div>
      <div class="sku" style="margin-top:4px">
        ราคาแอร์ ${money(acPrice)}${itemsTotal > 0 ? ` + อุปกรณ์ ${money(itemsTotal)}` : ""}${labor > 0 ? ` + ค่าแรง ${money(labor)}` : ""}${discount > 0 ? ` − ส่วนลด ${money(discount)}` : ""}
      </div>
    `;
  }

  // Bind all inputs
  container.querySelectorAll("input[type=number], select").forEach(el => el.addEventListener("input", updateTotal));
  container.querySelector("#acProduct")?.addEventListener("change", updateTotal);

  // ★ Phase 41 — เพิ่ม/แก้ไข/ลบอุปกรณ์
  container.querySelector("#acAddItemBtn")?.addEventListener("click", () => _openItemPicker(ctx, container, updateTotal, saveDraftNow));
  _bindItemListEvents(container, updateTotal, money);

  // ★ Phase 45.6 — โอนสต็อก บ้าน→รถ inline
  container.querySelector("#acTransferBtn")?.addEventListener("click", () => _openTransferModal(ctx));

  // Save
  container.querySelector("#acSaveBtn").addEventListener("click", async (e) => {
    const saveBtn = e.currentTarget;
    if (saveBtn.disabled) return;
    const name = container.querySelector("#acName").value.trim();
    if (!name) return showToast("กรอกชื่อลูกค้า");

    saveBtn.disabled = true;
    const origText = saveBtn.textContent;
    saveBtn.textContent = "⏳ กำลังบันทึก...";

    const sel = container.querySelector("#acProduct");
    const productName = sel?.selectedOptions[0]?.textContent || "ติดตั้งแอร์";
    const productId = sel?.value || null;
    const qty = parseInt(container.querySelector("#acQty").value) || 1;
    const productPrice = sel ? parseFloat(sel.selectedOptions[0]?.dataset?.price || 0) : 0;
    const labor = parseFloat(container.querySelector("#acLabor").value) || 0;
    const discount = parseFloat(container.querySelector("#acDiscount").value) || 0;
    const itemsTotal = _items.reduce((s, it) => s + Number(it.line_total || 0), 0);
    const net = Math.max(0, (productPrice * qty) + itemsTotal + labor - discount);

    const statusEl = container.querySelector("#acStatus");
    statusEl.classList.remove("hidden");
    statusEl.textContent = "📋 กำลังตรวจสอบข้อมูล...";

    // ★ Phase 83.3: Timeout safety — ถ้าค้างเกิน 25 วิ → unblock UI
    const _saveTimeout = setTimeout(() => {
      if (saveBtn.disabled) {
        statusEl.innerHTML = '<div style="color:#dc2626">⚠️ บันทึกใช้เวลานานเกิน 25 วินาที — เน็ตช้า/server timeout — กรุณาลองอีกครั้ง</div>';
        saveBtn.disabled = false;
        saveBtn.textContent = origText;
      }
    }, 25000);

    try {
      const cfg = window.SUPABASE_CONFIG;
      const token = (await state.supabase.auth.getSession())?.data?.session?.access_token || cfg.anonKey;

      // items_json: รวมทั้งแอร์หลัก + อุปกรณ์
      // Phase 43: main air → auto-pick mobile (รถ) เสมอ — ถ้าไม่มีในรถ → pick mobile ตัวแรก ที่ระบบมี (force transfer flow)
      const mobileWhList = _getMobileWarehouses(state);
      const fullItems = [];
      if (productId && productPrice > 0) {
        const mainProd = (state.products || []).find(p => String(p.id) === String(productId));
        let mainWh = null;
        if (mainProd) {
          const mobileStocks = _getMobileStocks(mainProd, state);
          // Priority: mobile ที่พอ → mobile ที่มีบ้าง → mobile แรกในระบบ (force transfer)
          mainWh = mobileStocks.find(s => s.stock >= qty)
                || mobileStocks[0]
                || (mobileWhList[0] ? { warehouse_id: mobileWhList[0].id, warehouse_name: mobileWhList[0].name, stock: 0 } : null);
        }
        fullItems.push({
          product_id: Number(productId),
          name: productName.replace(/^[^—]+— /, "").trim() || productName,
          qty,
          unit_price: productPrice,
          line_total: productPrice * qty,
          warehouse_id: mainWh?.warehouse_id || null,
          warehouse_name: mainWh?.warehouse_name || null,
          is_main: true
        });
      }
      // Phase 43: items ที่ user pick "บ้าน" ใน picker (เพราะรถไม่มี) → re-pick เป็น mobile (force transfer)
      _items.forEach(it => {
        const homeWhTmp = _getHomeWarehouse(state);
        const isPickedHome = homeWhTmp && String(it.warehouse_id) === String(homeWhTmp.id);
        if (isPickedHome && mobileWhList.length > 0) {
          // re-pick เป็น mobile แรก — save logic จะ trigger auto-transfer
          const firstMobile = mobileWhList[0];
          fullItems.push({
            ...it,
            warehouse_id: firstMobile.id,
            warehouse_name: firstMobile.name,
            is_main: false
          });
        } else {
          fullItems.push({ ...it, is_main: false });
        }
      });

      // ★ Phase 43: เช็คก่อน save — ของในรถพอมั้ย? ถ้าไม่พอ + บ้านมี → confirm auto-transfer
      const transfersNeeded = []; // [{productId, productName, fromWh, toWh, qty}]
      const homeWh = _getHomeWarehouse(state);
      // Phase 372: รวม qty ต่อ (product+warehouse) — กันสินค้าเดียวกันหลาย line รวมเกินสต็อก (เดิมเช็คทีละ line)
      const _needByKey = aggregateNeedByKey(fullItems);
      const _checkedKeys = new Set();
      for (const it of fullItems) {
        if (!it.warehouse_id || !it.product_id) continue; // ไม่ตัดสต็อก (เช่น service)
        const prod = (state.products || []).find(p => String(p.id) === String(it.product_id));
        if (!prod) continue;
        const _aggKey = `${it.product_id}|${it.warehouse_id}`;
        if (_checkedKeys.has(_aggKey)) continue; // เช็ค/โอน ครั้งเดียวต่อ key (ใช้ยอดรวม)
        _checkedKeys.add(_aggKey);
        const ws = (state.warehouseStock || []).find(w =>
          String(w.product_id) === String(it.product_id) &&
          String(w.warehouse_id) === String(it.warehouse_id)
        );
        const stockAvail = Number(ws?.stock || 0);
        const need = _needByKey.get(_aggKey) || 0; // Phase 372: ยอดรวมต่อ key (เดิม = it.qty)
        if (stockAvail < need) {
          // ถ้า warehouse ที่เลือกเป็น home (โดย user เลือกเอง) → ตัดจากบ้านได้
          // (case นี้ไม่ค่อยเจอเพราะเรา re-pick เป็น mobile ข้างบนแล้ว — เก็บไว้เผื่อ edge case)
          const isHome = homeWh && String(it.warehouse_id) === String(homeWh.id);
          if (isHome) {
            // Phase 370: เลือกคลังบ้าน แต่บ้านไม่พอ → block save (เดิม continue = save แล้ว deduct fail เงียบ)
            throw new Error(`❌ ${prod.name}: ของไม่พอ — คลังบ้านมี ${stockAvail}, ต้องใช้ ${need} (เติมสต็อกก่อนบันทึก)`);
          }
          // ถ้าเลือก mobile แต่ไม่พอ → ต้องโอนจากบ้าน
          const homeStock = _getHomeStock(prod, state);
          const shortage = need - stockAvail;
          if (!homeStock || homeStock.stock < shortage) {
            throw new Error(`❌ ${prod.name}: ของไม่พอ — ${it.warehouse_name} มี ${stockAvail}, บ้านมี ${homeStock?.stock || 0}, ต้องใช้ ${need}`);
          }
          transfersNeeded.push({
            productId: it.product_id,
            productName: prod.name,
            fromWhId: homeStock.warehouse_id,
            fromWhName: homeStock.warehouse_name,
            toWhId: it.warehouse_id,
            toWhName: it.warehouse_name,
            qty: shortage
          });
        }
      }

      // ถ้ามี transfer ที่ต้องทำ → แสดง App.confirm (Phase 43.3 — แทน native confirm)
      if (transfersNeeded.length > 0) {
        // eslint-disable-next-line require-atomic-updates -- G: saveBtn entry-guard (ac_install.js:340) gates concurrent save handler
        statusEl.textContent = "🚐 รอ user ตอบ confirm dialog...";
        const summary = transfersNeeded.map(t =>
          `${t.productName}: โอน ${t.qty} ชิ้น (${t.fromWhName} → ${t.toWhName})`
        ).join(" • ");
        const msg = `🚐 ของในรถไม่พอ — ต้องโอนจากบ้านขึ้นรถก่อน: ${summary} — ตกลงโอน + ตัดสต็อกอัตโนมัติ?`;
        const ok = await window.App?.confirm?.(msg);
        if (!ok) {
          throw new Error("ยกเลิกการบันทึก — โอนสต็อกขึ้นรถก่อนแล้วลองใหม่");
        }
      }
      // eslint-disable-next-line require-atomic-updates -- G: saveBtn entry-guard (ac_install.js:340) gates concurrent save handler
      statusEl.textContent = "💾 กำลังบันทึกใบงาน...";

      const desc = [
        productId ? `รุ่น: ${productName} x${qty}` : "",
        ..._items.map(it => `${it.name} x${it.qty} = ฿${Number(it.line_total).toLocaleString()}`),
        labor ? `ค่าแรง: ฿${labor.toLocaleString()}` : "",
        discount ? `ส่วนลด: -฿${discount.toLocaleString()}` : "",
      ].filter(Boolean).join(" | ");

      // ★ Phase 88.12: รับค่าจาก closure section
      const selectedStatus = container.querySelector("#acStatusSel")?.value || "pending";
      const paymentMethod  = container.querySelector("#acPaymentMethod")?.value || "";
      const slipUrl        = container._getAcSlipUrl?.() || "";
      // Phase 88.15: ฟอร์มช่างไม่ trigger JV เอง — JV เกิดผ่าน admin drawer (approve banner)
      const COMPLETION_STATUSES = [];
      const isClosure = COMPLETION_STATUSES.includes(selectedStatus);

      // Phase 43.2: ใช้ field name ตรงกับ schema (customer_address ไม่ใช่ address)
      // Phase 43.4: เพิ่ม job_no ก่อน insert (NOT NULL constraint) — pattern เดียวกับ main.js
      const record = {
        job_no: "JOB-" + Date.now(),
        customer_name: name,
        customer_phone: container.querySelector("#acPhone").value.trim(),
        customer_address: container.querySelector("#acAddress").value.trim(),
        job_type: "ac",
        description: desc,
        items_json: fullItems,
        status: normalizeServiceJobStatus(selectedStatus), // Phase 383: DB-safe (กัน 400 23514)
        note: serviceJobNoteWithReviewMarker(container.querySelector("#acNote").value.trim(), selectedStatus),
        // Phase 88.12 — บัญชี
        total_cost: net,
        payment_method: paymentMethod || null,
        payment_slip_url: slipUrl || null,
        closed_at: isClosure ? new Date().toISOString() : null
      };

      const resp = await fetch(`${cfg.url}/rest/v1/service_jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": cfg.anonKey,
          "Authorization": `Bearer ${token}`,
          "Prefer": "return=representation"
        },
        body: JSON.stringify(record)
      });
      if (!resp.ok) {
        // Phase 43.2: log response body — เห็น error column/RLS ชัด
        let errBody = "";
        try { errBody = await resp.text(); } catch(e) {}
        console.error("[ac_install save fail]", resp.status, errBody, "payload:", record);
        throw new Error(`HTTP ${resp.status}: ${errBody.slice(0, 300) || "no body"}`);
      }
      const inserted = await resp.json();
      const jobId = inserted?.[0]?.id || null;
      const jobNo = inserted?.[0]?.job_no || "";

      // ★ Phase 88.14: Optimistic update — push job ใหม่เข้า state.serviceJobs
      // (เดิมไม่ push → หน้าใบรับงานไม่เห็น job จนกว่าจะ refresh page)
      try {
        if (inserted?.[0]) {
          state.serviceJobs = [inserted[0], ...(state.serviceJobs || [])];
        }
      } catch(e) { console.warn("[ac_install] state update fail", e); }

      // ★ Phase 43: Auto-transfer (ถ้ามี) → ตัดสต็อก
      // eslint-disable-next-line require-atomic-updates -- G: saveBtn entry-guard (ac_install.js:340) gates concurrent save handler
      statusEl.textContent = "🔄 กำลังโอนสต็อก...";
      // ★ Phase 482: งานติดตั้งแอร์ "ไม่ตัดสต็อก" ตอนสร้างอีกแล้ว — ตัดตอนปิดงานผ่าน admin drawer
      //   (deductServiceJobStock; กัน double-deduct ที่ deduct-on-close จะตัดซ้ำ). คงเฉพาะ auto-transfer
      //   (Step 1 — ย้ายคลังเตรียมของ บ้าน→รถ ไม่ใช่ consume). items_json ถูกบันทึก (record.items_json) → drawer ตัดตอนปิด.
      let stockOpsFailed = false;
      try {
        // Step 1: Auto-transfer จากบ้าน → รถ (ถ้ามี shortage)
        for (const t of transfersNeeded) {
          if (typeof window._appTransferWarehouseStock === "function") {
            const r = await window._appTransferWarehouseStock({
              productId: t.productId,
              fromWarehouseId: t.fromWhId,
              toWarehouseId: t.toWhId,
              qty: t.qty,
              note: `auto-transfer for AC install ${jobNo}`
            });
            if (!r?.ok) {
              console.error("[ac_install transfer fail]", t, r);
              stockOpsFailed = true;
            }
          }
        }
      } catch (stockErr) {
        console.error("[ac_install stock ops]", stockErr);
        stockOpsFailed = true;
      }
      // ★ Phase 482: ลบ optimistic deduct ของ fullItems (เดิม Phase 45.5) — ฟอร์มไม่ตัดสต็อกแล้ว
      //   (เก็บไว้จะทำ state.warehouseStock ลดทั้งที่ไม่ได้ตัดจริง = แสดงสต็อกผิด); transfer optimistic
      //   อยู่ใน _appTransferWarehouseStock เองแล้ว.

      if (stockOpsFailed) {
        showToast?.("⚠️ ใบงาน save แล้ว แต่โอนสต็อกบางรายการล้มเหลว — ตรวจ Console");
      }

      // เก็บข้อมูลไว้สำหรับปุ่ม "ดูใบเสร็จ" / "ส่ง LINE"
      _lastSavedJob = {
        id: jobId,
        jobNo,
        customer_name: name,
        customer_phone: container.querySelector("#acPhone").value.trim(),
        address: container.querySelector("#acAddress").value.trim(),
        items: fullItems,
        labor,
        discount,
        total: net
      };

      // eslint-disable-next-line require-atomic-updates -- G: saveBtn entry-guard (ac_install.js:340) gates concurrent save handler
      statusEl.innerHTML = `<div style="text-align:center;color:#059669;font-weight:700">✅ บันทึกใบงานติดตั้งสำเร็จ!${jobNo ? ` (เลขที่ ${escHtml(jobNo)})` : ""}</div>`;
      showToast("บันทึกสำเร็จ!");
      clearServiceDraft(AC_DRAFT_KEY);

      // ★ Phase 88.12: auto-post JV ถ้าช่างปิดงานทันที (delivered/closed/done)
      if (jobId && isClosure) {
        void (async () => {
          const postRes = await postJournalForServiceJob({
            id: jobId,
            job_no: jobNo,
            customer_name: name,
            job_type: "ac",  // install_ac → mapping service_install_ac → 4200
            total_cost: net,
            status: selectedStatus,
            payment_method: paymentMethod,
            created_at: new Date().toISOString()
          }, { detailed: true });
          if (postRes?.status === "failed") {
            console.warn("[ac_install] auto-post JV failed:", postRes.reason, postRes.error || "");
            showToast("บันทึกใบงานแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจ Service Reconcile/Backfill", "warn");
          }
        })().catch(e => {
          console.warn("[ac_install] auto-post JV failed:", e?.message);
          showToast("บันทึกใบงานแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจ Service Reconcile/Backfill", "warn");
        });
      }

      // ★ Phase 41 — แสดงปุ่มหลังบันทึก: ดูใบเสร็จ / ส่ง LINE / สร้างใบใหม่
      _renderAfterSaveActions(container, ctx);
    } catch (e) {
      console.error("[ac_install save] error:", e);
      // eslint-disable-next-line require-atomic-updates -- G: saveBtn entry-guard (ac_install.js:340) gates concurrent save handler — catch path
      statusEl.textContent = "เกิดข้อผิดพลาด: " + e.message;
    } finally {
      clearTimeout(_saveTimeout);
      if (saveBtn.isConnected) {
        saveBtn.disabled = false;
        saveBtn.textContent = origText;
      }
    }
  });

  updateTotal();
}

// ═══════════════════════════════════════════════════════════
//  Helper: alias for backward compat (ใช้ _getTotalStock จริง)
// ═══════════════════════════════════════════════════════════
function _getStock(p, state) {
  return _getTotalStock(p, state);
}

// ═══════════════════════════════════════════════════════════
//  Phase 41 — Items list rendering + binding
// ═══════════════════════════════════════════════════════════
function _renderItemsList(container, money) {
  const el = container.querySelector("#acItemsList");
  if (!el) return;
  if (_items.length === 0) {
    el.innerHTML = `<div class="sku" style="text-align:center;padding:14px;color:#94a3b8">ยังไม่มีอุปกรณ์ — กด "+ เพิ่มอุปกรณ์"</div>`;
    return;
  }
  // Phase 43: lock inputs ถ้า _lastSavedJob มีค่า (ใบงานบันทึกแล้ว)
  const locked = !!_lastSavedJob;
  el.innerHTML = `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;background-image:linear-gradient(to right,transparent calc(100% - 16px),rgba(0,0,0,0.06));background-attachment:local;background-repeat:no-repeat" title="เลื่อนซ้าย-ขวาเพื่อดูจำนวน/ราคา">
      <table style="width:100%;min-width:600px;border-collapse:collapse;font-size:13px">
        <thead style="background:#f1f5f9">
          <tr>
            <th style="padding:8px;text-align:left">อุปกรณ์</th>
            <th style="padding:8px;text-align:left;width:110px">คลัง</th>
            <th style="padding:8px;text-align:center;width:120px">จำนวน</th>
            <th style="padding:8px;text-align:right;width:90px">ราคา/ชิ้น</th>
            <th style="padding:8px;text-align:right;width:90px">รวม</th>
            <th style="padding:8px;width:30px"></th>
          </tr>
        </thead>
        <tbody>
          ${_items.map((it, idx) => {
            const whBadge = it.warehouse_id
              ? `<span style="background:#dbeafe;color:#1e40af;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:700">🚐 ${escHtml(it.warehouse_name || "?")}</span>`
              : `<span style="color:#94a3b8;font-size:10px">—</span>`;
            return `
            <tr style="border-bottom:1px solid #e5e7eb">
              <td style="padding:8px">
                <div style="font-weight:600">${escHtml(it.name)}</div>
                <div style="font-size:10px;color:#94a3b8">${typeof it._stock_avail === "number" ? `คงเหลือ ${it._stock_avail}` : ""}</div>
              </td>
              <td style="padding:8px">${whBadge}</td>
              <td style="padding:6px">
                <div style="display:flex;align-items:center;justify-content:center;gap:2px">
                  ${locked ? "" : `<button type="button" data-item-qty-dec="${idx}" style="width:26px;height:26px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;color:#475569" title="ลด">−</button>`}
                  <input type="number" min="1" value="${it.qty}" data-item-qty="${idx}" ${locked ? "disabled" : ""} style="width:42px;text-align:center;padding:4px 0;border:1px solid #cbd5e1;border-radius:6px;font-weight:700${locked ? ";background:#f1f5f9;color:#94a3b8" : ""}" />
                  ${locked ? "" : `<button type="button" data-item-qty-inc="${idx}" style="width:26px;height:26px;border:1px solid #0284c7;background:#0284c7;color:#fff;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer" title="เพิ่ม">+</button>`}
                </div>
              </td>
              <td style="padding:6px"><input type="number" min="0" step="1" value="${Number(it.unit_price)}" data-item-price="${idx}" ${locked ? "disabled" : ""} style="width:80px;text-align:right;padding:4px;border:1px solid #cbd5e1;border-radius:6px${locked ? ";background:#f1f5f9;color:#94a3b8" : ""}" /></td>
              <td data-line-total="${idx}" style="padding:8px;text-align:right;font-weight:700;color:#0284c7">${money(it.line_total)}</td>
              <td style="padding:6px;text-align:center">${locked ? "" : `<button data-item-del="${idx}" class="btn light" style="font-size:14px;padding:2px 8px;color:#dc2626" title="ลบ">×</button>`}</td>
            </tr>
          `;}).join("")}
        </tbody>
      </table>
    </div>
    ${locked ? `<div style="padding:8px 12px;margin-top:8px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;font-size:12px;color:#92400e">🔒 ใบงานบันทึกแล้ว — แก้ไขได้แค่หมายเหตุ/รูป (สร้างใบใหม่ถ้าต้องการแก้)</div>` : ""}
  `;
}

function _bindItemListEvents(container, updateTotal, money) {
  // Phase 83.2: อัปเดตเฉพาะ cell รวม + grand total — ไม่ re-render ทั้ง table
  // (ก่อนหน้านี้ re-render ทำให้ input ถูกแทน → focus หาย → keyboard เด้งออกตอนพิมพ์)
  const updateLineTotal = (idx) => {
    const cell = container.querySelector(`[data-line-total="${idx}"]`);
    if (cell) cell.textContent = money(_items[idx].line_total);
  };
  container.querySelector("#acItemsList")?.addEventListener("input", (e) => {
    const tgt = e.target;
    if (tgt.dataset.itemQty !== undefined) {
      const idx = Number(tgt.dataset.itemQty);
      const qty = Math.max(1, parseInt(tgt.value) || 1);
      _items[idx].qty = qty;
      _items[idx].line_total = qty * Number(_items[idx].unit_price || 0);
      updateLineTotal(idx);
      updateTotal();
      container.dispatchEvent(new Event("input"));
    } else if (tgt.dataset.itemPrice !== undefined) {
      const idx = Number(tgt.dataset.itemPrice);
      const price = Math.max(0, parseFloat(tgt.value) || 0);
      _items[idx].unit_price = price;
      _items[idx].line_total = Number(_items[idx].qty) * price;
      updateLineTotal(idx);
      updateTotal();
      container.dispatchEvent(new Event("input"));
    }
  });
  container.querySelector("#acItemsList")?.addEventListener("click", (e) => {
    const delBtn = e.target.closest("[data-item-del]");
    if (delBtn) {
      const idx = Number(delBtn.dataset.itemDel);
      _items.splice(idx, 1);
      _renderItemsList(container, money);
      updateTotal();
      container.dispatchEvent(new Event("input"));
      return;
    }
    // Phase 83.1: ปุ่ม +/- เพิ่ม/ลดจำนวน (mobile-friendly stepper)
    // Phase 83.2: อัปเดต DOM เฉพาะที่จำเป็น (ไม่ re-render → keyboard ไม่เด้งออก)
    const incBtn = e.target.closest("[data-item-qty-inc]");
    if (incBtn) {
      const idx = Number(incBtn.dataset.itemQtyInc);
      _items[idx].qty = Number(_items[idx].qty || 1) + 1;
      _items[idx].line_total = _items[idx].qty * Number(_items[idx].unit_price || 0);
      const qtyInput = container.querySelector(`[data-item-qty="${idx}"]`);
      if (qtyInput) qtyInput.value = _items[idx].qty;
      updateLineTotal(idx);
      updateTotal();
      container.dispatchEvent(new Event("input"));
      return;
    }
    const decBtn = e.target.closest("[data-item-qty-dec]");
    if (decBtn) {
      const idx = Number(decBtn.dataset.itemQtyDec);
      _items[idx].qty = Math.max(1, Number(_items[idx].qty || 1) - 1);
      _items[idx].line_total = _items[idx].qty * Number(_items[idx].unit_price || 0);
      const qtyInput = container.querySelector(`[data-item-qty="${idx}"]`);
      if (qtyInput) qtyInput.value = _items[idx].qty;
      updateLineTotal(idx);
      updateTotal();
      container.dispatchEvent(new Event("input"));
      return;
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  Phase 41 — Picker modal: search + select equipment
// ═══════════════════════════════════════════════════════════
function _openItemPicker(ctx, container, updateTotal, saveDraftNow) {
  const { state, money, showToast } = ctx;
  document.getElementById("acItemPickerModal")?.remove();

  // Phase 43: กรองเฉพาะสินค้าที่มีใน mobile (รถ) หรือบ้าน (เผื่อ auto-transfer)
  const allInStock = (state.products || []).filter(p => {
    const mobileTotal = _getMobileStocks(p, state).reduce((s, x) => s + x.stock, 0);
    const homeStock = _getHomeStock(p, state)?.stock || 0;
    return (mobileTotal + homeStock) > 0;
  });

  // Phase 453a — เลือกคลังก่อน + กรองหมวด (UI เท่านั้น; ไม่แตะ transfer/deduct)
  const warehouses = state.warehouses || [];
  let _acPickerWh = "all";   // "all" หรือ warehouse id
  let _acPickerCat = "all";  // "all" หรือชื่อหมวด

  // stock ของ p ในคลัง whId (รวม mobile + home)
  const _acStockInWh = (p, whId) => {
    let total = 0;
    for (const s of _getMobileStocks(p, state)) {
      if (String(s.warehouse_id) === String(whId)) total += s.stock;
    }
    const h = _getHomeStock(p, state);
    if (h && String(h.warehouse_id) === String(whId)) total += h.stock;
    return total;
  };
  const _acBaseForWh = () => {
    if (_acPickerWh === "all") return allInStock;
    return (state.products || []).filter(p => _acStockInWh(p, _acPickerWh) > 0);
  };

  const renderWhChips = () => {
    const chip = (val, label, active) =>
      `<button type="button" data-wh-chip="${escHtml(String(val))}" class="btn light" style="font-size:12px;padding:5px 10px;border-radius:14px;white-space:nowrap${active ? ';background:#0284c7;color:#fff;border-color:#0284c7' : ''}">${label}</button>`;
    return chip("all", "ทุกคลัง", _acPickerWh === "all") +
      warehouses.map(w => chip(w.id, `${w.is_mobile === true ? "🚐" : "📦"} ${escHtml(w.name)}`, String(_acPickerWh) === String(w.id))).join("");
  };
  const renderCatOptions = () => {
    const cats = [...new Set(_acBaseForWh().map(p => String(p.category || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "th"));
    return `<option value="all"${_acPickerCat === "all" ? " selected" : ""}>ทุกหมวด</option>` +
      cats.map(c => `<option value="${escHtml(c)}"${_acPickerCat === c ? " selected" : ""}>${escHtml(c)}</option>`).join("");
  };

  const renderList = (search) => {
    const q = (search || "").toLowerCase().trim();
    let filtered = _acBaseForWh();
    if (_acPickerCat !== "all") filtered = filtered.filter(p => String(p.category || "").trim() === _acPickerCat);
    if (q) {
      filtered = filtered.filter(p =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.barcode || "").toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q)
      );
    }
    return filtered.slice(0, 50).map(p => {
      let mobileStocks = _getMobileStocks(p, state);
      let homeStock = _getHomeStock(p, state);
      // เลือกคลังเฉพาะ → โชว์ tag เฉพาะคลังนั้น (กันสับสนชื่อซ้ำข้ามคลัง)
      if (_acPickerWh !== "all") {
        mobileStocks = mobileStocks.filter(s => String(s.warehouse_id) === String(_acPickerWh));
        homeStock = (homeStock && String(homeStock.warehouse_id) === String(_acPickerWh)) ? homeStock : null;
      }
      const inMobile = mobileStocks.length > 0;
      // แสดง stock per warehouse แบบเข้าใจง่าย
      const stockTags = mobileStocks.map(s =>
        `<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700">🚐 ${escHtml(s.warehouse_name)}: ${s.stock}</span>`
      ).join(" ");
      const homeTag = homeStock && homeStock.stock > 0
        ? `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700">📦 ${escHtml(homeStock.warehouse_name)}: ${homeStock.stock}</span>`
        : "";
      const warningBadge = !inMobile
        ? `<div style="font-size:10px;color:#dc2626;margin-top:4px">⚠️ ยังไม่ได้โอนขึ้นรถ — ต้องยืนยันโอนตอนกดเลือก</div>`
        : "";
      return `
        <button class="acpk-item" data-pk-id="${p.id}" style="display:block;width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;cursor:pointer;text-align:left;font:inherit;margin-bottom:6px;touch-action:manipulation">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;color:#0f172a">${escHtml(p.name || "-")}</div>
              <div style="font-size:11px;color:#64748b">${escHtml(p.category || "")}${p.barcode ? ` • ${escHtml(p.barcode)}` : ""}</div>
              <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${stockTags}${homeTag}</div>
              ${warningBadge}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <span data-badge-pid="${p.id}" style="display:none;background:#0284c7;color:#fff;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:800;margin-bottom:4px"></span>
              <div style="font-weight:700;color:#0284c7">${money(p.price || 0)}</div>
            </div>
          </div>
        </button>
      `;
    }).join("") || `<div class="sku" style="text-align:center;padding:20px;color:#94a3b8">ไม่พบสินค้า "${escHtml(q)}"</div>`;
  };

  const modal = document.createElement("div");
  modal.id = "acItemPickerModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:500px;width:100%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0;font-size:16px">🔧 เลือกอุปกรณ์</h3>
        <button id="acpkClose" class="btn light" style="font-size:18px;padding:4px 10px">✕</button>
      </div>
      <div style="padding:12px 16px 8px;border-bottom:1px solid #e2e8f0;display:flex;flex-direction:column;gap:8px">
        <div style="font-size:12px;color:#64748b;font-weight:600">เลือกคลังก่อน:</div>
        <div id="acpkWhChips" style="display:flex;gap:6px;flex-wrap:wrap"></div>
        <select id="acpkCat" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;font:inherit;background:#fff"></select>
        <input id="acpkSearch" type="text" placeholder="🔍 ค้นหา ชื่อ / barcode / หมวด..." style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit" />
      </div>
      <div id="acpkList" style="flex:1;overflow-y:auto;padding:12px 16px"></div>
      <div id="acpkCart" style="border-top:2px solid #0284c7;background:#f8fafc;max-height:42vh;overflow-y:auto;display:none;flex-shrink:0"></div>
      <div style="padding:10px 16px;border-top:1px solid #e2e8f0">
        <button id="acpkDone" type="button" style="width:100%;padding:11px;background:#0284c7;color:#fff;border:none;border-radius:10px;font-weight:700;font-size:15px;cursor:pointer">เสร็จ</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const listEl = modal.querySelector("#acpkList");
  const whChipsEl = modal.querySelector("#acpkWhChips");
  const catEl = modal.querySelector("#acpkCat");
  const searchEl = modal.querySelector("#acpkSearch");
  const cartEl = modal.querySelector("#acpkCart");
  const doneBtn = modal.querySelector("#acpkDone");
  const refreshList = () => { listEl.innerHTML = renderList(searchEl.value); updateCartBadges(listEl, _items); };

  // Phase 502a: ตะกร้าแคชเชียร์ในตัว picker (helper กลาง picker_cart.js) — แก้ qty/ลบในตะกร้าได้ + badge "×N" บนสินค้า
  const _tg = makePickerTouchGuard();   // กัน double-add จอสัมผัส (แตะตัวเดิมซ้ำ <350ms = ข้าม)
  const _afterCartChange = () => { _renderItemsList(container, money); updateTotal(); saveDraftNow?.(); renderCart(); };
  const renderCart = () => {
    renderPickerCart(cartEl, {
      items: _items, money, escHtml,
      onChangeQty: (i, q) => { _items[i].qty = q; _items[i].line_total = q * Number(_items[i].unit_price || 0); _afterCartChange(); },
      onRemove: (i) => { _items.splice(i, 1); _afterCartChange(); }
    });
    updateCartBadges(listEl, _items);
    const tq = _items.reduce((s, it) => s + Number(it.qty || 0), 0);
    const ta = _items.reduce((s, it) => s + Number(it.qty || 0) * Number(it.unit_price || 0), 0);
    if (doneBtn) doneBtn.textContent = tq > 0 ? `เสร็จ • ${tq} ชิ้น • ${money(ta)}` : "เสร็จ";
  };

  whChipsEl.innerHTML = renderWhChips();
  catEl.innerHTML = renderCatOptions();
  refreshList();
  renderCart();   // โชว์ของเดิมในงาน (ถ้ามี) + label ปุ่มเสร็จ

  modal.querySelector("#acpkClose").addEventListener("click", () => modal.remove());
  doneBtn?.addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  searchEl.addEventListener("input", () => refreshList());

  // เปลี่ยนคลัง → reset หมวด + rebuild dropdown หมวด + re-render (delegation: container คงอยู่)
  whChipsEl.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-wh-chip]");
    if (!chip) return;
    _acPickerWh = chip.dataset.whChip;
    _acPickerCat = "all";
    whChipsEl.innerHTML = renderWhChips();
    catEl.innerHTML = renderCatOptions();
    refreshList();
  });
  catEl.addEventListener("change", () => { _acPickerCat = catEl.value; refreshList(); });

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-pk-id]");
    if (!btn) return;
    const id = btn.dataset.pkId;
    const p = (state.products || []).find(x => String(x.id) === String(id));
    if (!p) return;
    // Phase 502a: กัน double-add จอสัมผัส (แตะตัวเดิมซ้ำ <350ms = ข้าม) — ก่อน logic เลือกคลัง/await
    if (_tg.shouldSkip(p.id)) return;

    // Phase 43: เลือก warehouse (รถ) ที่จะตัดสต็อก
    const mobileStocks = _getMobileStocks(p, state);
    const homeStock = _getHomeStock(p, state);

    let chosenWh = null;

    // Phase 453a — เลือกคลังไว้แล้ว → ใช้คลังนั้นเลย (ข้าม _pickMobileWarehouse)
    if (_acPickerWh !== "all") {
      const mob = mobileStocks.find(s => String(s.warehouse_id) === String(_acPickerWh));
      if (mob) {
        chosenWh = mob;
      } else if (homeStock && String(homeStock.warehouse_id) === String(_acPickerWh) && homeStock.stock > 0) {
        // เลือกของบ้าน → คง toast ยืนยันโอนตอนบันทึกเหมือนเดิม
        chosenWh = homeStock;
        showToast?.(`⚠️ ${p.name} ยังอยู่ในบ้าน — จะถามยืนยันโอนตอนบันทึก`);
      }
      // ไม่เจอ (ไม่ควรเกิด เพราะ list กรองมาแล้ว) → ตกไป fallback flow เดิมด้านล่าง
    }

    if (!chosenWh) {
      if (mobileStocks.length === 1) {
        // มีรถเดียว → auto-pick
        chosenWh = mobileStocks[0];
      } else if (mobileStocks.length > 1) {
        // Phase 43.3: ใช้ custom modal (เดิมใช้ window.prompt ผิดกฎ)
        chosenWh = await _pickMobileWarehouse(mobileStocks, p.name);
        if (!chosenWh) {
          showToast?.("ยกเลิก");
          return;
        }
      } else if (homeStock && homeStock.stock > 0) {
        // ไม่มีในรถเลย → auto-pick "บ้าน" + แจ้งว่าจะ auto-transfer ตอน save
        chosenWh = homeStock;
        showToast?.(`⚠️ ${p.name} ยังอยู่ในบ้าน — จะถามยืนยันโอนตอนบันทึก`);
      } else {
        showToast?.("ไม่มีของในระบบ");
        return;
      }
    }

    // เช็คว่าซ้ำมั้ย — ถ้าซ้ำ + warehouse เดียวกัน → เพิ่ม qty / ถ้าคนละ wh → เพิ่มเป็นแถวใหม่
    const existing = _items.find(it =>
      String(it.product_id) === String(p.id) &&
      String(it.warehouse_id) === String(chosenWh.warehouse_id)
    );
    if (existing) {
      existing.qty = Number(existing.qty) + 1;
      existing.line_total = existing.qty * Number(existing.unit_price || 0);
    } else {
      _items.push({
        product_id: Number(p.id),
        name: p.name || "-",
        qty: 1,
        unit_price: Number(p.price || 0),
        line_total: Number(p.price || 0),
        warehouse_id: chosenWh.warehouse_id,
        warehouse_name: chosenWh.warehouse_name,
        _stock_avail: chosenWh.stock
      });
    }
    // Phase 502a: ไม่ปิด picker (multi-add) — refresh รายการ/ยอด/draft/ตะกร้า ในที่เดียว (modal.remove ออกแล้ว)
    _afterCartChange();
    showToast?.(`เพิ่ม "${p.name}" ✓`);
  });

  setTimeout(() => modal.querySelector("#acpkSearch")?.focus(), 100);
}

// ═══════════════════════════════════════════════════════════
//  Phase 41 — After-save actions: ใบเสร็จ + ส่ง LINE + สร้างใบใหม่
// ═══════════════════════════════════════════════════════════
function _renderAfterSaveActions(container, ctx) {
  const { state: _state, money: _money, showToast: _showToast } = ctx;
  const el = container.querySelector("#acAfterSave");
  if (!el || !_lastSavedJob) return;
  el.innerHTML = `
    <div class="panel" style="background:#f0fdf4;border:2px solid #86efac;margin-top:12px">
      <div style="font-weight:700;color:#15803d;margin-bottom:8px">📋 ขั้นต่อไป</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="acViewReceipt" class="btn primary" style="flex:1;min-width:140px">📄 ดูใบเสร็จ / พิมพ์</button>
        <button id="acSendLine" class="btn" style="flex:1;min-width:140px;background:#06c755;color:#fff;border:none;border-radius:14px;padding:12px;font-weight:700">📤 ส่ง LINE ลูกค้า</button>
        <button id="acNewBill" class="btn light" style="flex:1;min-width:140px">+ สร้างใบใหม่</button>
      </div>
    </div>
  `;

  el.querySelector("#acViewReceipt")?.addEventListener("click", () => _openReceiptPreview(ctx, container));
  el.querySelector("#acSendLine")?.addEventListener("click", () => _sendLineReceipt(ctx, container));
  el.querySelector("#acNewBill")?.addEventListener("click", async () => {
    // Phase 45.5: reload data ตอนนี้ (ใบงานก่อนหน้า save แล้ว — ไม่กระทบ form)
    try { await ctx.loadAllData?.(); } catch(e) {}
    _items = [];
    _lastSavedJob = null;
    clearServiceDraft(AC_DRAFT_KEY);
    renderAcInstallPage(ctx);
  });
}

// ═══════════════════════════════════════════════════════════
//  Receipt preview (HTML modal — print-ready)
// ═══════════════════════════════════════════════════════════
function _openReceiptPreview(ctx, _container) {
  const { state, money } = ctx;
  if (!_lastSavedJob) return;
  const job = _lastSavedJob;
  const storeInfo = state.storeInfo || {};
  const storeName = storeInfo.name || "บุญสุข อิเล็กทรอนิกส์";
  const storeAddr = storeInfo.address || "";
  const storePhone = storeInfo.phone || "";
  const today = new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });

  document.getElementById("acReceiptModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "acReceiptModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:560px;width:100%;overflow:hidden;display:flex;flex-direction:column">
      <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;background:#f8fafc">
        <h3 style="margin:0;font-size:15px">📄 ใบเสร็จงานติดตั้งแอร์</h3>
        <div style="display:flex;gap:6px">
          <button id="acrcPrint" class="btn primary" style="font-size:12px;padding:6px 12px">🖨️ พิมพ์</button>
          <button id="acrcClose" class="btn light" style="font-size:18px;padding:4px 10px">✕</button>
        </div>
      </div>
      <div id="acrcBody" style="padding:20px;font-family:'Sarabun',sans-serif">
        <div style="text-align:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #e2e8f0">
          <div style="font-size:18px;font-weight:900;color:#0c4a6e">${escHtml(storeName)}</div>
          ${storeAddr ? `<div style="font-size:11px;color:#64748b">${escHtml(storeAddr)}</div>` : ""}
          ${storePhone ? `<div style="font-size:11px;color:#64748b">โทร: ${escHtml(storePhone)}</div>` : ""}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:12px">
          <div><strong>ใบเสร็จเลขที่:</strong> ${escHtml(job.jobNo || "-")}</div>
          <div><strong>วันที่:</strong> ${today}</div>
        </div>
        <div style="font-size:12px;margin-bottom:14px;padding:10px;background:#f8fafc;border-radius:8px">
          <div><strong>👤 ลูกค้า:</strong> ${escHtml(job.customer_name)}</div>
          ${job.customer_phone ? `<div><strong>📞 โทร:</strong> ${escHtml(job.customer_phone)}</div>` : ""}
          ${job.address ? `<div><strong>📍 ที่อยู่:</strong> ${escHtml(job.address)}</div>` : ""}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px">
          <thead style="background:#f1f5f9">
            <tr>
              <th style="padding:8px;text-align:left">รายการ</th>
              <th style="padding:8px;text-align:center;width:60px">จำนวน</th>
              <th style="padding:8px;text-align:right;width:90px">ราคา</th>
              <th style="padding:8px;text-align:right;width:100px">รวม</th>
            </tr>
          </thead>
          <tbody>
            ${(job.items || []).map(it => `
              <tr style="border-bottom:1px solid #e5e7eb">
                <td style="padding:8px">${escHtml(it.name)}${it.is_main ? ' <span style="font-size:10px;color:#0284c7">(แอร์หลัก)</span>' : ""}</td>
                <td style="padding:8px;text-align:center">${it.qty}</td>
                <td style="padding:8px;text-align:right">${money(it.unit_price)}</td>
                <td style="padding:8px;text-align:right;font-weight:600">${money(it.line_total)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div style="margin-bottom:14px;padding:10px 14px;background:#f8fafc;border-radius:8px">
          <div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0">
            <span>รวมรายการ</span>
            <span>${money((job.items || []).reduce((s, it) => s + Number(it.line_total || 0), 0))}</span>
          </div>
          ${job.labor > 0 ? `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0"><span>ค่าแรงติดตั้ง</span><span>+${money(job.labor)}</span></div>` : ""}
          ${job.discount > 0 ? `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;color:#dc2626"><span>ส่วนลด</span><span>−${money(job.discount)}</span></div>` : ""}
          <div style="display:flex;justify-content:space-between;border-top:2px solid #cbd5e1;padding-top:6px;margin-top:6px;font-size:16px;font-weight:900;color:#0c4a6e"><span>ยอดสุทธิ</span><span>${money(job.total)}</span></div>
        </div>
        <div style="text-align:center;font-size:11px;color:#64748b;border-top:1px dashed #cbd5e1;padding-top:10px">
          ขอบพระคุณที่ใช้บริการครับ 🙏
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector("#acrcClose").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector("#acrcPrint").addEventListener("click", () => {
    const body = modal.querySelector("#acrcBody").innerHTML;
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.document.write(`<html><head><title>ใบเสร็จ ${job.jobNo || ""}</title><style>
      body{margin:20px;font-family:'Sarabun','Tahoma',sans-serif}
      table{width:100%;border-collapse:collapse}
      th,td{padding:6px 8px}
      thead{background:#f1f5f9}
      tbody tr{border-bottom:1px solid #e5e7eb}
    </style></head><body>${body}</body></html>`);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch(e){} }, 300);
  });
}

// ═══════════════════════════════════════════════════════════
//  Send LINE notify with receipt summary
// ═══════════════════════════════════════════════════════════
async function _sendLineReceipt(ctx, container) {
  const { showToast } = ctx;
  if (!_lastSavedJob) return;
  const job = _lastSavedJob;
  const btn = container.querySelector("#acSendLine");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ กำลังส่ง..."; }

  try {
    const lines = [
      "🧾 ใบเสร็จงานติดตั้งแอร์",
      "━━━━━━━━━━━━━━━",
      `เลขที่: ${job.jobNo || "-"}`,
      `ลูกค้า: ${job.customer_name}`,
      job.customer_phone ? `โทร: ${job.customer_phone}` : "",
      "",
      "📦 รายการ:",
      ...(job.items || []).map(it => `• ${it.name} x${it.qty} = ฿${Number(it.line_total).toLocaleString()}`),
      "",
      job.labor > 0 ? `ค่าแรง: ฿${Number(job.labor).toLocaleString()}` : "",
      job.discount > 0 ? `ส่วนลด: -฿${Number(job.discount).toLocaleString()}` : "",
      "━━━━━━━━━━━━━━━",
      `💰 ยอดสุทธิ: ฿${Number(job.total).toLocaleString()}`,
      "",
      "ขอบพระคุณที่ใช้บริการครับ 🙏"
    ].filter(Boolean).join("\n");

    const ok = await ctx.sendLineNotify?.(lines, ctx, "done");
    if (ok !== false) {
      showToast?.("ส่ง LINE สำเร็จ ✓");
    } else {
      showToast?.("ส่ง LINE ไม่สำเร็จ — ตรวจตั้งค่า LINE Notify");
    }
  } catch (e) {
    console.error("[ac_install line]", e);
    showToast?.("ส่ง LINE ไม่สำเร็จ: " + (e?.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "📤 ส่ง LINE ลูกค้า"; }
  }
}

// ═══════════════════════════════════════════════════════════
//  Phase 43.3 — Mobile warehouse picker modal (แทน window.prompt)
// ═══════════════════════════════════════════════════════════
function _pickMobileWarehouse(mobileStocks, productName) {
  return new Promise((resolve) => {
    document.getElementById("acWhPickModal")?.remove();
    const modal = document.createElement("div");
    modal.id = "acWhPickModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px";
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:420px;width:100%;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0">
          <h3 style="margin:0;font-size:15px">🚐 เลือกรถสำหรับตัดสต็อก</h3>
          <div style="font-size:12px;color:#64748b;margin-top:2px">${escHtml(productName || "")} — มีในหลายรถ</div>
        </div>
        <div style="padding:12px 16px;display:flex;flex-direction:column;gap:8px">
          ${mobileStocks.map((s, i) => `
            <button data-wh-idx="${i}" style="display:flex;justify-content:space-between;align-items:center;padding:14px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;cursor:pointer;font:inherit;text-align:left">
              <div style="flex:1">
                <div style="font-weight:700">${escHtml(s.warehouse_name)}</div>
                <div style="font-size:11px;color:#64748b">มีในสต็อก</div>
              </div>
              <div style="font-weight:800;color:#0284c7;font-size:18px">${s.stock}</div>
            </button>
          `).join("")}
        </div>
        <div style="padding:8px 16px 14px;border-top:1px solid #e2e8f0">
          <button id="acWhPickCancel" style="width:100%;padding:10px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:10px;cursor:pointer;font:inherit;color:#64748b">ยกเลิก</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const cleanup = () => modal.remove();

    modal.querySelectorAll("[data-wh-idx]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.whIdx);
        cleanup();
        resolve(mobileStocks[idx]);
      });
    });
    modal.querySelector("#acWhPickCancel").addEventListener("click", () => { cleanup(); resolve(null); });
    modal.addEventListener("click", (e) => { if (e.target === modal) { cleanup(); resolve(null); } });
  });
}

// ═══════════════════════════════════════════════════════════
//  Phase 45.6 — Transfer modal: โอนสต็อก บ้าน → รถ inline
//  ใช้โดยทั้ง ac_install + service_form (export ผ่าน window)
// ═══════════════════════════════════════════════════════════
function _openTransferModal(ctx) {
  const { state, money: _money, showToast } = ctx;
  document.getElementById("acTransferModal")?.remove();

  const homeWh = _getHomeWarehouse(state);
  const mobileWhList = _getMobileWarehouses(state);

  if (!homeWh) {
    showToast?.("ไม่พบคลังบ้าน — ตรวจตั้งค่าคลัง");
    return;
  }
  if (mobileWhList.length === 0) {
    showToast?.("ไม่พบคลังรถ (mobile) — ตรวจตั้งค่าคลัง");
    return;
  }

  // Products ที่มีของในบ้าน > 0
  const productsInHome = (state.products || []).map(p => {
    const ws = (state.warehouseStock || []).find(w =>
      String(w.product_id) === String(p.id) && String(w.warehouse_id) === String(homeWh.id)
    );
    return { p, homeStock: Number(ws?.stock || 0) };
  }).filter(x => x.homeStock > 0);

  let chosenProduct = null;
  const _chosenWh = mobileWhList[0]; // default first mobile

  const renderList = (search) => {
    const q = (search || "").toLowerCase().trim();
    let filtered = productsInHome;
    if (q) {
      filtered = filtered.filter(({ p }) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.barcode || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q)
      );
    }
    return filtered.slice(0, 50).map(({ p, homeStock }) => {
      const mobileStocks = _getMobileStocks(p, state);
      const _inMobileTotal = mobileStocks.reduce((s, m) => s + m.stock, 0);
      const mobileBadges = mobileWhList.map(w => {
        const stk = mobileStocks.find(m => String(m.warehouse_id) === String(w.id))?.stock || 0;
        return `<span style="background:#dbeafe;color:#1e40af;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:700">🚐 ${escHtml(w.name)}: ${stk}</span>`;
      }).join(" ");
      return `
        <button class="actr-item" data-tr-id="${p.id}" style="display:block;width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;cursor:pointer;text-align:left;font:inherit;margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;color:#0f172a">${escHtml(p.name || "-")}</div>
              <div style="font-size:11px;color:#64748b">${escHtml(p.category || "")}${p.barcode ? ` • ${escHtml(p.barcode)}` : ""}</div>
              <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
                <span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:700">📦 บ้าน: ${homeStock}</span>
                ${mobileBadges}
              </div>
            </div>
          </div>
        </button>
      `;
    }).join("") || `<div class="sku" style="text-align:center;padding:20px;color:#94a3b8">ไม่พบสินค้าที่มีของในบ้าน</div>`;
  };

  const modal = document.createElement("div");
  modal.id = "acTransferModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:560px;width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;background:#eff6ff">
        <h3 style="margin:0;font-size:16px;color:#1e40af">🔄 โอนสต็อก บ้าน → รถ</h3>
        <button id="actrClose" class="btn light" style="font-size:18px;padding:4px 10px">✕</button>
      </div>
      <div id="actrStep1" style="flex:1;overflow-y:auto;padding:12px 16px">
        <div style="font-size:12px;color:#64748b;margin-bottom:10px">เลือกสินค้าที่ต้องการโอน (มีในบ้าน ${productsInHome.length} รายการ)</div>
        <input id="actrSearch" type="text" placeholder="🔍 ค้นหา ชื่อ / barcode / หมวด..." style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit;margin-bottom:10px" />
        <div id="actrList"></div>
      </div>
      <div id="actrStep2" style="flex:1;overflow-y:auto;padding:12px 16px;display:none">
        <button id="actrBack" class="btn light" style="font-size:12px;margin-bottom:10px">← กลับ</button>
        <div style="padding:12px;background:#f8fafc;border-radius:10px;margin-bottom:12px">
          <div id="actrProdName" style="font-weight:700"></div>
          <div id="actrProdStock" style="font-size:12px;color:#64748b;margin-top:4px"></div>
        </div>
        <label class="set-field-label">โอนเข้ารถ</label>
        <select id="actrWhTarget" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:10px;margin-bottom:12px">
          ${mobileWhList.map(w => `<option value="${w.id}">${escHtml(w.name)}</option>`).join("")}
        </select>
        <label class="set-field-label">จำนวน (สูงสุด <span id="actrQtyMax">0</span>)</label>
        <input id="actrQty" type="number" min="1" value="1" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:10px;margin-bottom:12px;font-size:18px;text-align:center" />
        <button id="actrConfirm" class="btn primary" style="width:100%;padding:14px;font-size:15px;font-weight:700">✅ ยืนยันโอน</button>
        <div id="actrStatus" style="margin-top:10px;font-size:12px"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const listEl = modal.querySelector("#actrList");
  const step1 = modal.querySelector("#actrStep1");
  const step2 = modal.querySelector("#actrStep2");
  listEl.innerHTML = renderList("");

  modal.querySelector("#actrClose").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector("#actrSearch").addEventListener("input", (e) => {
    listEl.innerHTML = renderList(e.target.value);
  });
  modal.querySelector("#actrBack").addEventListener("click", () => {
    step1.style.display = "block";
    step2.style.display = "none";
  });

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tr-id]");
    if (!btn) return;
    const id = btn.dataset.trId;
    const entry = productsInHome.find(x => String(x.p.id) === String(id));
    if (!entry) return;
    chosenProduct = entry;
    modal.querySelector("#actrProdName").textContent = entry.p.name || "-";
    modal.querySelector("#actrProdStock").textContent = `📦 บ้านมี ${entry.homeStock} ชิ้น`;
    modal.querySelector("#actrQtyMax").textContent = entry.homeStock;
    const qtyEl = modal.querySelector("#actrQty");
    qtyEl.max = entry.homeStock;
    qtyEl.value = 1;
    step1.style.display = "none";
    step2.style.display = "block";
  });

  modal.querySelector("#actrConfirm").addEventListener("click", async () => {
    if (!chosenProduct) return;
    const targetWhId = modal.querySelector("#actrWhTarget").value;
    const qty = parseInt(modal.querySelector("#actrQty").value) || 0;
    if (qty <= 0) {
      modal.querySelector("#actrStatus").innerHTML = `<div style="color:#dc2626">จำนวนต้อง > 0</div>`;
      return;
    }
    if (qty > chosenProduct.homeStock) {
      modal.querySelector("#actrStatus").innerHTML = `<div style="color:#dc2626">จำนวนเกินที่มีในบ้าน (${chosenProduct.homeStock})</div>`;
      return;
    }

    const confirmBtn = modal.querySelector("#actrConfirm");
    confirmBtn.disabled = true;
    confirmBtn.textContent = "⏳ กำลังโอน...";
    modal.querySelector("#actrStatus").innerHTML = `<div style="color:#64748b">กำลังโอน...</div>`;

    try {
      if (typeof window._appTransferWarehouseStock !== "function") {
        throw new Error("ระบบยังโหลดไม่เสร็จ — รีเฟรชหน้า");
      }
      const targetName = mobileWhList.find(w => String(w.id) === String(targetWhId))?.name || "?";
      const r = await window._appTransferWarehouseStock({
        productId: chosenProduct.p.id,
        fromWarehouseId: homeWh.id,
        toWarehouseId: targetWhId,
        qty,
        note: `โอนเข้ารถ (manual จากหน้าใบงาน)`
      });
      if (!r?.ok) {
        throw new Error(r?.error || "โอนไม่สำเร็จ");
      }
      // Optimistic update local state
      const homeWs = (state.warehouseStock || []).find(w =>
        String(w.product_id) === String(chosenProduct.p.id) && String(w.warehouse_id) === String(homeWh.id)
      );
      if (homeWs) homeWs.stock = Math.max(0, Number(homeWs.stock || 0) - qty);
      const targetWs = (state.warehouseStock || []).find(w =>
        String(w.product_id) === String(chosenProduct.p.id) && String(w.warehouse_id) === String(targetWhId)
      );
      if (targetWs) targetWs.stock = Number(targetWs.stock || 0) + qty;
      else (state.warehouseStock = state.warehouseStock || []).push({
        product_id: chosenProduct.p.id, warehouse_id: targetWhId, stock: qty
      });

      modal.remove();
      showToast?.(`✅ โอน "${chosenProduct.p.name}" ${qty} ชิ้น จากบ้าน → ${targetName}`);
      // Background reload (ไม่ block — re-render หน้าจะดึง state ใหม่)
      setTimeout(() => { try { ctx.loadAllData?.(); } catch(e){} }, 100);
    } catch (e) {
      console.error("[ac_install transfer]", e);
      modal.querySelector("#actrStatus").innerHTML = `<div style="color:#dc2626">${escHtml(e.message || String(e))}</div>`;
      confirmBtn.disabled = false;
      confirmBtn.textContent = "✅ ยืนยันโอน";
    }
  });

  setTimeout(() => modal.querySelector("#actrSearch")?.focus(), 100);
}

// Export ให้ service_form ใช้ซ้ำได้
window._appOpenTransferModal = _openTransferModal;
