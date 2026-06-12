// ═══════════════════════════════════════════════════════════
//  SOLAR — งานโซล่าเซลล์
//  Phase 88.12: + ปิดงาน/แนบสลิป/AI verify (workflow ช่างส่ง→admin ยืนยัน)
//  Phase 88.13: ลิ้งอุปกรณ์กับสต็อก (warehouse) + ตัดสต็อกอัตโนมัติตอน save
// ═══════════════════════════════════════════════════════════

import { postJournalForServiceJob } from "./accounting/auto_post.js";
import { aggregateNeedByKey } from "./stock_precheck.js";
import { normalizeServiceJobStatus, serviceJobNoteWithReviewMarker } from "./service_status.js";
import { applyDraftFields, bindServiceDraft, clearServiceDraft, loadServiceDraft } from "./service_drafts.js";

const SOLAR_TYPES = [
  "💧 ติดตั้งปั๊มน้ำโซล่าเซลล์",
  "⚡ ติดตั้งชุดออนกริดโซล่าเซลล์",
  "🔋 ติดตั้งชุดออฟกริดโซล่าเซลล์",
  "🌐 ติดตั้งชุดไฮบริดโซล่าเซลล์",
  "🔌 ซ่อม & เซอร์วิสระบบโซล่าเซลล์",
  "🛠️ งานโซล่าเซลล์อื่นๆ"
];

// Phase 88.13 — Module-level state สำหรับอุปกรณ์ที่ลิ้งกับสต็อก
// items: [{product_id, name, qty, unit_price, line_total, warehouse_id, warehouse_name}]
let _solItems = [];

const escHtml = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const SOLAR_DRAFT_KEY = "solar";
const SOLAR_DRAFT_FIELDS = [
  ["#solType", "type"],
  ["#solCustomType", "customType"],
  ["#solName", "name"],
  ["#solPhone", "phone"],
  ["#solAddress", "address"],
  ["#solDetail", "detail"],
  ["#solLabor", "labor"],
  ["#solDiscount", "discount"],
  ["#solStatusSel", "status"],
  ["#solPaymentMethod", "paymentMethod"]
];

// ═══════════════════════════════════════════════════════════
//  Phase 88.13 — Mobile warehouse helpers (duplicate from ac_install.js)
// ═══════════════════════════════════════════════════════════

function _solGetMobileWarehouses(state) {
  return (state.warehouses || []).filter(w => w.is_mobile === true);
}

function _solGetHomeWarehouse(state) {
  const wh = state.warehouses || [];
  return wh.find(w => (w.name || "").includes("บ้าน")) ||
         wh.find(w => w.is_mobile !== true) ||
         null;
}

function _solGetMobileStocks(p, state) {
  const mobileWh = _solGetMobileWarehouses(state);
  return mobileWh
    .map(w => {
      const ws = (state.warehouseStock || []).find(s =>
        String(s.product_id) === String(p.id) && String(s.warehouse_id) === String(w.id)
      );
      return { warehouse_id: w.id, warehouse_name: w.name, stock: Number(ws?.stock || 0) };
    })
    .filter(s => s.stock > 0);
}

function _solGetHomeStock(p, state) {
  const home = _solGetHomeWarehouse(state);
  if (!home) return null;
  const ws = (state.warehouseStock || []).find(s =>
    String(s.product_id) === String(p.id) && String(s.warehouse_id) === String(home.id)
  );
  return { warehouse_id: home.id, warehouse_name: home.name, stock: Number(ws?.stock || 0) };
}

// ═══════════════════════════════════════════════════════════
//  Phase 88.13 — Mobile warehouse picker modal
// ═══════════════════════════════════════════════════════════
function _solPickMobileWarehouse(mobileStocks, productName) {
  return new Promise((resolve) => {
    document.getElementById("solWhPickModal")?.remove();
    const modal = document.createElement("div");
    modal.id = "solWhPickModal";
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
          <button id="solWhPickCancel" style="width:100%;padding:10px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:10px;cursor:pointer;font:inherit;color:#64748b">ยกเลิก</button>
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
    modal.querySelector("#solWhPickCancel").addEventListener("click", () => { cleanup(); resolve(null); });
    modal.addEventListener("click", (e) => { if (e.target === modal) { cleanup(); resolve(null); } });
  });
}

// ═══════════════════════════════════════════════════════════
//  Phase 88.13 — Items list rendering + binding
// ═══════════════════════════════════════════════════════════
function _solRenderItemsList(container, money) {
  const el = container.querySelector("#solItemsList");
  if (!el) return;
  if (_solItems.length === 0) {
    el.innerHTML = `<div class="sku" style="text-align:center;padding:14px;color:#94a3b8">ยังไม่มีอุปกรณ์ — กด "+ เพิ่มอุปกรณ์"</div>`;
    return;
  }
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
          ${_solItems.map((it, idx) => {
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
                  <button type="button" data-sol-qty-dec="${idx}" style="width:26px;height:26px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;color:#475569" title="ลด">−</button>
                  <input type="number" min="1" value="${it.qty}" data-sol-qty="${idx}" style="width:42px;text-align:center;padding:4px 0;border:1px solid #cbd5e1;border-radius:6px;font-weight:700" />
                  <button type="button" data-sol-qty-inc="${idx}" style="width:26px;height:26px;border:1px solid #0284c7;background:#0284c7;color:#fff;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer" title="เพิ่ม">+</button>
                </div>
              </td>
              <td style="padding:6px"><input type="number" min="0" step="1" value="${Number(it.unit_price)}" data-sol-price="${idx}" style="width:80px;text-align:right;padding:4px;border:1px solid #cbd5e1;border-radius:6px" /></td>
              <td data-sol-line-total="${idx}" style="padding:8px;text-align:right;font-weight:700;color:#0284c7">${money(it.line_total)}</td>
              <td style="padding:6px;text-align:center"><button data-sol-del="${idx}" class="btn light" style="font-size:14px;padding:2px 8px;color:#dc2626" title="ลบ">×</button></td>
            </tr>
          `;}).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function _solBindItemListEvents(container, updatePrice, money) {
  const updateLineTotal = (idx) => {
    const cell = container.querySelector(`[data-sol-line-total="${idx}"]`);
    if (cell) cell.textContent = money(_solItems[idx].line_total);
  };
  container.querySelector("#solItemsList")?.addEventListener("input", (e) => {
    const tgt = e.target;
    if (tgt.dataset.solQty !== undefined) {
      const idx = Number(tgt.dataset.solQty);
      const qty = Math.max(1, parseInt(tgt.value) || 1);
      _solItems[idx].qty = qty;
      _solItems[idx].line_total = qty * Number(_solItems[idx].unit_price || 0);
      updateLineTotal(idx);
      updatePrice();
      container.dispatchEvent(new Event("input"));
    } else if (tgt.dataset.solPrice !== undefined) {
      const idx = Number(tgt.dataset.solPrice);
      const price = Math.max(0, parseFloat(tgt.value) || 0);
      _solItems[idx].unit_price = price;
      _solItems[idx].line_total = Number(_solItems[idx].qty) * price;
      updateLineTotal(idx);
      updatePrice();
      container.dispatchEvent(new Event("input"));
    }
  });
  container.querySelector("#solItemsList")?.addEventListener("click", (e) => {
    const delBtn = e.target.closest("[data-sol-del]");
    if (delBtn) {
      const idx = Number(delBtn.dataset.solDel);
      _solItems.splice(idx, 1);
      _solRenderItemsList(container, money);
      updatePrice();
      container.dispatchEvent(new Event("input"));
      return;
    }
    const incBtn = e.target.closest("[data-sol-qty-inc]");
    if (incBtn) {
      const idx = Number(incBtn.dataset.solQtyInc);
      _solItems[idx].qty = Number(_solItems[idx].qty || 1) + 1;
      _solItems[idx].line_total = _solItems[idx].qty * Number(_solItems[idx].unit_price || 0);
      const qtyInput = container.querySelector(`[data-sol-qty="${idx}"]`);
      if (qtyInput) qtyInput.value = _solItems[idx].qty;
      updateLineTotal(idx);
      updatePrice();
      container.dispatchEvent(new Event("input"));
      return;
    }
    const decBtn = e.target.closest("[data-sol-qty-dec]");
    if (decBtn) {
      const idx = Number(decBtn.dataset.solQtyDec);
      _solItems[idx].qty = Math.max(1, Number(_solItems[idx].qty || 1) - 1);
      _solItems[idx].line_total = _solItems[idx].qty * Number(_solItems[idx].unit_price || 0);
      const qtyInput = container.querySelector(`[data-sol-qty="${idx}"]`);
      if (qtyInput) qtyInput.value = _solItems[idx].qty;
      updateLineTotal(idx);
      updatePrice();
      container.dispatchEvent(new Event("input"));
      return;
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  Phase 88.13 — Picker modal: search + select equipment from stock
// ═══════════════════════════════════════════════════════════
function _solOpenItemPicker(ctx, container, updatePrice, saveDraftNow) {
  const { state, money, showToast } = ctx;
  document.getElementById("solItemPickerModal")?.remove();

  // กรองเฉพาะสินค้าที่มีใน mobile (รถ) หรือบ้าน (เผื่อ auto-transfer)
  const allInStock = (state.products || []).filter(p => {
    const mobileTotal = _solGetMobileStocks(p, state).reduce((s, x) => s + x.stock, 0);
    const homeStock = _solGetHomeStock(p, state)?.stock || 0;
    return (mobileTotal + homeStock) > 0;
  });

  const renderList = (search) => {
    const q = (search || "").toLowerCase().trim();
    let filtered = allInStock;
    if (q) {
      filtered = allInStock.filter(p =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.barcode || "").toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q)
      );
    }
    return filtered.slice(0, 50).map(p => {
      const mobileStocks = _solGetMobileStocks(p, state);
      const homeStock = _solGetHomeStock(p, state);
      const inMobile = mobileStocks.length > 0;
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
        <button class="solpk-item" data-pk-id="${p.id}" style="display:block;width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;cursor:pointer;text-align:left;font:inherit;margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;color:#0f172a">${escHtml(p.name || "-")}</div>
              <div style="font-size:11px;color:#64748b">${escHtml(p.category || "")}${p.barcode ? ` • ${escHtml(p.barcode)}` : ""}</div>
              <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${stockTags}${homeTag}</div>
              ${warningBadge}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-weight:700;color:#0284c7">${money(p.price || 0)}</div>
            </div>
          </div>
        </button>
      `;
    }).join("") || `<div class="sku" style="text-align:center;padding:20px;color:#94a3b8">ไม่พบสินค้า "${escHtml(q)}"</div>`;
  };

  const modal = document.createElement("div");
  modal.id = "solItemPickerModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:500px;width:100%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0;font-size:16px">☀️ เลือกอุปกรณ์โซล่าเซลล์</h3>
        <button id="solpkClose" class="btn light" style="font-size:18px;padding:4px 10px">✕</button>
      </div>
      <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0">
        <input id="solpkSearch" type="text" placeholder="🔍 ค้นหา ชื่อ / barcode / หมวด..." style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit" />
      </div>
      <div id="solpkList" style="flex:1;overflow-y:auto;padding:12px 16px"></div>
    </div>
  `;
  document.body.appendChild(modal);

  const listEl = modal.querySelector("#solpkList");
  listEl.innerHTML = renderList("");

  modal.querySelector("#solpkClose").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector("#solpkSearch").addEventListener("input", (e) => {
    listEl.innerHTML = renderList(e.target.value);
  });

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-pk-id]");
    if (!btn) return;
    const id = btn.dataset.pkId;
    const p = (state.products || []).find(x => String(x.id) === String(id));
    if (!p) return;

    const mobileStocks = _solGetMobileStocks(p, state);
    const homeStock = _solGetHomeStock(p, state);

    let chosenWh = null;
    if (mobileStocks.length === 1) {
      chosenWh = mobileStocks[0];
    } else if (mobileStocks.length > 1) {
      chosenWh = await _solPickMobileWarehouse(mobileStocks, p.name);
      if (!chosenWh) {
        showToast?.("ยกเลิก");
        return;
      }
    } else if (homeStock && homeStock.stock > 0) {
      chosenWh = homeStock;
      showToast?.(`⚠️ ${p.name} ยังอยู่ในบ้าน — จะถามยืนยันโอนตอนบันทึก`);
    } else {
      showToast?.("ไม่มีของในระบบ");
      return;
    }

    const existing = _solItems.find(it =>
      String(it.product_id) === String(p.id) &&
      String(it.warehouse_id) === String(chosenWh.warehouse_id)
    );
    if (existing) {
      existing.qty = Number(existing.qty) + 1;
      existing.line_total = existing.qty * Number(existing.unit_price || 0);
    } else {
      _solItems.push({
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
    modal.remove();
    _solRenderItemsList(container, money);
    updatePrice();
    saveDraftNow?.();
    showToast?.(`เพิ่ม "${p.name}" จาก ${chosenWh.warehouse_name} แล้ว`);
  });

  setTimeout(() => modal.querySelector("#solpkSearch")?.focus(), 100);
}

export function renderSolarPage(ctx) {
  const { state, money, showToast } = ctx;
  const container = document.getElementById("page-solar");
  if (!container) return;

  const draft = loadServiceDraft(SOLAR_DRAFT_KEY);
  _solItems = Array.isArray(draft?.items) ? draft.items.map(it => ({ ...it })) : [];

  const typeOptions = SOLAR_TYPES.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join("");

  container.innerHTML = `
    <div class="panel">
      <h3 style="color:var(--primary2);margin-bottom:4px">☀️ งานโซล่าเซลล์</h3>
      <p class="sku">สร้างใบงาน/ใบเสนอราคางานโซล่าเซลล์</p>
      <button id="solAiBtn" type="button" aria-label="AI ช่วยกรอกใบงานนี้"
        style="margin-top:10px;display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border:none;border-radius:12px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer">🤖 AI ช่วยกรอกใบงานนี้</button>
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
    </div>

    <!-- 🔧 อุปกรณ์ / วัสดุ (Phase 88.13: ลิ้งกับสต็อก) -->
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="set-section-title" style="margin:0">🔧 อุปกรณ์ / วัสดุ (จากสต็อก)</div>
        <button id="solAddItemBtn" class="btn primary" style="font-size:12px;padding:6px 12px">+ เพิ่มอุปกรณ์</button>
      </div>
      <div id="solItemsList"></div>
      <div style="font-size:11px;color:#94a3b8;margin-top:6px">💡 แผงโซล่า / อินเวอร์เตอร์ / สายไฟ / โครงเหล็ก — เพิ่มเป็นอุปกรณ์จากสต็อก (ตัดสต็อกอัตโนมัติตอนบันทึก)</div>
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
          </select>
          <!-- Phase 88.15: ลบ delivered/closed ออก — admin only ใน drawer ใบรับงาน -->
          <!-- ช่างใช้ "📨 รออนุมัติ" + แนบสลิป → admin approve → JV เกิด -->
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

  applyDraftFields(container, draft, SOLAR_DRAFT_FIELDS);
  container.querySelector("#solCustomTypeWrap")?.classList.toggle("hidden", !container.querySelector("#solType")?.value.includes("อื่นๆ"));
  // Render initial items list
  _solRenderItemsList(container, money);
  const saveDraftNow = bindServiceDraft(container, SOLAR_DRAFT_KEY, SOLAR_DRAFT_FIELDS, () => ({ items: _solItems }));

  function updatePrice() {
    const labor = parseFloat(container.querySelector("#solLabor").value) || 0;
    const discount = parseFloat(container.querySelector("#solDiscount").value) || 0;
    const equipTotal = _solItems.reduce((s, it) => s + Number(it.line_total || 0), 0);
    const net = Math.max(0, labor + equipTotal - discount);
    container.querySelector("#solPriceSummary").innerHTML = `
      <div class="sku">ราคารวม ${equipTotal > 0 ? `(ค่าแรง ${money(labor)} + อุปกรณ์ ${money(equipTotal)}${discount > 0 ? ` - ส่วนลด ${money(discount)}` : ""})` : ""}</div>
      <div style="font-size:32px;font-weight:900;color:#b45309">${money(net)}</div>
    `;
  }

  // Events
  container.querySelector("#solAiBtn")?.addEventListener("click", () => window.BoonsookAI?.open());
  container.querySelector("#solType").addEventListener("change", (e) => {
    container.querySelector("#solCustomTypeWrap").classList.toggle("hidden", !e.target.value.includes("อื่นๆ"));
  });
  container.querySelector("#solAddItemBtn").addEventListener("click", () => _solOpenItemPicker(ctx, container, updatePrice, saveDraftNow));
  _solBindItemListEvents(container, updatePrice, money);
  container.querySelector("#solLabor").addEventListener("input", updatePrice);
  container.querySelector("#solDiscount").addEventListener("input", updatePrice);

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
    // ★ Phase 92.66: /api/verify-slip อยู่ใน REQUIRE_AUTH_ENDPOINTS — ต้องแนบ Supabase JWT ของ staff ที่ login
    //   (anonKey เป็น sb_publishable_... ไม่ใช่ JWT → verifyAuthToken reject = 401). ไม่มี token/หมดอายุ → ขอ login ใหม่
    const _slipToken = window._sbAccessToken;
    const _slipAuthErrHtml = `<div style="padding:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:12px">🔒 ต้องเข้าสู่ระบบก่อนตรวจสลิป — เซสชันหมดอายุหรือยังไม่ได้ล็อกอิน กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง</div>`;
    if (!_slipToken) { slipResult.innerHTML = _slipAuthErrHtml; return; }
    slipResult.innerHTML = `<div style="padding:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;color:#1e40af;font-size:12px">🤖 AI กำลังตรวจสลิป...</div>`;
    const expectedAmount = Number(container.querySelector("#solPriceSummary")?.textContent?.match(/[\d,]+/)?.[0]?.replace(/,/g,"") || 0);
    const expectedRecipient = (state?.profile?.shop_name || state?.storeInfo?.name || "บุญสุข").trim();
    try {
      const r = await fetch("/api/verify-slip", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + _slipToken }, body: JSON.stringify({ image: dataUrl, expected_amount: expectedAmount, expected_recipient: expectedRecipient }) });
      // 401 = token หมดอายุ/ถูกเพิกถอนระหว่างทาง → ขอ login ใหม่ แทน error กว้าง ๆ
      // eslint-disable-next-line require-atomic-updates -- E: single slip-verify per click (auth re-login)
      if (r.status === 401) { slipResult.innerHTML = _slipAuthErrHtml; return; }
      const j = await r.json();
      // eslint-disable-next-line require-atomic-updates -- E: single slip-verify per click (verify button)
      if (!j.ok) { slipResult.innerHTML = `<div style="color:#dc2626;font-size:12px;padding:8px">❌ ${escHtml(j.error || "verify fail")}</div>`; return; }
      const d = j.data || {}, v = j.verification || {};
      const isSafe = v.is_safe === true;
      const wHtml = (v.warnings || []).map(w => `<div style="color:#b91c1c;font-size:11px">${escHtml(w)}</div>`).join("");
      const note = d.tampering_note || (d.tampering_signs?.[0]) || "";
      // eslint-disable-next-line require-atomic-updates -- E: single slip-verify per click (verify button)
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
    // eslint-disable-next-line require-atomic-updates -- E: single slip-verify per click (error path)
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
    const equipTotal = _solItems.reduce((s, it) => s + Number(it.line_total || 0), 0);
    const equipNote = _solItems.map(it => `${it.name} ${it.qty} ชิ้น = ฿${Number(it.line_total).toLocaleString()}`);
    const net = Math.max(0, labor + equipTotal - discount);

    // Phase 88.12 — closure values
    const selectedStatus = container.querySelector("#solStatusSel")?.value || "pending";
    const paymentMethod  = container.querySelector("#solPaymentMethod")?.value || "";
    // Phase 88.15: ฟอร์มช่างไม่ trigger JV เอง — JV เกิดผ่าน admin drawer (approve banner)
    // เดิม: ["done","delivered","closed"] → ตอนนี้ [] (ปลอดภัยกว่า — กัน JV เกิด 2 ครั้ง)
    const COMPLETION_STATUSES = [];
    const isClosure = COMPLETION_STATUSES.includes(selectedStatus);

    const statusEl = container.querySelector("#solStatus");
    statusEl.classList.remove("hidden");
    statusEl.textContent = "📋 กำลังตรวจสอบข้อมูล...";

    try {
      const cfg = window.SUPABASE_CONFIG;
      // ★ Phase 88.12: ใช้ token cache (เลี่ยง getSession() hang on slow mobile)
      const token = window._sbAccessToken || cfg.anonKey;

      // Phase 88.13 — เตรียม fullItems + transfer-needed (pattern เหมือน ac_install)
      const mobileWhList = _solGetMobileWarehouses(state);
      const homeWh = _solGetHomeWarehouse(state);
      const fullItems = [];
      _solItems.forEach(it => {
        const isPickedHome = homeWh && String(it.warehouse_id) === String(homeWh.id);
        if (isPickedHome && mobileWhList.length > 0) {
          // user pick "บ้าน" → re-pick เป็น mobile แรก (force transfer flow)
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

      // ★ Phase 88.13: เช็คก่อน save — ของในรถพอมั้ย? ถ้าไม่พอ + บ้านมี → confirm auto-transfer
      const transfersNeeded = [];
      // Phase 372: รวม qty ต่อ (product+warehouse) — กันสินค้าเดียวกันหลาย line รวมเกินสต็อก (เดิมเช็คทีละ line)
      const _needByKey = aggregateNeedByKey(fullItems);
      const _checkedKeys = new Set();
      for (const it of fullItems) {
        if (!it.warehouse_id || !it.product_id) continue;
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
          const isHome = homeWh && String(it.warehouse_id) === String(homeWh.id);
          if (isHome) {
            // Phase 370: เลือกคลังบ้าน แต่บ้านไม่พอ → block save (เดิม continue = save แล้ว deduct fail เงียบ)
            throw new Error(`❌ ${prod.name}: ของไม่พอ — คลังบ้านมี ${stockAvail}, ต้องใช้ ${need} (เติมสต็อกก่อนบันทึก)`);
          }
          const homeStock = _solGetHomeStock(prod, state);
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

      if (transfersNeeded.length > 0) {
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
      statusEl.textContent = "💾 กำลังบันทึกใบงาน...";

      const record = {
        job_no: "JOB-" + Date.now(),
        customer_name: name,
        customer_phone: phone,
        customer_address: address,
        job_type: "solar",
        description: [`☀️ ${typeVal}`, detail, equipNote.length ? `อุปกรณ์: ${equipNote.join(" | ")}` : ""].filter(Boolean).join(" | "),
        items_json: fullItems,  // ★ Phase 88.13: เก็บ items ใน DB
        status: normalizeServiceJobStatus(selectedStatus), // Phase 383: DB-safe (กัน 400 23514)
        note: serviceJobNoteWithReviewMarker(`ค่าแรง: ฿${labor.toLocaleString()}${discount ? ` ส่วนลด: ฿${discount.toLocaleString()}` : ""}`, selectedStatus),
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

      // ★ Phase 88.14: Optimistic update — push job ใหม่เข้า state.serviceJobs
      // (เดิมไม่ push → หน้าใบรับงานไม่เห็น job จนกว่าจะ refresh page)
      try {
        if (inserted?.[0]) {
          state.serviceJobs = [inserted[0], ...(state.serviceJobs || [])];
        }
      } catch(e) { console.warn("[solar] state update fail", e); }

      // ★ Phase 88.13: Auto-transfer (ถ้ามี) → ตัดสต็อก
      statusEl.textContent = "🔄 กำลังโอน/ตัดสต็อก...";
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
              note: `auto-transfer for solar ${jobNo}`
            });
            if (!r?.ok) {
              console.error("[solar transfer fail]", t, r);
              stockOpsFailed = true;
            }
          }
        }
        // Step 2: Deduct stock จาก warehouse ที่เลือก (ทุก item)
        for (const it of fullItems) {
          if (!it.warehouse_id || !it.product_id) continue;
          if (typeof window._appApplyStockMovement === "function") {
            const r = await window._appApplyStockMovement({
              productId: it.product_id,
              warehouseId: it.warehouse_id,
              movementType: "out",
              qty: Number(it.qty || 0),
              note: `solar: ${jobNo} — ${name}`
            });
            if (!r?.ok) {
              console.error("[solar deduct fail]", it, r);
              stockOpsFailed = true;
            }
          }
        }
      } catch (stockErr) {
        console.error("[solar stock ops]", stockErr);
        stockOpsFailed = true;
      }

      // Phase 88.13: optimistic update state.warehouseStock (ไม่ await loadAllData)
      try {
        for (const it of fullItems) {
          if (!it.warehouse_id || !it.product_id) continue;
          const ws = (state.warehouseStock || []).find(w =>
            String(w.product_id) === String(it.product_id) &&
            String(w.warehouse_id) === String(it.warehouse_id)
          );
          if (ws) ws.stock = Math.max(0, Number(ws.stock || 0) - Number(it.qty || 0));
        }
      } catch(e) { console.warn("[solar] optimistic stock update fail", e); }

      if (stockOpsFailed) {
        showToast?.("⚠️ ใบงาน save แล้ว แต่ตัดสต็อก/โอนบางรายการล้มเหลว — ตรวจ Console");
      }

      statusEl.innerHTML = `<div style="text-align:center;color:var(--success);font-weight:700">✅ บันทึกงานโซล่าเซลล์สำเร็จ!${jobNo ? ` (${escHtml(jobNo)})` : ""}</div>`;
      showToast("บันทึกสำเร็จ!");
      clearServiceDraft(SOLAR_DRAFT_KEY);

      // ★ Phase 88.12: auto-post JV ถ้าปิดงานทันที
      if (jobId && isClosure) {
        void (async () => {
          const postRes = await postJournalForServiceJob({
            id: jobId,
            job_no: jobNo,
            customer_name: name,
            job_type: "solar",  // Phase 88.16 → mapping service_solar → Cr 4300
            total_cost: net,
            status: selectedStatus,
            payment_method: paymentMethod,
            created_at: new Date().toISOString()
          }, { detailed: true });
          if (postRes?.status === "failed") {
            console.warn("[solar] auto-post JV failed:", postRes.reason, postRes.error || "");
            showToast("บันทึกใบงานแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจ Service Reconcile/Backfill", "warn");
          }
        })().catch(e => {
          console.warn("[solar] auto-post JV failed:", e?.message);
          showToast("บันทึกใบงานแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ — ตรวจ Service Reconcile/Backfill", "warn");
        });
      }

      // Phase 88.13: เคลียร์ items + reset price (กรณี user save แล้วทำใบใหม่)
      // eslint-disable-next-line require-atomic-updates -- LOW_RISK: L3 module state reset after save (single save button per form)
      _solItems = [];
      _solRenderItemsList(container, money);
      updatePrice();
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
