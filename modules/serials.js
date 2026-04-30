// ═══════════════════════════════════════════════════════════
//  SERIAL NUMBER TRACKING (Phase 19)
//  บันทึก serial ตอนขายเครื่องใช้ไฟฟ้า + ค้นหา/เคลม warranty
//  Phase 47 — adopt ui_states (skeleton/empty/error)
// ═══════════════════════════════════════════════════════════
import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";

function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}

const STATUS_META = {
  active:    { label: "ใช้งาน",       color: "#10b981", icon: "✓" },
  claimed:   { label: "กำลังเคลม",    color: "#f59e0b", icon: "🔧" },
  replaced:  { label: "เปลี่ยนแล้ว",  color: "#0284c7", icon: "🔄" },
  expired:   { label: "หมดประกัน",    color: "#94a3b8", icon: "⏱️" }
};

let _srSearch = "";
let _srStatusFilter = "all"; // all | active | claimed | replaced | expired
let _srResults = null;

export async function renderSerialsPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-serials");
  if (!container) return;

  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  const today = new Date().toISOString().slice(0, 10);

  // โหลด serials ตาม filter
  let url = cfg.url + "/rest/v1/product_serials?select=*&order=created_at.desc&limit=200";
  if (_srStatusFilter !== "all") url += "&status=eq." + _srStatusFilter;
  if (_srSearch) url += "&or=(serial_no.ilike.*" + encodeURIComponent(_srSearch) + "*,product_name.ilike.*" + encodeURIComponent(_srSearch) + "*,customer_name.ilike.*" + encodeURIComponent(_srSearch) + "*)";

  container.innerHTML = renderSkeleton({ type: "table", count: 5 });

  try {
    const res = await fetch(url, { headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + accessToken } });
    if (!res.ok) {
      container.innerHTML = renderError({
        message: "ตาราง product_serials ยังไม่มี",
        detail: "รัน supabase-rls-policies.sql ก่อน (HTTP " + res.status + ")",
        retryLabel: "ลองโหลดใหม่",
        retryId: "srRetryBtn"
      });
      document.getElementById("srRetryBtn")?.addEventListener("click", () => renderSerialsPage(ctx));
      return;
    }
    _srResults = await res.json();
  } catch(e) {
    container.innerHTML = renderError({
      message: "โหลดข้อมูลไม่สำเร็จ",
      detail: e?.message || String(e),
      retryLabel: "ลองใหม่",
      retryId: "srRetryBtn"
    });
    document.getElementById("srRetryBtn")?.addEventListener("click", () => renderSerialsPage(ctx));
    return;
  }

  // Stats
  const total = _srResults.length;
  const activeCount = _srResults.filter(s => s.status === "active").length;
  const claimCount = _srResults.filter(s => s.status === "claimed").length;
  const expiredSoon = _srResults.filter(s => s.status === "active" && s.warranty_until && s.warranty_until < new Date(Date.now() + 30*24*60*60*1000).toISOString().slice(0,10)).length;

  container.innerHTML = `
    <div style="max-width:1200px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#dbeafe,#dcfce7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">🔢</div>
        <h2 style="margin:0 0 4px;color:#1e40af">Serial Number Tracking</h2>
        <p style="margin:0;color:#065f46;font-size:13px">บันทึก serial เครื่องใช้ไฟฟ้า • ค้นหา • track warranty • รับเคลม</p>
      </div>

      <!-- Stats -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:14px">
        <div class="stat-card" style="border-left:4px solid #10b981">
          <div class="stat-label">✓ ใช้งาน</div>
          <div class="stat-value" style="color:#059669">${activeCount}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <div class="stat-label">🔧 กำลังเคลม</div>
          <div class="stat-value" style="color:#92400e">${claimCount}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #dc2626">
          <div class="stat-label">⚠️ ประกันใกล้หมด (30 วัน)</div>
          <div class="stat-value" style="color:#dc2626">${expiredSoon}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #0284c7">
          <div class="stat-label">📊 ทั้งหมด</div>
          <div class="stat-value" style="color:#0284c7">${total}</div>
        </div>
      </div>

      <!-- Search + Filter -->
      <div class="panel" style="padding:14px;margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input id="srSearchInput" type="text" placeholder="🔍 ค้นหา serial / สินค้า / ลูกค้า..." value="${escHtml(_srSearch)}" style="flex:1;min-width:200px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        <button id="srSearchBtn" class="btn primary" style="font-size:13px">ค้นหา</button>
        <span style="font-weight:600;font-size:13px;margin-left:10px">สถานะ:</span>
        ${[["all","ทั้งหมด"],["active","✓ ใช้งาน"],["claimed","🔧 เคลม"],["replaced","🔄 เปลี่ยน"],["expired","⏱️ หมดประกัน"]].map(([k,l]) => `
          <button class="sr-filter-btn" data-f="${k}" style="padding:6px 12px;border-radius:14px;border:1px solid ${_srStatusFilter===k?'#0284c7':'#cbd5e1'};background:${_srStatusFilter===k?'#0284c7':'#fff'};color:${_srStatusFilter===k?'#fff':'#475569'};cursor:pointer;font-size:12px">${l}</button>
        `).join("")}
        <button id="srAddBtn" class="btn light" style="font-size:13px;margin-left:auto">+ เพิ่ม Serial</button>
      </div>

      <!-- List -->
      <div class="panel" style="padding:0">
        ${_srResults.length === 0 ? renderEmpty({
          icon: _srSearch ? '🔍' : '🔢',
          title: _srSearch ? `ไม่พบ "${_srSearch}"` : 'ยังไม่มี serial',
          message: _srSearch ? 'ลองเปลี่ยนคำค้นหา หรือเลือกตัวกรองสถานะอื่น' : 'เปิดบิลที่ขายเครื่องใช้ไฟฟ้า → กรอก serial ที่นั่น หรือกดปุ่มด้านล่าง',
          actionLabel: _srSearch ? '' : '+ เพิ่ม Serial',
          actionId: _srSearch ? '' : 'srEmptyAddBtn'
        }) : `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead style="background:#f1f5f9">
              <tr>
                <th style="padding:10px;text-align:left">Serial No.</th>
                <th style="padding:10px;text-align:left">สินค้า</th>
                <th style="padding:10px;text-align:left">ลูกค้า</th>
                <th style="padding:10px;text-align:left">วันหมดประกัน</th>
                <th style="padding:10px;text-align:center">สถานะ</th>
                <th style="padding:10px;text-align:center"></th>
              </tr>
            </thead>
            <tbody>
              ${_srResults.map(s => {
                const m = STATUS_META[s.status || "active"];
                const isWarrantyExpired = s.warranty_until && s.warranty_until < today;
                const isExpiringSoon = s.warranty_until && !isWarrantyExpired && s.warranty_until < new Date(Date.now() + 30*24*60*60*1000).toISOString().slice(0,10);
                const wColor = isWarrantyExpired ? "#dc2626" : isExpiringSoon ? "#f59e0b" : "#10b981";
                return `
                  <tr style="border-bottom:1px solid #e5e7eb">
                    <td style="padding:10px;font-family:monospace;font-weight:700;color:#0c4a6e">${escHtml(s.serial_no)}</td>
                    <td style="padding:10px">
                      <div style="font-weight:600">${escHtml(s.product_name || '-')}</div>
                    </td>
                    <td style="padding:10px">
                      <div style="font-weight:600">${escHtml(s.customer_name || '-')}</div>
                      <div style="font-size:11px;color:#64748b">${s.created_at ? new Date(s.created_at).toLocaleDateString("th-TH") : ''}</div>
                    </td>
                    <td style="padding:10px">
                      <div style="color:${wColor};font-weight:700;font-size:13px">${s.warranty_until || 'ไม่ระบุ'}</div>
                      ${isWarrantyExpired ? '<div style="font-size:11px;color:#dc2626">⚠️ หมดประกันแล้ว</div>' : isExpiringSoon ? '<div style="font-size:11px;color:#f59e0b">⏰ ใกล้หมด</div>' : ''}
                    </td>
                    <td style="padding:10px;text-align:center">
                      <span style="background:${m.color};color:#fff;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700">${m.icon} ${m.label}</span>
                    </td>
                    <td style="padding:10px;text-align:center;white-space:nowrap">
                      <button class="sr-edit-btn" data-id="${s.id}" style="border:1px solid #cbd5e1;background:#fff;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px">✏️</button>
                      <button class="sr-claim-btn" data-id="${s.id}" style="border:none;background:#f59e0b;color:#fff;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px;margin-left:4px" title="รับเคลม">🔧</button>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
        `}
      </div>

      <!-- Help -->
      <div style="margin-top:14px;padding:12px;background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;font-size:12px;color:#075985;line-height:1.6">
        💡 <b>วิธีใช้:</b> ตอนขายเครื่องใช้ไฟฟ้าราคาแพง (แอร์/ทีวี/ตู้เย็น) → กดปุ่ม "+ เพิ่ม Serial" → เลือกบิล + กรอก serial + วันหมดประกัน<br>
        🔧 ลูกค้ามาเคลม → ค้นหาด้วย serial → ดูประวัติการซื้อ + warranty → กด 🔧 เพื่อเปลี่ยนสถานะเป็น "กำลังเคลม"
      </div>
    </div>
  `;

  container.querySelector("#srSearchBtn")?.addEventListener("click", () => {
    _srSearch = container.querySelector("#srSearchInput").value.trim();
    renderSerialsPage(ctx);
  });
  container.querySelector("#srSearchInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") container.querySelector("#srSearchBtn").click();
  });
  container.querySelectorAll(".sr-filter-btn").forEach(btn => btn.addEventListener("click", () => {
    _srStatusFilter = btn.dataset.f;
    renderSerialsPage(ctx);
  }));
  container.querySelector("#srAddBtn")?.addEventListener("click", () => openSerialModal(ctx, null));
  container.querySelector("#srEmptyAddBtn")?.addEventListener("click", () => openSerialModal(ctx, null));
  container.querySelectorAll(".sr-edit-btn").forEach(btn => btn.addEventListener("click", () => {
    const s = _srResults.find(x => String(x.id) === String(btn.dataset.id));
    if (s) openSerialModal(ctx, s);
  }));
  container.querySelectorAll(".sr-claim-btn").forEach(btn => btn.addEventListener("click", () => {
    const s = _srResults.find(x => String(x.id) === String(btn.dataset.id));
    if (s) updateStatus(ctx, s.id, "claimed");
  }));
}

function openSerialModal(ctx, s) {
  const { state } = ctx;
  document.getElementById("srModal")?.remove();
  const isEdit = !!s;

  // โหลด recent sales for picker
  const recentSales = (state.sales || [])
    .filter(x => !(x.note || "").includes("[ลบแล้ว]"))
    .slice(0, 30);

  const modal = document.createElement("div");
  modal.id = "srModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;padding:20px">
      <h3 style="margin:0 0 14px">${isEdit?'✏️ แก้ไข':'+ บันทึก'} Serial Number</h3>
      <div style="display:grid;gap:10px">
        <div>
          <label style="font-size:12px;font-weight:700">Serial No: <span style="color:#dc2626">*</span></label>
          <div style="display:flex;gap:6px">
            <input id="srNo" type="text" value="${escHtml(s?.serial_no || '')}" placeholder="พิมพ์ หรือสแกน barcode" style="flex:1;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-family:monospace;font-weight:700" />
            <button id="srScanBtn" type="button" style="padding:10px 14px;border:none;background:#0284c7;color:#fff;border-radius:8px;cursor:pointer;font-weight:700;white-space:nowrap" title="สแกน barcode/QR ด้วยกล้อง">📷</button>
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px">💡 บนมือถือกด 📷 → เปิดกล้อง → จ่อที่ barcode/QR</div>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700">บิลขายที่ผูก (option):</label>
          <select id="srSale" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
            <option value="">— ไม่ผูกบิล —</option>
            ${recentSales.map(x => `<option value="${x.id}" ${s?.sale_id==x.id?'selected':''}>${escHtml(x.order_no)} • ${escHtml(x.customer_name||'-')} • ${new Date(x.created_at).toLocaleDateString("th-TH")}</option>`).join("")}
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:12px;font-weight:700">ชื่อสินค้า:</label>
            <input id="srProductName" type="text" value="${escHtml(s?.product_name || '')}" placeholder="ชื่อสินค้า" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px" />
          </div>
          <div>
            <label style="font-size:12px;font-weight:700">ชื่อลูกค้า:</label>
            <input id="srCustomerName" type="text" value="${escHtml(s?.customer_name || '')}" placeholder="ชื่อลูกค้า" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px" />
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:12px;font-weight:700">วันหมดประกัน:</label>
            <input id="srWarranty" type="date" value="${s?.warranty_until || ''}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px" />
          </div>
          <div>
            <label style="font-size:12px;font-weight:700">สถานะ:</label>
            <select id="srStatus" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
              ${Object.entries(STATUS_META).map(([k,v]) => `<option value="${k}" ${(s?.status||'active')===k?'selected':''}>${v.icon} ${v.label}</option>`).join("")}
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700">หมายเหตุ:</label>
          <textarea id="srNotes" rows="2" placeholder="ปัญหาที่เคยมี / หมายเหตุเพิ่มเติม" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-family:inherit;resize:vertical">${escHtml(s?.notes || '')}</textarea>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button id="srCancel" style="flex:1;padding:10px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer">ยกเลิก</button>
        <button id="srSave" style="flex:1;padding:10px;border:none;background:#0284c7;color:#fff;border-radius:8px;cursor:pointer;font-weight:700">${isEdit?'💾 บันทึก':'+ บันทึก'}</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  setTimeout(() => modal.querySelector("#srNo")?.focus(), 50);

  // Phase 23: Barcode/QR scanner
  modal.querySelector("#srScanBtn")?.addEventListener("click", async () => {
    const srNoInput = modal.querySelector("#srNo");
    await openBarcodeScanner((code) => {
      if (srNoInput) {
        srNoInput.value = code;
        srNoInput.focus();
      }
      ctx.showToast?.("✓ สแกน: " + code);
    }, ctx);
  });

  // Auto-fill จากบิลที่เลือก
  modal.querySelector("#srSale")?.addEventListener("change", (e) => {
    const sale = recentSales.find(x => String(x.id) === e.target.value);
    if (sale) {
      const items = (state.saleItems || []).filter(it => String(it.sale_id) === String(sale.id));
      if (items.length > 0 && !modal.querySelector("#srProductName").value) {
        modal.querySelector("#srProductName").value = items[0].product_name || "";
      }
      if (!modal.querySelector("#srCustomerName").value) {
        modal.querySelector("#srCustomerName").value = sale.customer_name || "";
      }
    }
  });

  modal.querySelector("#srCancel").addEventListener("click", () => modal.remove());
  modal.querySelector("#srSave").addEventListener("click", async () => {
    const serialNo = modal.querySelector("#srNo").value.trim();
    if (!serialNo) { ctx.showToast?.("กรอก serial number ก่อน", "warn"); return; }

    const saleVal = modal.querySelector("#srSale").value;
    const sale = saleVal ? recentSales.find(x => String(x.id) === saleVal) : null;
    const payload = {
      serial_no: serialNo,
      sale_id: sale?.id || null,
      customer_id: sale?.customer_id || null,
      product_name: modal.querySelector("#srProductName").value.trim() || null,
      customer_name: modal.querySelector("#srCustomerName").value.trim() || null,
      warranty_until: modal.querySelector("#srWarranty").value || null,
      status: modal.querySelector("#srStatus").value,
      notes: modal.querySelector("#srNotes").value.trim() || null
    };

    const cfg = window.SUPABASE_CONFIG;
    const accessToken = window._sbAccessToken || cfg.anonKey;
    const url = cfg.url + "/rest/v1/product_serials" + (s ? "?id=eq."+s.id : "");
    try {
      const r = await fetch(url, {
        method: s ? "PATCH" : "POST",
        headers: { "Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      modal.remove();
      ctx.showToast?.(s ? "✓ บันทึกแก้ไข" : "✓ เพิ่ม serial");
      renderSerialsPage(ctx);
    } catch (e) { ctx.showToast?.("ผิดพลาด: " + (e?.message || e), "error"); }
  });
}

async function updateStatus(ctx, id, newStatus) {
  if (!(await window.App?.confirm?.(`เปลี่ยนสถานะเป็น "${STATUS_META[newStatus].label}"?`))) return;
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  await fetch(cfg.url + "/rest/v1/product_serials?id=eq." + id, {
    method: "PATCH",
    headers: { "Content-Type":"application/json","apikey":cfg.anonKey,"Authorization":"Bearer "+accessToken,"Prefer":"return=minimal" },
    body: JSON.stringify({ status: newStatus })
  });
  ctx.showToast?.(`✓ เปลี่ยนสถานะ → ${STATUS_META[newStatus].label}`);
  renderSerialsPage(ctx);
}

// ═══════════════════════════════════════════════════════════
// Phase 23 — Barcode/QR Scanner
// ใช้ BarcodeDetector API (Chrome/Edge/Android) — fallback แสดง camera + manual entry
// ═══════════════════════════════════════════════════════════
export async function openBarcodeScanner(onDetected, ctx) {
  document.getElementById("snScanModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "snScanModal";
  modal.style.cssText = "position:fixed;inset:0;background:#000;z-index:10001;display:flex;flex-direction:column;align-items:center;justify-content:center";
  modal.innerHTML = `
    <div style="position:absolute;top:0;left:0;right:0;padding:14px;background:linear-gradient(180deg,rgba(0,0,0,0.7),transparent);color:#fff;display:flex;align-items:center;gap:10px;z-index:10">
      <button id="snScanClose" style="border:none;background:rgba(255,255,255,0.2);color:#fff;width:36px;height:36px;border-radius:50%;font-size:20px;cursor:pointer">×</button>
      <div style="font-weight:700">📷 สแกน Barcode / QR Code</div>
      <div id="snScanStatus" style="margin-left:auto;font-size:12px;opacity:0.8">เปิดกล้อง...</div>
    </div>

    <video id="snScanVideo" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;background:#000"></video>

    <div style="position:absolute;left:0;right:0;bottom:0;padding:16px;background:linear-gradient(0deg,rgba(0,0,0,0.85),transparent)">
      <div style="background:rgba(255,255,255,0.95);border-radius:10px;padding:12px;max-width:480px;margin:0 auto">
        <div style="font-size:12px;color:#475569;margin-bottom:6px">หรือพิมพ์เอง:</div>
        <div style="display:flex;gap:6px">
          <input id="snScanManual" type="text" placeholder="พิมพ์ Serial Number" style="flex:1;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-family:monospace;font-weight:700" />
          <button id="snScanManualOk" style="padding:10px 16px;border:none;background:#0284c7;color:#fff;border-radius:8px;cursor:pointer;font-weight:700">ใช้</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const video = modal.querySelector("#snScanVideo");
  const statusEl = modal.querySelector("#snScanStatus");
  let stream = null;
  let detector = null;
  let scanning = true;
  let rafId = null;

  const cleanup = () => {
    scanning = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) {
      try { stream.getTracks().forEach(t => t.stop()); } catch(e){}
    }
    modal.remove();
  };

  modal.querySelector("#snScanClose").addEventListener("click", cleanup);
  modal.querySelector("#snScanManualOk").addEventListener("click", () => {
    const v = modal.querySelector("#snScanManual").value.trim();
    if (v) { onDetected(v); cleanup(); }
  });
  modal.querySelector("#snScanManual").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      modal.querySelector("#snScanManualOk").click();
    }
  });

  // Try open camera
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      statusEl.textContent = "⚠️ Browser ไม่รองรับกล้อง — พิมพ์ด้านล่างได้";
      return;
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" } // กล้องหลังบนมือถือ
    });
    video.srcObject = stream;
    statusEl.textContent = "🔍 กำลังหา barcode...";

    // Try BarcodeDetector API
    if ("BarcodeDetector" in window) {
      try {
        detector = new window.BarcodeDetector({
          formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "data_matrix"]
        });
        const tick = async () => {
          if (!scanning) return;
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length > 0) {
              const code = codes[0].rawValue;
              if (code) {
                statusEl.textContent = "✓ เจอแล้ว: " + code;
                onDetected(code);
                setTimeout(cleanup, 300);
                return;
              }
            }
          } catch(e) { /* ignore frame errors */ }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch(e) {
        statusEl.textContent = "⚠️ Detector error — พิมพ์ด้านล่าง";
      }
    } else {
      statusEl.textContent = "⚠️ Browser ไม่รองรับ auto-scan — พิมพ์ด้านล่าง (กล้องช่วยอ่าน)";
    }
  } catch(e) {
    statusEl.textContent = "⚠️ เปิดกล้องไม่ได้: " + (e?.message || e);
    if (e?.name === "NotAllowedError") {
      statusEl.textContent = "⚠️ ปฏิเสธการใช้กล้อง — เปลี่ยน permission ใน browser settings";
    }
  }
}

