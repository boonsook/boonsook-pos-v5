// ═══════════════════════════════════════════════════════════
//  STOCK IN WIZARD — รับสินค้าจาก supplier หลายตัวพร้อมกัน
//  สแกน barcode ทีละตัว → กรอก qty + cost (option) → save batch
// ═══════════════════════════════════════════════════════════

function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}
function money(n) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}

// Module state
let _swRows = []; // [{ productId, name, sku, qty, cost, originalCost, note }]
let _swWarehouseId = null;
let _swSupplier = "";
let _swInvoiceNo = "";
let _swScanner = null;

export function renderStockInWizardPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-stock_in_wizard");
  if (!container) return;

  if (_swWarehouseId === null && (state.warehouses || []).length > 0) {
    const home = state.warehouses.find(w => (w.name || "").includes("บ้าน"));
    _swWarehouseId = String(home?.id || state.warehouses[0].id);
  }

  const totalItems = _swRows.length;
  const totalQty = _swRows.reduce((s, r) => s + Number(r.qty || 0), 0);
  const totalValue = _swRows.reduce((s, r) => s + (Number(r.qty || 0) * Number(r.cost || 0)), 0);

  container.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#dcfce7,#fef3c7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">🚛</div>
        <h2 style="margin:0 0 4px;color:#065f46">รับเข้าสินค้า (Stock IN Wizard)</h2>
        <p style="margin:0;color:#92400e;font-size:13px">รับสินค้าหลายตัวพร้อมกัน — สแกน/พิมพ์ barcode + กรอกจำนวน + cost (option)</p>
      </div>

      <!-- Setup -->
      <div class="panel" style="padding:14px;margin-bottom:14px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">คลังที่จะรับเข้า:</label>
            <select id="swWh" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px">
              ${(state.warehouses || []).map(w => `<option value="${escHtml(w.id)}" ${String(w.id)===String(_swWarehouseId)?'selected':''}>${escHtml(w.name)}</option>`).join("")}
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">ซัพพลายเออร์:</label>
            <input id="swSupplier" type="text" value="${escHtml(_swSupplier)}" placeholder="เช่น ABC Trading" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">เลขที่ใบกำกับ/ใบส่งของ:</label>
            <input id="swInvoiceNo" type="text" value="${escHtml(_swInvoiceNo)}" placeholder="เช่น INV-2026-001" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
          </div>
        </div>
      </div>

      <!-- Add row -->
      <div class="panel" style="padding:14px;margin-bottom:14px">
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;align-items:end">
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">📷 สแกน barcode/SKU:</label>
            <div style="display:flex;gap:6px">
              <input id="swSearchInput" type="text" placeholder="พิมพ์/สแกน barcode/SKU/ชื่อ..." style="flex:1;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
              <button id="swScanBtn" class="btn light" style="font-size:12px;padding:8px 10px" title="เปิดกล้อง">📷</button>
            </div>
            <div id="swSearchSuggest" style="position:relative"></div>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">จำนวน:</label>
            <input id="swQty" type="number" min="1" step="1" value="1" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-weight:700;text-align:center" />
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">ต้นทุน/ชิ้น (option):</label>
            <input id="swCost" type="number" min="0" step="0.01" placeholder="ใช้ cost เดิม" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
          </div>
          <button id="swAddBtn" class="btn primary" style="padding:8px 14px;height:fit-content;align-self:end">+ เพิ่ม</button>
        </div>
        <div style="font-size:11px;color:#64748b;margin-top:6px">💡 ปืนยิง barcode → พิมพ์เลข + Enter → เพิ่มอัตโนมัติ</div>
      </div>

      <!-- Scanner -->
      <div id="swScannerArea" class="hidden" style="background:#000;border-radius:12px;padding:8px;margin-bottom:14px">
        <div id="swScannerVideo" style="border-radius:8px;overflow:hidden"></div>
        <button id="swScannerCloseBtn" style="width:100%;padding:8px;background:#ef4444;color:#fff;border:none;border-radius:6px;margin-top:6px;cursor:pointer">ปิดสแกนเนอร์</button>
      </div>

      <!-- Items list -->
      <div class="panel" style="padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
          <h3 style="margin:0;font-size:15px">📦 รายการรับเข้า (${totalItems} รายการ • ${totalQty} ชิ้น • มูลค่ารวม ฿${money(totalValue)})</h3>
          ${totalItems > 0 ? `
            <div style="display:flex;gap:6px">
              <button id="swClearBtn" class="btn light" style="font-size:12px">🔄 ล้างทั้งหมด</button>
              <button id="swSaveBtn" class="btn primary" style="font-size:13px;padding:8px 16px">💾 บันทึกการรับเข้า (${totalItems})</button>
            </div>
          ` : ''}
        </div>
        <div id="swList"></div>
      </div>
    </div>
  `;

  renderList(state);

  // Bindings
  container.querySelector("#swWh")?.addEventListener("change", (e) => { _swWarehouseId = e.target.value; });
  container.querySelector("#swSupplier")?.addEventListener("input", (e) => { _swSupplier = e.target.value; });
  container.querySelector("#swInvoiceNo")?.addEventListener("input", (e) => { _swInvoiceNo = e.target.value; });

  container.querySelector("#swSearchInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addRow(ctx); }
  });
  container.querySelector("#swAddBtn")?.addEventListener("click", () => addRow(ctx));
  container.querySelector("#swScanBtn")?.addEventListener("click", () => openScanner(ctx));
  container.querySelector("#swScannerCloseBtn")?.addEventListener("click", () => closeScanner(ctx));

  container.querySelector("#swClearBtn")?.addEventListener("click", async () => {
    if (_swRows.length === 0) return;
    if (!(await window.App?.confirm?.(`ล้างรายการรับเข้า ${_swRows.length} รายการ?`))) return;
    _swRows = [];
    renderStockInWizardPage(ctx);
  });

  container.querySelector("#swSaveBtn")?.addEventListener("click", () => saveAll(ctx));

  setTimeout(() => container.querySelector("#swSearchInput")?.focus(), 100);
}

function addRow(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-stock_in_wizard");
  const inp = container.querySelector("#swSearchInput");
  const qty = parseInt(container.querySelector("#swQty").value, 10);
  const costRaw = container.querySelector("#swCost").value;
  const code = (inp.value || "").trim();

  if (!code) { showToast?.("พิมพ์/สแกน barcode/SKU"); inp.focus(); return; }
  if (isNaN(qty) || qty <= 0) { showToast?.("จำนวนต้องมากกว่า 0"); return; }

  // หา product
  const c = code.toLowerCase();
  let prod = (state.products || []).find(p =>
    String(p.barcode || "").toLowerCase() === c ||
    String(p.sku || "").toLowerCase() === c
  );
  if (!prod) {
    // search by name
    prod = (state.products || []).find(p => String(p.name || "").toLowerCase().includes(c));
  }
  if (!prod) {
    showToast?.(`❌ ไม่พบสินค้า: ${code}`);
    inp.focus();
    return;
  }
  if (prod.product_type === "service") {
    showToast?.(`⚠️ "${prod.name}" เป็นบริการ — ข้าม`);
    return;
  }

  // ★ ถ้ามีอยู่แล้ว — รวม qty + ใช้ cost ใหม่ถ้ากรอก
  const existing = _swRows.find(r => String(r.productId) === String(prod.id));
  if (existing) {
    existing.qty += qty;
    if (costRaw) existing.cost = Number(costRaw);
  } else {
    _swRows.push({
      productId: prod.id,
      name: prod.name,
      sku: prod.sku || "",
      barcode: prod.barcode || "",
      qty,
      cost: costRaw ? Number(costRaw) : Number(prod.cost || 0),
      originalCost: Number(prod.cost || 0)
    });
  }

  showToast?.(`✓ ${prod.name} ${qty} ชิ้น`);
  inp.value = "";
  container.querySelector("#swQty").value = "1";
  container.querySelector("#swCost").value = "";
  inp.focus();
  renderStockInWizardPage(ctx);
}

function renderList(state) {
  const listEl = document.querySelector("#page-stock_in_wizard #swList");
  if (!listEl) return;

  if (_swRows.length === 0) {
    listEl.innerHTML = `<div style="text-align:center;padding:30px;color:#94a3b8;font-size:13px">ยังไม่มีรายการ — สแกน/พิมพ์ barcode ด้านบน</div>`;
    return;
  }

  listEl.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead style="background:#f1f5f9">
          <tr>
            <th style="padding:8px;text-align:left">สินค้า</th>
            <th style="padding:8px;text-align:right">จำนวน</th>
            <th style="padding:8px;text-align:right">ต้นทุน/ชิ้น</th>
            <th style="padding:8px;text-align:right">รวม</th>
            <th style="padding:8px;text-align:center">ลบ</th>
          </tr>
        </thead>
        <tbody>
          ${_swRows.map((r, idx) => {
            const costChanged = r.cost !== r.originalCost && r.originalCost > 0;
            return `
              <tr style="border-bottom:1px solid #e5e7eb">
                <td style="padding:8px">
                  <div style="font-weight:600">${escHtml(r.name)}</div>
                  <div style="font-size:11px;color:#64748b">${escHtml(r.sku || "")} ${r.barcode ? "• " + escHtml(r.barcode) : ""}</div>
                </td>
                <td style="padding:8px;text-align:right">
                  <input class="sw-qty-edit" data-idx="${idx}" type="number" min="1" step="1" value="${r.qty}" style="width:70px;padding:4px;border:1px solid #cbd5e1;border-radius:6px;text-align:center;font-weight:700" />
                </td>
                <td style="padding:8px;text-align:right">
                  <input class="sw-cost-edit" data-idx="${idx}" type="number" min="0" step="0.01" value="${r.cost}" style="width:90px;padding:4px;border:1px solid ${costChanged ? '#f59e0b' : '#cbd5e1'};border-radius:6px;text-align:right" title="${costChanged ? 'ต้นทุนเปลี่ยน (เดิม ฿' + r.originalCost + ')' : ''}" />
                  ${costChanged ? `<div style="font-size:10px;color:#f59e0b">เดิม ฿${r.originalCost}</div>` : ''}
                </td>
                <td style="padding:8px;text-align:right;font-weight:700;color:#059669">฿${money(r.qty * r.cost)}</td>
                <td style="padding:8px;text-align:center">
                  <button class="sw-remove" data-idx="${idx}" style="border:none;background:transparent;cursor:pointer;color:#ef4444;font-size:16px">×</button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;

  // Bindings for inline edit
  listEl.querySelectorAll(".sw-qty-edit").forEach(inp => inp.addEventListener("change", () => {
    const i = Number(inp.dataset.idx);
    const v = parseInt(inp.value, 10);
    if (isNaN(v) || v <= 0) { inp.value = _swRows[i].qty; return; }
    _swRows[i].qty = v;
    renderStockInWizardPage({ state }); // re-render for total update
  }));
  listEl.querySelectorAll(".sw-cost-edit").forEach(inp => inp.addEventListener("change", () => {
    const i = Number(inp.dataset.idx);
    const v = Number(inp.value);
    if (isNaN(v) || v < 0) { inp.value = _swRows[i].cost; return; }
    _swRows[i].cost = v;
    renderStockInWizardPage({ state });
  }));
  listEl.querySelectorAll(".sw-remove").forEach(btn => btn.addEventListener("click", () => {
    const i = Number(btn.dataset.idx);
    _swRows.splice(i, 1);
    renderStockInWizardPage({ state });
  }));
}

async function openScanner(ctx) {
  const container = document.getElementById("page-stock_in_wizard");
  const area = container.querySelector("#swScannerArea");
  area.classList.remove("hidden");

  if (typeof Html5Qrcode === "undefined") return;
  try {
    _swScanner = new Html5Qrcode("swScannerVideo");
    await _swScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 130 } },
      (decoded) => {
        const inp = container.querySelector("#swSearchInput");
        if (inp) inp.value = decoded;
        addRow(ctx);
      },
      () => {}
    );
  } catch (e) {
    console.warn("[scanner]", e);
  }
}

async function closeScanner(ctx) {
  if (_swScanner) {
    try {
      const state = _swScanner.getState();
      if (state === 2 || state === 3) await _swScanner.stop();
      await _swScanner.clear();
    } catch(e){}
    _swScanner = null;
  }
  document.getElementById("swScannerArea")?.classList.add("hidden");
}

async function saveAll(ctx) {
  const { state, showToast } = ctx;
  if (_swRows.length === 0) return;

  const totalItems = _swRows.length;
  const totalQty = _swRows.reduce((s, r) => s + r.qty, 0);
  const totalValue = _swRows.reduce((s, r) => s + r.qty * r.cost, 0);

  const whName = state.warehouses.find(w => String(w.id) === String(_swWarehouseId))?.name || "?";
  const summary = `บันทึกการรับเข้า ${totalItems} รายการ • ${totalQty} ชิ้น • ฿${money(totalValue)} • คลัง: ${whName}${_swSupplier ? ' • ' + _swSupplier : ''}${_swInvoiceNo ? ' • ' + _swInvoiceNo : ''} — ดำเนินการต่อ?`;
  if (!(await window.App?.confirm?.(summary))) return;

  const btn = document.querySelector("#swSaveBtn");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }

  const whIdNum = Number(_swWarehouseId);
  const warehouseId = Number.isFinite(whIdNum) && String(whIdNum) === String(_swWarehouseId) ? whIdNum : _swWarehouseId;
  const noteCommon = `รับเข้า: ${_swSupplier || "ไม่ระบุ supplier"}${_swInvoiceNo ? " (Inv " + _swInvoiceNo + ")" : ""}`;

  let ok = 0, fail = 0;
  for (const r of _swRows) {
    try {
      const res = await window._appApplyStockMovement({
        productId: r.productId,
        warehouseId,
        movementType: "in",
        qty: r.qty,
        note: noteCommon
      });
      if (!res?.ok) { fail++; continue; }

      // อัพเดทต้นทุนถ้าเปลี่ยน
      if (r.cost !== r.originalCost && r.cost >= 0) {
        const cfg = window.SUPABASE_CONFIG;
        const accessToken = window._sbAccessToken || cfg.anonKey;
        await new Promise(resolve => {
          const xhr = new XMLHttpRequest();
          xhr.open("PATCH", cfg.url + "/rest/v1/products?id=eq." + encodeURIComponent(r.productId));
          xhr.setRequestHeader("Content-Type", "application/json");
          xhr.setRequestHeader("apikey", cfg.anonKey);
          xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
          xhr.setRequestHeader("Prefer", "return=minimal");
          xhr.timeout = 8000;
          xhr.onload = () => resolve();
          xhr.onerror = () => resolve();
          xhr.ontimeout = () => resolve();
          xhr.send(JSON.stringify({ cost: r.cost }));
        });
      }
      ok++;
    } catch(e) { fail++; }
  }

  if (btn) { btn.disabled = false; btn.textContent = "💾 บันทึกการรับเข้า"; }
  showToast?.(`✅ รับเข้าสำเร็จ ${ok}/${totalItems}${fail > 0 ? ` (ล้มเหลว ${fail})` : ''}`);

  if (ok > 0) {
    _swRows = [];
    _swInvoiceNo = "";
    if (window.App?.loadAllData) await window.App.loadAllData();
    renderStockInWizardPage(ctx);
  }
}
