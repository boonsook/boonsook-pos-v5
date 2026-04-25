// ═══════════════════════════════════════════════════════════
//  PHYSICAL STOCK COUNT — สแกน barcode → กรอกจำนวนนับจริง
//  → เทียบกับ system → adjust อัตโนมัติ
// ═══════════════════════════════════════════════════════════

function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}
function money(n) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}

// state ภายใน module
let _scWarehouseId = null;     // คลังที่กำลังนับ
let _scCounts = new Map();      // product_id → counted_qty (ภายใน session)
let _scScanner = null;          // html5 qrcode instance

export function renderStockCountPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-stock_count");
  if (!container) return;

  // initialize warehouse selection ครั้งแรก
  if (_scWarehouseId === null && (state.warehouses || []).length > 0) {
    const home = state.warehouses.find(w => (w.name || "").includes("บ้าน"));
    _scWarehouseId = String(home?.id || state.warehouses[0].id);
  }

  const counted = _scCounts.size;
  const totalProducts = (state.products || []).filter(p =>
    p.product_type !== "service" && p.product_type !== "non_stock"
  ).length;

  container.innerHTML = `
    <div style="max-width:900px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#dcfce7,#dbeafe);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">📊</div>
        <h2 style="margin:0 0 4px;color:#065f46">นับสต็อกจริง (Physical Count)</h2>
        <p style="margin:0;color:#1e40af;font-size:13px">สแกน barcode → กรอกจำนวนนับ → เทียบกับ system → ปรับให้ตรง</p>
      </div>

      <!-- Setup -->
      <div class="panel" style="padding:14px;margin-bottom:14px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;align-items:end">
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">คลังที่กำลังนับ:</label>
            <select id="scWarehouseSelect" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px">
              ${(state.warehouses || []).map(w => `<option value="${escHtml(w.id)}" ${String(w.id)===String(_scWarehouseId)?'selected':''}>${escHtml(w.name)}</option>`).join("")}
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">นับแล้ว: <span style="color:#0284c7">${counted}</span> / ${totalProducts}</label>
            <div style="background:#e2e8f0;border-radius:6px;height:10px;overflow:hidden">
              <div style="width:${totalProducts > 0 ? (counted/totalProducts*100).toFixed(0) : 0}%;background:linear-gradient(90deg,#10b981,#059669);height:100%;transition:width .3s"></div>
            </div>
          </div>
          <div style="display:flex;gap:6px">
            <button id="scScanBtn" class="btn primary" style="flex:1;font-size:13px">📷 เปิดสแกนเนอร์</button>
            <button id="scResetBtn" class="btn light" style="font-size:13px">🔄 ล้าง</button>
          </div>
        </div>
      </div>

      <!-- Manual Input -->
      <div class="panel" style="padding:14px;margin-bottom:14px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
          <div style="flex:2;min-width:200px">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">หรือพิมพ์ barcode/SKU:</label>
            <input id="scManualInput" type="text" placeholder="พิมพ์หรือสแกนด้วยปืนยิง..." style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
          </div>
          <div style="flex:1;min-width:120px">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">จำนวน:</label>
            <input id="scQtyInput" type="number" min="0" step="1" value="1" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
          </div>
          <button id="scAddBtn" class="btn dark" style="font-size:13px;padding:8px 14px">+ บันทึก</button>
        </div>
        <div style="font-size:11px;color:#64748b;margin-top:6px">💡 พิมพ์ barcode → Enter หรือกดปุ่มบันทึก (ปืนยิง barcode ก็ใช้ได้ — มันจะส่ง Enter อัตโนมัติ)</div>
      </div>

      <!-- Scanner Area -->
      <div id="scScannerArea" class="hidden" style="background:#000;border-radius:12px;padding:8px;margin-bottom:14px">
        <div id="scScannerVideo" style="border-radius:8px;overflow:hidden"></div>
        <div id="scScannerResult" style="color:#fff;text-align:center;padding:8px;font-size:13px"></div>
        <button id="scScannerCloseBtn" style="width:100%;padding:8px;background:#ef4444;color:#fff;border:none;border-radius:6px;margin-top:6px;cursor:pointer">ปิดสแกนเนอร์</button>
      </div>

      <!-- Counted List -->
      <div class="panel" style="padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0;font-size:15px">📋 รายการที่นับแล้ว (${counted})</h3>
          ${counted > 0 ? `<button id="scApplyAllBtn" class="btn primary" style="font-size:13px;padding:8px 16px">💾 บันทึกการปรับสต็อก</button>` : ''}
        </div>
        <div id="scCountedList" style="max-height:400px;overflow-y:auto"></div>
      </div>
    </div>
  `;

  renderCountedList(state);

  // ═══ Bindings ═══
  container.querySelector("#scWarehouseSelect")?.addEventListener("change", (e) => {
    _scWarehouseId = e.target.value;
    _scCounts.clear();
    renderStockCountPage(ctx);
  });

  container.querySelector("#scResetBtn")?.addEventListener("click", () => {
    if (_scCounts.size === 0) return;
    if (!confirm(`ล้างรายการที่นับแล้ว ${_scCounts.size} รายการ?`)) return;
    _scCounts.clear();
    renderStockCountPage(ctx);
  });

  container.querySelector("#scAddBtn")?.addEventListener("click", () => addByCode(ctx));
  container.querySelector("#scManualInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addByCode(ctx); }
  });

  container.querySelector("#scScanBtn")?.addEventListener("click", () => openScanner(ctx));
  container.querySelector("#scScannerCloseBtn")?.addEventListener("click", () => closeScanner(ctx));

  container.querySelector("#scApplyAllBtn")?.addEventListener("click", () => applyAllAdjustments(ctx));

  // Auto-focus manual input (สะดวกสำหรับปืนยิง barcode)
  setTimeout(() => container.querySelector("#scManualInput")?.focus(), 100);
}

function addByCode(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-stock_count");
  const codeInp = container.querySelector("#scManualInput");
  const qtyInp = container.querySelector("#scQtyInput");
  const code = (codeInp?.value || "").trim();
  const qty = parseInt(qtyInp?.value || "1", 10);

  if (!code) { showToast?.("กรอก barcode/SKU"); codeInp?.focus(); return; }
  if (isNaN(qty) || qty < 0) { showToast?.("จำนวนต้องเป็นตัวเลข ≥ 0"); return; }

  // Find product by barcode or SKU (case-insensitive)
  const c = code.toLowerCase();
  const prod = (state.products || []).find(p =>
    String(p.barcode || "").toLowerCase() === c ||
    String(p.sku || "").toLowerCase() === c
  );
  if (!prod) {
    showToast?.(`❌ ไม่พบสินค้า: ${code}`);
    codeInp.value = "";
    codeInp.focus();
    return;
  }
  if (prod.product_type === "service" || prod.product_type === "non_stock") {
    showToast?.(`⚠️ "${prod.name}" เป็น ${prod.product_type === "service" ? "บริการ" : "ไม่นับสต็อก"} — ข้าม`);
    codeInp.value = "";
    codeInp.focus();
    return;
  }

  // ★ ถ้านับซ้ำ — บวกเพิ่มเข้าไป (เช่น สินค้า 1 อันถูกแยกอยู่ในหลายชั้น)
  const prev = _scCounts.get(String(prod.id)) || 0;
  _scCounts.set(String(prod.id), prev + qty);

  showToast?.(`✓ ${prod.name} → ${prev + qty} ชิ้น`);
  codeInp.value = "";
  qtyInp.value = "1";
  codeInp.focus();
  renderStockCountPage(ctx);
}

function renderCountedList(state) {
  const container = document.getElementById("page-stock_count");
  const listEl = container?.querySelector("#scCountedList");
  if (!listEl) return;

  if (_scCounts.size === 0) {
    listEl.innerHTML = `<div style="text-align:center;padding:30px;color:#94a3b8;font-size:13px">ยังไม่มีรายการ — เริ่มสแกนหรือพิมพ์ barcode ด้านบน</div>`;
    return;
  }

  const rows = [..._scCounts.entries()].map(([pid, counted]) => {
    const p = (state.products || []).find(x => String(x.id) === String(pid));
    if (!p) return null;
    // หา system stock ตามคลังที่เลือก
    const ws = (state.warehouseStock || []).find(s =>
      String(s.product_id) === String(pid) && String(s.warehouse_id) === String(_scWarehouseId)
    );
    const sysStock = ws ? Number(ws.stock || 0) : 0;
    const diff = counted - sysStock;
    return { ...p, counted, sysStock, diff };
  }).filter(Boolean).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  listEl.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead style="background:#f1f5f9;position:sticky;top:0">
          <tr>
            <th style="padding:8px;text-align:left">สินค้า</th>
            <th style="padding:8px;text-align:right">ระบบ</th>
            <th style="padding:8px;text-align:right">นับจริง</th>
            <th style="padding:8px;text-align:right">ส่วนต่าง</th>
            <th style="padding:8px;text-align:center">ลบ</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const dColor = r.diff === 0 ? "#10b981" : (r.diff > 0 ? "#0284c7" : "#dc2626");
            const dIcon = r.diff === 0 ? "✓" : (r.diff > 0 ? "↑" : "↓");
            return `
              <tr style="border-bottom:1px solid #e5e7eb">
                <td style="padding:8px">
                  <div style="font-weight:600">${escHtml(r.name)}</div>
                  <div style="font-size:11px;color:#64748b">${escHtml(r.sku || "")}</div>
                </td>
                <td style="padding:8px;text-align:right;color:#64748b">${r.sysStock}</td>
                <td style="padding:8px;text-align:right;font-weight:700;color:#0f172a">${r.counted}</td>
                <td style="padding:8px;text-align:right;color:${dColor};font-weight:700">${dIcon} ${Math.abs(r.diff)}</td>
                <td style="padding:8px;text-align:center">
                  <button class="sc-remove-btn" data-pid="${escHtml(r.id)}" style="border:none;background:transparent;cursor:pointer;color:#ef4444;font-size:16px">×</button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;

  listEl.querySelectorAll(".sc-remove-btn").forEach(btn => btn.addEventListener("click", (e) => {
    const pid = btn.dataset.pid;
    _scCounts.delete(String(pid));
    renderCountedList(state);
    // Update progress
    const cnt = _scCounts.size;
    const totalProducts = (state.products || []).filter(p =>
      p.product_type !== "service" && p.product_type !== "non_stock"
    ).length;
    const counterEl = document.querySelector("#page-stock_count label[for], #page-stock_count .stat-label");
  }));
}

async function openScanner(ctx) {
  const container = document.getElementById("page-stock_count");
  const area = container.querySelector("#scScannerArea");
  area.classList.remove("hidden");

  if (typeof Html5Qrcode === "undefined") {
    container.querySelector("#scScannerResult").textContent = "❌ ระบบสแกนเนอร์ยังไม่พร้อม";
    return;
  }
  try {
    _scScanner = new Html5Qrcode("scScannerVideo");
    await _scScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 130 } },
      (decoded) => {
        const inp = container.querySelector("#scManualInput");
        if (inp) inp.value = decoded;
        addByCode(ctx);
      },
      () => {} // ignore errors
    );
  } catch (e) {
    container.querySelector("#scScannerResult").textContent = "❌ เปิดกล้องไม่ได้: " + (e.message || e);
  }
}

async function closeScanner(ctx) {
  if (_scScanner) {
    try {
      const state = _scScanner.getState();
      if (state === 2 || state === 3) await _scScanner.stop();
      await _scScanner.clear();
    } catch(e){}
    _scScanner = null;
  }
  const area = document.getElementById("scScannerArea");
  if (area) area.classList.add("hidden");
}

async function applyAllAdjustments(ctx) {
  const { state, showToast } = ctx;
  if (_scCounts.size === 0) return;

  const adjustList = [..._scCounts.entries()].map(([pid, counted]) => {
    const ws = (state.warehouseStock || []).find(s =>
      String(s.product_id) === String(pid) && String(s.warehouse_id) === String(_scWarehouseId)
    );
    const sys = ws ? Number(ws.stock || 0) : 0;
    return { pid, counted, sys, diff: counted - sys };
  });

  const changedCount = adjustList.filter(a => a.diff !== 0).length;
  if (changedCount === 0) {
    showToast?.("ทุกรายการตรงกันอยู่แล้ว — ไม่ต้องปรับ");
    return;
  }

  if (!confirm(`บันทึกการปรับสต็อก ${changedCount} รายการ?\n\nรายการที่ตรงกันแล้วจะไม่ถูกแตะต้อง`)) return;

  const btn = document.querySelector("#scApplyAllBtn");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }

  let ok = 0, fail = 0;
  for (const adj of adjustList) {
    if (adj.diff === 0) continue;
    const productIdNum = Number(adj.pid);
    const productId = Number.isFinite(productIdNum) && String(productIdNum) === String(adj.pid) ? productIdNum : adj.pid;
    const whIdNum = Number(_scWarehouseId);
    const warehouseId = Number.isFinite(whIdNum) && String(whIdNum) === String(_scWarehouseId) ? whIdNum : _scWarehouseId;

    try {
      const res = await window._appApplyStockMovement({
        productId,
        warehouseId,
        movementType: "adjust",
        qty: adj.counted,  // adjust = set to exact value
        note: `นับจริง (Physical Count) — เดิม ${adj.sys} → นับได้ ${adj.counted}`
      });
      if (res?.ok) ok++; else fail++;
    } catch(e) { fail++; }
  }

  if (btn) { btn.disabled = false; btn.textContent = "💾 บันทึกการปรับสต็อก"; }

  showToast?.(`✅ ปรับสต็อกสำเร็จ ${ok} รายการ${fail > 0 ? ` (ไม่สำเร็จ ${fail})` : ''}`);

  if (ok > 0) {
    _scCounts.clear();
    if (window.App?.loadAllData) await window.App.loadAllData();
    renderStockCountPage(ctx);
  }
}
