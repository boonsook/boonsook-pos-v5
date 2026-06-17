// ═══════════════════════════════════════════════════════════
//  SERVICE EQUIPMENT — อุปกรณ์จากสต็อก สำหรับ drawer "เพิ่มงานช่าง" (main.js)
//  Phase 402 (MONEY/STOCK §4.1+§4.2) — deduct-only scope
//
//  ขอบเขต (owner-approved): picker เลือกสินค้า + คลังที่ "มีสต็อกอยู่แล้ว" + qty
//    → ตัดสต็อกตอนสร้างงานใหม่ ผ่าน window._appApplyStockMovement (CAS/floor)
//    + precheck ด้วย aggregateNeedByKey (กันรวมเกินสต็อก)
//  ❌ ไม่มี auto-transfer บ้าน→รถ (อันนั้นอยู่ใน service_form.js) — cross-warehouse
//     transfer + แก้/คืนอะไหล่หลังบันทึก = future phase
//
//  module นี้ import โดย main.js เท่านั้น — service_form.js ไม่ถูกแตะ (live money path)
// ═══════════════════════════════════════════════════════════
import { escHtml } from "./utils.js";
import { aggregateNeedByKey } from "./stock_precheck.js";

// ── pure helpers ─────────────────────────────────────────────
// คลังทั้งหมดที่มีสต็อก > 0 ของสินค้า p (mobile หรือ home — ไม่กรองชนิด)
export function warehouseStockOptions(p, state) {
  return (state.warehouses || []).map(w => {
    const ws = (state.warehouseStock || []).find(s =>
      String(s.product_id) === String(p.id) && String(s.warehouse_id) === String(w.id));
    return {
      warehouse_id: w.id,
      warehouse_name: w.name,
      is_mobile: w.is_mobile === true,
      stock: Number(ws?.stock || 0)
    };
  }).filter(o => o.stock > 0);
}

export function equipmentTotal(items) {
  return (items || []).reduce((s, it) => s + Number(it.line_total || 0), 0);
}

// precheck: รวม qty ต่อ (product|warehouse) เทียบสต็อกจริง → { ok, shortages[] }
export function precheckEquipmentStock(items, state) {
  const needByKey = aggregateNeedByKey(items);
  const shortages = [];
  const checked = new Set();
  for (const it of (items || [])) {
    if (!it || !it.warehouse_id || !it.product_id) continue;
    const key = `${it.product_id}|${it.warehouse_id}`;
    if (checked.has(key)) continue;
    checked.add(key);
    const ws = (state.warehouseStock || []).find(w =>
      String(w.product_id) === String(it.product_id) && String(w.warehouse_id) === String(it.warehouse_id));
    const avail = Number(ws?.stock || 0);
    const need = needByKey.get(key) || 0;
    if (avail < need) shortages.push({ name: it.name, warehouse_name: it.warehouse_name, need, avail });
  }
  return { ok: shortages.length === 0, shortages };
}

// fullItems สำหรับ items_json (mirror service_form.js shape)
export function toItemsJson(items) {
  return (items || []).map(it => ({
    product_id: Number(it.product_id),
    name: it.name,
    qty: Number(it.qty || 0),
    unit_price: Number(it.unit_price || 0),
    line_total: Number(it.line_total || 0),
    warehouse_id: it.warehouse_id,
    warehouse_name: it.warehouse_name,
    is_main: false
  }));
}

// ── stock deduct (mirror service_form.js 575-608) ────────────
// ตัดสต็อกผ่าน window._appApplyStockMovement (out/floor/CAS) — ไม่เขียน warehouse_stock ตรง
// คืน { stockOpsFailed, errors[] } — caller ตัดสินใจ UX (ไม่กลืน error เงียบ §4.8)
export async function deductEquipmentStock(items, jobNo, customerName) {
  let stockOpsFailed = false;
  const errors = [];
  try {
    for (const it of (items || [])) {
      if (!it.warehouse_id || !it.product_id) continue;
      if (typeof window._appApplyStockMovement === "function") {
        const r = await window._appApplyStockMovement({
          productId: it.product_id,
          warehouseId: it.warehouse_id,
          movementType: "out",
          qty: Number(it.qty || 0),
          note: `งานช่าง: ${jobNo || "-"} — ${customerName || ""}`
        });
        if (!r?.ok) {
          console.error("[service_equipment deduct fail]", it, r);
          stockOpsFailed = true;
          errors.push({ item: it, error: r?.error || "unknown" });
        }
      }
    }
  } catch (e) {
    console.error("[service_equipment stock ops]", e);
    stockOpsFailed = true;
  }
  return { stockOpsFailed, errors };
}

// ── Phase 404: คืนสต็อกตอนยกเลิก/ลบงานช่างที่มีอุปกรณ์ ────────────────
//   อุปกรณ์ถูกตัดตอนสร้าง (Phase 402) → cancel/delete ต้องคืน (return movement) ผ่าน
//   window._appApplyStockMovement("return") → trigger 403 sync products.stock เอง (ไม่แตะ products ตรง).
//   idempotent: ถ้า note มี STOCK_RETURNED_MARKER แล้ว = คืนไปแล้ว → no-op (กันคืนซ้ำ).
//   คืนเฉพาะ item ที่มี warehouse_id (ถูก warehouse-deduct จริง); ไม่มี → skip (ไม่เดาคลัง).
//   คืน { restored, newNote, errors } — caller เอา newNote ไปเขียน (มี marker กันคืนซ้ำรอบหน้า).
export const STOCK_RETURNED_MARKER = "[คืนสต็อกแล้ว]";

export async function restoreServiceJobStock(job) {
  const items = Array.isArray(job?.items_json) ? job.items_json : [];
  const note = String(job?.note || "");
  if (items.length === 0 || note.includes(STOCK_RETURNED_MARKER)) {
    return { restored: false, newNote: note, errors: [] };
  }
  const errors = [];
  for (const it of items) {
    if (!it.warehouse_id || !it.product_id) continue;  // เฉพาะที่ warehouse-deducted จริง
    if (typeof window._appApplyStockMovement === "function") {
      const r = await window._appApplyStockMovement({
        productId: it.product_id,
        warehouseId: it.warehouse_id,
        movementType: "return",
        qty: Number(it.qty || 0),
        note: `คืนอุปกรณ์งานช่าง ${job.job_no || ""} (ยกเลิก)`
      });
      if (!r?.ok) {
        console.error("[service_equipment restore fail]", it, r);
        errors.push({ item: it, error: r?.error || "unknown" });
      }
    }
  }
  const newNote = note ? `${note} ${STOCK_RETURNED_MARKER}` : STOCK_RETURNED_MARKER;
  return { restored: true, newNote, errors };
}

// optimistic local update state.warehouseStock (mirror Phase 45.4) — ไม่ await loadAllData
export function optimisticDeduct(items, state) {
  try {
    for (const it of (items || [])) {
      if (!it.warehouse_id || !it.product_id) continue;
      const ws = (state.warehouseStock || []).find(w =>
        String(w.product_id) === String(it.product_id) && String(w.warehouse_id) === String(it.warehouse_id));
      if (ws) ws.stock = Math.max(0, Number(ws.stock || 0) - Number(it.qty || 0));
    }
  } catch (e) { console.warn("[service_equipment] optimistic update fail", e); }
}

// ── UI: render items list ────────────────────────────────────
// readOnly=true (งานเดิมมี items_json) → ไม่มีปุ่มลบ/แก้ qty (กันตัดซ้ำ)
// state (optional) → คำนวณ "คงเหลือในคลัง" สด (read-only lookup จาก state.warehouseStock)
export function renderEquipmentList(listEl, items, { money, readOnly, state }) {
  if (!listEl) return;
  if (!items || items.length === 0) {
    listEl.innerHTML = `<div style="font-size:12px;color:#94a3b8;padding:6px 0">ยังไม่มีอุปกรณ์</div>`;
    return;
  }
  // คงเหลือสดของสินค้าในคลังของมัน (lookup จาก state.warehouseStock); null = ไม่รู้/ไม่มีคลัง
  const _remainFor = (it) => {
    if (!state || it.warehouse_id == null || it.product_id == null) return null;
    const ws = (state.warehouseStock || []).find(s =>
      String(s.product_id) === String(it.product_id) && String(s.warehouse_id) === String(it.warehouse_id));
    return ws ? Number(ws.stock || 0) : null;
  };
  listEl.innerHTML = items.map((it, idx) => {
    const _rem = _remainFor(it);
    const _whText = it.warehouse_name
      ? `${readOnly ? "🔻 ตัดจาก " : ""}${escHtml(it.warehouse_name)}${_rem !== null ? ` • คงเหลือ ${Number(_rem).toLocaleString()} ชิ้น` : ""} • `
      : "";
    return `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f1f5f9;flex-wrap:wrap">
      <div style="flex:1 1 140px;min-width:140px">
        <div style="font-weight:700;color:#0f172a;font-size:13px">${escHtml(it.name || "-")}</div>
        <div style="font-size:11px;color:#64748b">${_whText}${money ? money(it.unit_price || 0) : it.unit_price}/ชิ้น</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex:0 0 auto">
        ${readOnly
          ? `<span style="font-size:13px;color:#475569">x${Number(it.qty || 0)}</span>`
          : `<input type="number" min="1" step="1" value="${Number(it.qty || 1)}" data-equip-qty="${idx}" style="width:60px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:8px;text-align:center;font:inherit" />`}
        <span style="font-weight:700;color:#0284c7;min-width:70px;text-align:right">${money ? money(it.line_total || 0) : it.line_total}</span>
        ${readOnly ? "" : `<button type="button" data-equip-del="${idx}" class="btn light" style="padding:2px 8px;font-size:14px;color:#dc2626">✕</button>`}
      </div>
    </div>
  `;
  }).join("");
}

// ── UI: picker modal ─────────────────────────────────────────
// onPick(item) เรียกเมื่อเลือกสินค้า + คลัง (qty เริ่ม 1)
export function openEquipmentPicker(ctx, onPick) {
  const { state, money, showToast } = ctx;
  document.getElementById("svEquipPickerModal")?.remove();

  const allInStock = (state.products || []).filter(p => warehouseStockOptions(p, state).length > 0);

  // Phase 452 — เลือกคลังก่อน + กรองหมวด (UI เท่านั้น; ไม่แตะ logic ตัดสต็อก)
  const warehouses = state.warehouses || [];
  let _pickerWh = "all";   // "all" หรือ warehouse id
  let _pickerCat = "all";  // "all" หรือชื่อหมวด

  // สินค้าที่ "มีสต็อก>0" ตามคลังที่เลือก (ฐานก่อน filter หมวด/ค้นหา)
  const baseForWh = () => {
    if (_pickerWh === "all") return allInStock;
    return (state.products || []).filter(p =>
      warehouseStockOptions(p, state).some(o => String(o.warehouse_id) === String(_pickerWh) && o.stock > 0));
  };

  const renderWhChips = () => {
    const chip = (val, label, active) =>
      `<button type="button" data-wh-chip="${escHtml(String(val))}" class="btn light" style="font-size:12px;padding:5px 10px;border-radius:14px;white-space:nowrap${active ? ';background:#0284c7;color:#fff;border-color:#0284c7' : ''}">${label}</button>`;
    return chip("all", "ทุกคลัง", _pickerWh === "all") +
      warehouses.map(w => chip(w.id, `${w.is_mobile === true ? "🚐" : "📦"} ${escHtml(w.name)}`, String(_pickerWh) === String(w.id))).join("");
  };

  const renderCatOptions = () => {
    const cats = [...new Set(baseForWh().map(p => String(p.category || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "th"));
    return `<option value="all"${_pickerCat === "all" ? " selected" : ""}>ทุกหมวด</option>` +
      cats.map(c => `<option value="${escHtml(c)}"${_pickerCat === c ? " selected" : ""}>${escHtml(c)}</option>`).join("");
  };

  const renderList = (search) => {
    const q = (search || "").toLowerCase().trim();
    let filtered = baseForWh();
    if (_pickerCat !== "all") filtered = filtered.filter(p => String(p.category || "").trim() === _pickerCat);
    if (q) {
      filtered = filtered.filter(p =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.barcode || "").toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q));
    }
    return filtered.slice(0, 50).map(p => {
      let opts = warehouseStockOptions(p, state);
      // เลือกคลังเฉพาะ → โชว์ tag เฉพาะคลังนั้น (กันสับสนชื่อซ้ำข้ามคลัง)
      if (_pickerWh !== "all") opts = opts.filter(o => String(o.warehouse_id) === String(_pickerWh));
      const tags = opts.map(o =>
        `<span style="background:${o.is_mobile ? "#dbeafe" : "#fef3c7"};color:${o.is_mobile ? "#1e40af" : "#92400e"};padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700">${o.is_mobile ? "🚐" : "📦"} ${escHtml(o.warehouse_name)}: ${o.stock}</span>`
      ).join(" ");
      return `
        <button class="svep-item" data-pk-id="${p.id}" style="display:block;width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;cursor:pointer;text-align:left;font:inherit;margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;color:#0f172a">${escHtml(p.name || "-")}</div>
              <div style="font-size:11px;color:#64748b">${escHtml(p.category || "")}${p.barcode ? ` • ${escHtml(p.barcode)}` : ""}</div>
              <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${tags}</div>
            </div>
            <div style="text-align:right;flex-shrink:0"><div style="font-weight:700;color:#0284c7">${money ? money(p.price || 0) : p.price}</div></div>
          </div>
        </button>`;
    }).join("") || `<div style="text-align:center;padding:20px;color:#94a3b8">ไม่พบสินค้า "${escHtml(q)}"</div>`;
  };

  const modal = document.createElement("div");
  modal.id = "svEquipPickerModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:500px;width:100%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0;font-size:16px">🔧 เลือกอุปกรณ์ (จากสต็อก)</h3>
        <button id="svepClose" class="btn light" style="font-size:18px;padding:4px 10px">✕</button>
      </div>
      <div style="padding:12px 16px 8px;border-bottom:1px solid #e2e8f0;display:flex;flex-direction:column;gap:8px">
        <div style="font-size:12px;color:#64748b;font-weight:600">เลือกคลังก่อน:</div>
        <div id="svepWhChips" style="display:flex;gap:6px;flex-wrap:wrap"></div>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="svepCat" style="flex:1;min-width:0;padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;font:inherit;background:#fff"></select>
        </div>
        <input id="svepSearch" type="text" placeholder="🔍 ค้นหา ชื่อ / barcode / หมวด..." style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit" />
      </div>
      <div id="svepList" style="flex:1;overflow-y:auto;padding:12px 16px"></div>
    </div>`;
  document.body.appendChild(modal);

  const listEl = modal.querySelector("#svepList");
  const whChipsEl = modal.querySelector("#svepWhChips");
  const catEl = modal.querySelector("#svepCat");
  const searchEl = modal.querySelector("#svepSearch");
  const refreshList = () => { listEl.innerHTML = renderList(searchEl.value); };

  whChipsEl.innerHTML = renderWhChips();
  catEl.innerHTML = renderCatOptions();
  refreshList();

  modal.querySelector("#svepClose").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  searchEl.addEventListener("input", () => refreshList());

  // เปลี่ยนคลัง → reset หมวด + rebuild dropdown หมวด + re-render list (delegation: container คงอยู่)
  whChipsEl.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-wh-chip]");
    if (!chip) return;
    _pickerWh = chip.dataset.whChip;
    _pickerCat = "all";
    whChipsEl.innerHTML = renderWhChips();
    catEl.innerHTML = renderCatOptions();
    refreshList();
  });
  catEl.addEventListener("change", () => { _pickerCat = catEl.value; refreshList(); });

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-pk-id]");
    if (!btn) return;
    const p = (state.products || []).find(x => String(x.id) === String(btn.dataset.pkId));
    if (!p) return;
    const opts = warehouseStockOptions(p, state);
    if (opts.length === 0) { showToast?.("ไม่มีสต็อกในคลัง"); return; }

    let chosen;
    if (_pickerWh !== "all") {
      // เลือกคลังไว้แล้ว → ใช้คลังนั้นเลย (ข้าม _pickWarehouse)
      chosen = opts.find(o => String(o.warehouse_id) === String(_pickerWh));
      if (!chosen) {
        // ไม่ควรเกิด (list กรองมาแล้ว) — fallback flow เดิม
        chosen = opts[0];
        if (opts.length > 1) {
          chosen = await _pickWarehouse(opts, p.name);
          if (!chosen) { showToast?.("ยกเลิก"); return; }
        }
      }
    } else {
      chosen = opts[0];
      if (opts.length > 1) {
        chosen = await _pickWarehouse(opts, p.name);
        if (!chosen) { showToast?.("ยกเลิก"); return; }
      }
    }
    onPick?.({
      product_id: Number(p.id),
      name: p.name || "-",
      qty: 1,
      unit_price: Number(p.price || 0),
      line_total: Number(p.price || 0),
      warehouse_id: chosen.warehouse_id,
      warehouse_name: chosen.warehouse_name,
      _stock_avail: chosen.stock
    });
    modal.remove();
  });
}

// เลือกคลัง เมื่อสินค้ามีสต็อกหลายคลัง
function _pickWarehouse(opts, productName) {
  return new Promise((resolve) => {
    document.getElementById("svepWhModal")?.remove();
    const m = document.createElement("div");
    m.id = "svepWhModal";
    m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px";
    m.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:380px;width:100%;padding:18px">
        <h3 style="margin:0 0 4px;font-size:15px">เลือกคลังสำหรับ</h3>
        <div style="font-size:13px;color:#475569;margin-bottom:12px">${escHtml(productName || "")}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${opts.map((o, i) => `
            <button type="button" data-wh="${i}" class="btn light" style="display:flex;justify-content:space-between;align-items:center;width:100%;padding:12px;text-align:left">
              <span>${o.is_mobile ? "🚐" : "📦"} ${escHtml(o.warehouse_name)}</span>
              <span style="font-weight:700;color:#0284c7">เหลือ ${o.stock}</span>
            </button>`).join("")}
        </div>
        <button type="button" id="svepWhCancel" class="btn light" style="width:100%;margin-top:12px">ยกเลิก</button>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => {
      if (e.target === m || e.target.closest("#svepWhCancel")) { m.remove(); resolve(null); return; }
      const btn = e.target.closest("[data-wh]");
      if (btn) { const o = opts[Number(btn.dataset.wh)]; m.remove(); resolve(o); }
    });
  });
}
