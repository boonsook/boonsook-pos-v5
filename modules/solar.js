// ═══════════════════════════════════════════════════════════
//  SOLAR — งานโซล่าเซลล์
//  Phase 88.12: + ปิดงาน/แนบสลิป/AI verify (workflow ช่างส่ง→admin ยืนยัน)
// ═══════════════════════════════════════════════════════════

import { postJournalForServiceJob } from "./accounting/auto_post.js";

const SOLAR_TYPES = [
  "💧 ติดตั้งปั๊มน้ำโซล่าเซลล์",
  "⚡ ติดตั้งชุดออนกริดโซล่าเซลล์",
  "🔋 ติดตั้งชุดออฟกริดโซล่าเซลล์",
  "🌐 ติดตั้งชุดไฮบริดโซล่าเซลล์",
  "🔌 ซ่อม & เซอร์วิสระบบโซล่าเซลล์",
  "🛠️ งานโซล่าเซลล์อื่นๆ"
];

export function renderSolarPage(ctx) {
  const { state, money, showToast } = ctx;
  const container = document.getElementById("page-solar");
  if (!container) return;

  const escHtml = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const typeOptions = SOLAR_TYPES.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join("");

  container.innerHTML = `
    <div class="panel">
      <h3 style="color:var(--primary2);margin-bottom:4px">☀️ งานโซล่าเซลล์</h3>
      <p class="sku">สร้างใบงาน/ใบเสนอราคางานโซล่าเซลล์</p>
    </div>

    <!-- ประเภทงาน -->
    <div class="panel">
      <div class="set-section-title">☀️ ประเภทงาน</div>
      <select id="solType">${typeOptions}</select>
      <div id="solCustomTypeWrap" class="hidden" style="margin-top:8px">
        <input type="text" id="solCustomType" placeholder="ระบุประเภทงาน..." />
      </div>
    </div>

    <!-- ข้อมูลลูกค้า -->
    <div class="panel">
      <div class="set-section-title">👤 ข้อมูลลูกค้า</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
        <div>
          <label class="set-field-label">ชื่อลูกค้า</label>
          <input type="text" id="solName" placeholder="ชื่อ-นามสกุล" />
        </div>
        <div>
          <label class="set-field-label">เบอร์โทร</label>
          <input type="tel" id="solPhone" placeholder="08X-XXXXXXX" />
        </div>
      </div>
      <label class="set-field-label" style="margin-top:8px">ที่อยู่</label>
      <textarea id="solAddress" rows="2" placeholder="บ้านเลขที่ หมู่ ตำบล อำเภอ จังหวัด" style="width:100%;border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit;resize:vertical"></textarea>
    </div>

    <!-- รายละเอียดงาน -->
    <div class="panel">
      <div class="set-section-title">⚡ รายละเอียดงาน</div>
      <textarea id="solDetail" rows="3" placeholder="เช่น ระบบ 3kW, จำนวนแผง 8 แผง, อินเวอร์เตอร์ยี่ห้อ..." style="width:100%;border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit;resize:vertical"></textarea>

      <div class="set-section-title" style="margin-top:14px">🔧 อุปกรณ์ / วัสดุ</div>
      <div id="solEquipList"></div>
      <button type="button" id="solAddEquip" class="btn light" style="margin-top:8px;font-size:13px">+ เพิ่มอุปกรณ์</button>
    </div>

    <!-- ราคา -->
    <div class="panel">
      <div class="set-section-title">💰 ราคาค่าบริการ</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
        <div>
          <label class="set-field-label">🔨 ค่าแรง/ค่าบริการ (฿)</label>
          <input type="number" id="solLabor" value="0" min="0" step="100" />
        </div>
        <div>
          <label class="set-field-label">💸 ส่วนลด (฿)</label>
          <input type="number" id="solDiscount" value="0" min="0" step="100" />
        </div>
      </div>
      <div id="solPriceSummary" style="margin-top:12px;text-align:center;background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:16px;padding:14px">
        <div class="sku">ราคารวม</div>
        <div style="font-size:32px;font-weight:900;color:#b45309">฿ 0</div>
      </div>
    </div>

    <!-- 🔚 ปิดงาน + แนบสลิป (Phase 88.12) -->
    <div class="panel" style="border:2px solid #fef3c7;background:#fffbeb">
      <div class="set-section-title" style="color:#78350f">🔚 ปิดงาน (กรณีงานเสร็จ + รับเงินแล้ว)</div>
      <div style="font-size:11px;color:#92400e;margin-bottom:10px;line-height:1.6">
        💡 ช่าง — เลือก <b>"📨 รออนุมัติ"</b> + แนบสลิป → ส่งให้แอดมินยืนยัน<br>
        แอดมิน — เลือก <b>"ส่งมอบแล้ว"</b> → ระบบลงรายได้อัตโนมัติ ✨
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:10px">
        <div>
          <label class="set-field-label">สถานะงาน</label>
          <select id="solStatusSel" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;font:inherit;background:#fff">
            <option value="pending">⏳ รอดำเนินการ</option>
            <option value="in_progress">🔄 กำลังดำเนินการ</option>
            <option value="done">✅ เสร็จแล้ว</option>
            <option value="pending_review">📨 รออนุมัติ</option>
            <option value="delivered">📦 ส่งมอบแล้ว (ลง JV ทันที)</option>
            <option value="closed">🎉 ปิดงาน + รับเงิน (ลง JV ทันที)</option>
          </select>
        </div>
        <div>
          <label class="set-field-label">วิธีรับเงิน</label>
          <select id="solPaymentMethod" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;font:inherit;background:#fff">
            <option value="">— ยังไม่ระบุ —</option>
            <option value="cash">💵 เงินสด → Dr 1110</option>
            <option value="transfer">🏦 โอน/QR → Dr 1130</option>
          </select>
        </div>
      </div>
      <label class="set-field-label" style="margin-top:6px">📷 แนบสลิป</label>
      <div id="solSlipPreview" style="margin-top:6px"></div>
      <input type="file" id="solSlipFile" accept="image/*" capture="environment" style="display:none" />
      <input type="file" id="solSlipGalleryFile" accept="image/*" style="display:none" />
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        <button type="button" id="solSlipCameraBtn" class="btn light" style="font-size:12px;padding:8px 14px">📷 ถ่ายรูป</button>
        <button type="button" id="solSlipGalleryBtn" class="btn light" style="font-size:12px;padding:8px 14px">🖼️ แกลลอรี่</button>
        <button type="button" id="solSlipVerifyBtn" class="btn light" style="font-size:12px;padding:8px 14px;display:none">🤖 ตรวจ AI</button>
      </div>
      <div id="solSlipVerifyResult" style="margin-top:8px"></div>
    </div>

    <!-- บันทึก -->
    <button id="solSaveBtn" class="set-save-btn">💾 บันทึกงานโซล่าเซลล์</button>
    <div id="solStatus" class="hidden panel mt16"></div>
  `;

  let equipCount = 0;

  function addEquipRow() {
    equipCount++;
    const div = document.createElement("div");
    div.style.cssText = "display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;align-items:end;margin-top:6px";
    div.innerHTML = `
      <input type="text" placeholder="ชื่ออุปกรณ์" class="sol-eq-name" />
      <input type="number" placeholder="ราคา/ชิ้น" min="0" step="100" value="0" class="sol-eq-price" />
      <input type="number" placeholder="จำนวน" min="1" value="1" class="sol-eq-qty" />
      <button type="button" class="btn danger-fill" style="padding:8px 12px;font-size:16px" data-remove-equip>✕</button>
    `;
    div.querySelector("[data-remove-equip]").addEventListener("click", () => { div.remove(); updatePrice(); });
    div.querySelectorAll("input").forEach(inp => inp.addEventListener("input", updatePrice));
    container.querySelector("#solEquipList").appendChild(div);
  }

  function updatePrice() {
    const labor = parseFloat(container.querySelector("#solLabor").value) || 0;
    const discount = parseFloat(container.querySelector("#solDiscount").value) || 0;
    let equipTotal = 0;
    container.querySelectorAll("#solEquipList > div").forEach(row => {
      const price = parseFloat(row.querySelector(".sol-eq-price")?.value) || 0;
      const qty = parseInt(row.querySelector(".sol-eq-qty")?.value) || 1;
      equipTotal += price * qty;
    });
    const net = Math.max(0, labor + equipTotal - discount);
    container.querySelector("#solPriceSummary").innerHTML = `
      <div class="sku">ราคารวม ${equipTotal > 0 ? `(ค่าแรง ${money(labor)} + อุปกรณ์ ${money(equipTotal)}${discount > 0 ? ` - ส่วนลด ${money(discount)}` : ""})` : ""}</div>
      <div style="font-size:32px;font-weight:900;color:#b45309">${money(net)}</div>
    `;
  }

  // Events
  container.querySelector("#solType").addEventListener("change", (e) => {
    container.querySelector("#solCustomTypeWrap").classList.toggle("hidden", !e.target.value.includes("อื่นๆ"));
  });
  container.querySelector("#solAddEquip").addEventListener("click", addEquipRow);
  container.querySelector("#solLabor").addEventListener("input", updatePrice);
  container.querySelector("#solDiscount").addEventListener("input", updatePrice);

  // Add 1 default row
  addEquipRow();

  // ★ Phase 88.12: Slip + AI verify
  let _slipUrl = "";
  const slipCameraEl  = container.querySelector("#solSlipFile");
  const slipGalleryEl = container.querySelector("#solSlipGalleryFile");
  const slipPreview   = container.querySelector("#solSlipPreview");
  const slipResult    = container.querySelector("#solSlipVerifyResult");
  const slipVerifyBtn = container.querySelector("#solSlipVerifyBtn");
  container.querySelector("#solSlipCameraBtn")?.addEventListener("click", () => slipCameraEl?.click());
  container.querySelector("#solSlipGalleryBtn")?.addEventListener("click", () => slipGalleryEl?.click());

  const _verifySolSlip = async (dataUrl) => {
    if (!slipResult) return;
    slipResult.innerHTML = `<div style="padding:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;color:#1e40af;font-size:12px">🤖 AI กำลังตรวจสลิป...</div>`;
    const expectedAmount = Number(container.querySelector("#solPriceSummary")?.textContent?.match(/[\d,]+/)?.[0]?.replace(/,/g,"") || 0);
    const expectedRecipient = (state?.profile?.shop_name || state?.storeInfo?.name || "บุญสุข").trim();
    try {
      const r = await fetch("/api/verify-slip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataUrl, expected_amount: expectedAmount, expected_recipient: expectedRecipient }) });
      const j = await r.json();
      if (!j.ok) { slipResult.innerHTML = `<div style="color:#dc2626;font-size:12px;padding:8px">❌ ${escHtml(j.error || "verify fail")}</div>`; return; }
      const d = j.data || {}, v = j.verification || {};
      const isSafe = v.is_safe === true;
      const wHtml = (v.warnings || []).map(w => `<div style="color:#b91c1c;font-size:11px">${escHtml(w)}</div>`).join("");
      const note = d.tampering_note || (d.tampering_signs?.[0]) || "";
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
          ${wHtml}${note?`<div style="font-size:10px;color:#92400e;margin-top:4px">• ${escHtml(note)}</div>`:''}
        </div>`;
    } catch(e) { slipResult.innerHTML = `<div style="color:#dc2626;font-size:12px;padding:8px">❌ ${escHtml(e.message)}</div>`; }
  };
  slipVerifyBtn?.addEventListener("click", async () => {
    if (!_slipUrl) return;
    try { const r = await fetch(_slipUrl); const blob = await r.blob(); const du = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); }); await _verifySolSlip(du); }
    catch(e) {}
  });
  const _onSlipPick = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      slipPreview.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:8px;background:#fff;border:1px solid #e2e8f0;border-radius:10px"><img src="${ev.target.result}" style="width:60px;height:60px;object-fit:cover;border-radius:6px" /><div style="flex:1"><div id="solSlipStatus" style="color:#0284c7;font-size:12px;font-weight:600">⏳ กำลังอัปโหลด...</div><div style="font-size:11px;color:#64748b">${escHtml(f.name)}</div></div></div>`;
    };
    reader.readAsDataURL(f);
    try {
      const cfg = window.SUPABASE_CONFIG;
      const token = window._sbAccessToken || cfg.anonKey;
      const ts = Date.now();
      const ext = (f.name.split(".").pop()||"jpg").toLowerCase();
      const fp = `service-slips/sol_${ts}_${Math.random().toString(36).slice(2,8)}.${ext}`;
      const upRes = await fetch(`${cfg.url}/storage/v1/object/proofs/${fp}`, { method: "POST", headers: { "apikey": cfg.anonKey, "Authorization": `Bearer ${token}`, "Content-Type": f.type||"image/jpeg", "x-upsert": "true" }, body: f });
      if (!upRes.ok) throw new Error("HTTP "+upRes.status);
      _slipUrl = `${cfg.url}/storage/v1/object/public/proofs/${fp}`;
      const s = container.querySelector("#solSlipStatus"); if (s) { s.textContent = "✅ อัปโหลดสำเร็จ"; s.style.color = "#059669"; }
      if (slipVerifyBtn) slipVerifyBtn.style.display = "inline-block";
      const pm = container.querySelector("#solPaymentMethod")?.value || "";
      if (/transfer|qr/.test(pm)) {
        const du = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
        await _verifySolSlip(du);
      }
    } catch(err) {
      const s = container.querySelector("#solSlipStatus"); if (s) { s.textContent = "⚠️ อัปโหลดล้มเหลว"; s.style.color = "#dc2626"; }
    }
  };
  slipCameraEl?.addEventListener("change", _onSlipPick);
  slipGalleryEl?.addEventListener("change", _onSlipPick);

  // Save
  container.querySelector("#solSaveBtn").addEventListener("click", async (e) => {
    const saveBtn = e.currentTarget;
    if (saveBtn.disabled) return;
    const typeVal = container.querySelector("#solType").value.includes("อื่นๆ")
      ? (container.querySelector("#solCustomType")?.value.trim() || container.querySelector("#solType").value)
      : container.querySelector("#solType").value;
    const name = container.querySelector("#solName").value.trim();
    const phone = container.querySelector("#solPhone").value.trim();
    const address = container.querySelector("#solAddress").value.trim();
    const detail = container.querySelector("#solDetail").value.trim();

    if (!name) return showToast("กรอกชื่อลูกค้า");

    saveBtn.disabled = true;
    const origText = saveBtn.textContent;
    saveBtn.textContent = "⏳ กำลังบันทึก...";

    const labor = parseFloat(container.querySelector("#solLabor").value) || 0;
    const discount = parseFloat(container.querySelector("#solDiscount").value) || 0;
    let equipTotal = 0;
    let equipNote = [];
    container.querySelectorAll("#solEquipList > div").forEach(row => {
      const eqName = row.querySelector(".sol-eq-name")?.value.trim();
      const price = parseFloat(row.querySelector(".sol-eq-price")?.value) || 0;
      const qty = parseInt(row.querySelector(".sol-eq-qty")?.value) || 1;
      if (eqName) {
        equipTotal += price * qty;
        equipNote.push(`${eqName} ${qty} ชิ้น = ฿${(price * qty).toLocaleString()}`);
      }
    });
    const net = Math.max(0, labor + equipTotal - discount);

    // Phase 88.12 — closure values
    const selectedStatus = container.querySelector("#solStatusSel")?.value || "pending";
    const paymentMethod  = container.querySelector("#solPaymentMethod")?.value || "";
    const COMPLETION_STATUSES = ["done","delivered","closed"];
    const isClosure = COMPLETION_STATUSES.includes(selectedStatus);

    const statusEl = container.querySelector("#solStatus");
    statusEl.classList.remove("hidden");
    statusEl.textContent = "กำลังบันทึก...";

    try {
      const cfg = window.SUPABASE_CONFIG;
      // ★ Phase 88.12: ใช้ token cache (เลี่ยง getSession() hang on slow mobile)
      const token = window._sbAccessToken || cfg.anonKey;

      const record = {
        job_no: "JOB-" + Date.now(),
        customer_name: name,
        customer_phone: phone,
        customer_address: address,
        job_type: "solar",
        description: [`☀️ ${typeVal}`, detail, equipNote.length ? `อุปกรณ์: ${equipNote.join(" | ")}` : ""].filter(Boolean).join(" | "),
        status: selectedStatus,
        note: `ค่าแรง: ฿${labor.toLocaleString()}${discount ? ` ส่วนลด: ฿${discount.toLocaleString()}` : ""}${container.querySelector("#solNote")?.value ? "\n" + container.querySelector("#solNote").value.trim() : ""}`,
        // Phase 88.12 — บัญชี
        total_cost: net,
        payment_method: paymentMethod || null,
        payment_slip_url: _slipUrl || null,
        closed_at: isClosure ? new Date().toISOString() : null
      };

      const resp = await fetch(`${cfg.url}/rest/v1/service_jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": cfg.anonKey,
          "Authorization": `Bearer ${token}`,
          "Prefer": "return=representation"  // ★ ขอ id กลับ
        },
        body: JSON.stringify(record)
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        console.error("[solar save fail]", resp.status, errBody);
        throw new Error("HTTP " + resp.status + ": " + errBody.slice(0, 200));
      }

      const inserted = await resp.json();
      const jobId = inserted?.[0]?.id;
      const jobNo = inserted?.[0]?.job_no || "";

      statusEl.innerHTML = `<div style="text-align:center;color:var(--success);font-weight:700">✅ บันทึกงานโซล่าเซลล์สำเร็จ!${jobNo ? ` (${escHtml(jobNo)})` : ""}</div>`;
      showToast("บันทึกสำเร็จ!");

      // ★ Phase 88.12: auto-post JV ถ้าปิดงานทันที
      if (jobId && isClosure) {
        postJournalForServiceJob({
          id: jobId,
          job_no: jobNo,
          customer_name: name,
          job_type: "solar",  // → mapping service_other (ไม่มี solar mapping เฉพาะ — fallback 4240)
          total_cost: net,
          status: selectedStatus,
          payment_method: paymentMethod,
          created_at: new Date().toISOString()
        }).catch(e => console.warn("[solar] auto-post JV failed:", e?.message));
      }
    } catch (e) {
      console.error("[solar save] error:", e);
      statusEl.textContent = "เกิดข้อผิดพลาด: " + e.message;
      showToast("บันทึกไม่สำเร็จ");
    } finally {
      if (saveBtn.isConnected) {
        saveBtn.disabled = false;
        saveBtn.textContent = origText;
      }
    }
  });
}
