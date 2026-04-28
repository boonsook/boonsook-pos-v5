// ═══════════════════════════════════════════════════════════
//  SERVICE FORM — ใบงานช่าง (generic)
//  Phase 45: ใช้ module เดียวสำหรับงานช่าง 9 ประเภท
//    repair_ac / clean_ac / move_ac / satellite /
//    repair_fridge / repair_washer / cctv / repair_tv / other
//
//  Logic เหมือน ac_install.js (Phase 41-43) — ตัด section "เลือกรุ่นแอร์"
//  + รับ serviceType pre-fill ตอน mount
// ═══════════════════════════════════════════════════════════

export const SERVICE_TYPES = {
  repair_ac:     { icon: "🔧", label: "ซ่อมแอร์",            job_type: "repair_ac",     defaultDesc: "อาการเสีย เช่น ไม่เย็น / มีน้ำหยด / เสียงดัง" },
  clean_ac:      { icon: "🧼", label: "ล้างแอร์",             job_type: "clean_ac",      defaultDesc: "ล้างทำความสะอาด" },
  move_ac:       { icon: "📦", label: "ย้ายแอร์",             job_type: "move_ac",       defaultDesc: "ย้ายตำแหน่งเครื่อง" },
  satellite:     { icon: "📡", label: "จานดาวเทียม",          job_type: "satellite",     defaultDesc: "ปัญหาที่พบ" },
  repair_fridge: { icon: "❄️", label: "ซ่อมตู้เย็น",          job_type: "repair_fridge", defaultDesc: "อาการเสีย" },
  repair_washer: { icon: "🧺", label: "ซ่อมเครื่องซักผ้า",     job_type: "repair_washer", defaultDesc: "อาการเสีย" },
  cctv:          { icon: "📷", label: "CCTV",                job_type: "cctv",          defaultDesc: "งานติดตั้ง/ซ่อม" },
  repair_tv:     { icon: "📺", label: "ซ่อมทีวี",             job_type: "repair_tv",     defaultDesc: "อาการเสีย" },
  other:         { icon: "🔨", label: "งานอื่นๆ",             job_type: "other",         defaultDesc: "รายละเอียดงาน" }
};

export const SERVICE_FORM_TYPE_KEYS = Object.keys(SERVICE_TYPES);

// Module-level state — แยก per serviceType เพื่อกันสับสนตอนสลับหน้า
const _stateByType = {};
function _getStateFor(type) {
  if (!_stateByType[type]) {
    _stateByType[type] = { items: [], lastSavedJob: null };
  }
  return _stateByType[type];
}

const escHtml = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

// ═══════════════════════════════════════════════════════════
//  Mobile warehouse helpers (เหมือน ac_install.js — Phase 43)
// ═══════════════════════════════════════════════════════════
function _getMobileWarehouses(state) {
  return (state.warehouses || []).filter(w => w.is_mobile === true);
}

function _getHomeWarehouse(state) {
  const wh = state.warehouses || [];
  return wh.find(w => (w.name || "").includes("บ้าน")) ||
         wh.find(w => w.is_mobile !== true) ||
         null;
}

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

function _getHomeStock(p, state) {
  const home = _getHomeWarehouse(state);
  if (!home) return null;
  const ws = (state.warehouseStock || []).find(s =>
    String(s.product_id) === String(p.id) && String(s.warehouse_id) === String(home.id)
  );
  return { warehouse_id: home.id, warehouse_name: home.name, stock: Number(ws?.stock || 0) };
}

// ═══════════════════════════════════════════════════════════
//  Main render — รับ serviceType
// ═══════════════════════════════════════════════════════════
export function renderServiceFormPage(ctx, serviceType) {
  const cfg = SERVICE_TYPES[serviceType];
  if (!cfg) {
    console.error("[service_form] unknown serviceType:", serviceType);
    return;
  }

  const { state, money, showToast } = ctx;
  const containerId = `page-service_${serviceType}`;
  const container = document.getElementById(containerId);
  if (!container) return;

  const st = _getStateFor(serviceType);

  container.innerHTML = `
    <div class="panel">
      <h3 style="color:var(--primary2);margin-bottom:4px">${cfg.icon} ใบงาน${escHtml(cfg.label)}</h3>
      <p class="sku">กรอกข้อมูลลูกค้า + อุปกรณ์ที่ใช้ + ค่าแรง — บันทึกแล้วส่งใบเสร็จได้เลย</p>
    </div>

    <!-- ข้อมูลลูกค้า -->
    <div class="panel">
      <div class="set-section-title">👤 ข้อมูลลูกค้า</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label class="set-field-label">ชื่อลูกค้า</label>
          <input type="text" id="svName" placeholder="ชื่อ-นามสกุล" />
        </div>
        <div>
          <label class="set-field-label">เบอร์โทร</label>
          <input type="tel" id="svPhone" placeholder="08X-XXXXXXX" />
        </div>
      </div>
      <label class="set-field-label" style="margin-top:8px">ที่อยู่</label>
      <textarea id="svAddress" rows="2" placeholder="บ้านเลขที่ หมู่ ตำบล อำเภอ จังหวัด" style="width:100%;border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit;resize:vertical"></textarea>
    </div>

    <!-- รายละเอียดงาน (แทน "เลือกรุ่นแอร์") -->
    <div class="panel">
      <div class="set-section-title">📝 รายละเอียดงาน</div>
      <textarea id="svDescription" rows="3" placeholder="${escHtml(cfg.defaultDesc)}" style="width:100%;border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit;resize:vertical"></textarea>
    </div>

    <!-- อุปกรณ์ที่ใช้ (line items) -->
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="set-section-title" style="margin:0">🔧 อุปกรณ์ที่ใช้ (จากสต็อก)</div>
        <button id="svAddItemBtn" class="btn primary" style="font-size:12px;padding:6px 12px">+ เพิ่มอุปกรณ์</button>
      </div>
      <div id="svItemsList"></div>
      <div style="font-size:11px;color:#94a3b8;margin-top:6px">💡 อะไหล่ / สายไฟ / น้ำยา — เพิ่มเป็นอุปกรณ์จากสต็อก (ตัดสต็อกอัตโนมัติตอนบันทึก)</div>
    </div>

    <!-- ค่าแรง + ส่วนลด -->
    <div class="panel">
      <div class="set-section-title">💰 ค่าแรง / ส่วนลด</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label class="set-field-label">ค่าแรง (฿)</label>
          <input type="number" id="svLabor" value="0" min="0" step="100" />
        </div>
        <div>
          <label class="set-field-label">ส่วนลด (฿)</label>
          <input type="number" id="svDiscount" value="0" min="0" step="100" />
        </div>
      </div>
      <label class="set-field-label" style="margin-top:10px">หมายเหตุ</label>
      <input type="text" id="svNote" placeholder="เช่น วันนัดหมาย, รายละเอียดเพิ่มเติม..." />
    </div>

    <!-- สรุปราคา -->
    <div id="svPriceSummary" class="panel" style="text-align:center">
      <div class="sku">ราคารวมทั้งหมด</div>
      <div style="font-size:36px;font-weight:900;color:var(--primary2)">฿ 0</div>
    </div>

    <button id="svSaveBtn" class="set-save-btn">💾 บันทึกใบงาน${escHtml(cfg.label)}</button>
    <div id="svStatus" class="hidden panel mt16"></div>
    <div id="svAfterSave"></div>
  `;

  _renderItemsList(container, money, st);

  function updateTotal() {
    const labor = parseFloat(container.querySelector("#svLabor").value) || 0;
    const discount = parseFloat(container.querySelector("#svDiscount").value) || 0;
    const itemsTotal = st.items.reduce((s, it) => s + Number(it.line_total || 0), 0);
    const net = Math.max(0, itemsTotal + labor - discount);

    container.querySelector("#svPriceSummary").innerHTML = `
      <div class="sku">ราคารวมทั้งหมด</div>
      <div style="font-size:36px;font-weight:900;color:var(--primary2)">${money(net)}</div>
      <div class="sku" style="margin-top:4px">
        ${itemsTotal > 0 ? `อุปกรณ์ ${money(itemsTotal)}` : "ยังไม่มีอุปกรณ์"}${labor > 0 ? ` + ค่าแรง ${money(labor)}` : ""}${discount > 0 ? ` − ส่วนลด ${money(discount)}` : ""}
      </div>
    `;
  }

  container.querySelectorAll("input[type=number]").forEach(el => el.addEventListener("input", updateTotal));

  container.querySelector("#svAddItemBtn")?.addEventListener("click", () => _openItemPicker(ctx, container, updateTotal, st));
  _bindItemListEvents(container, updateTotal, money, st);

  // Save
  container.querySelector("#svSaveBtn").addEventListener("click", async (e) => {
    const saveBtn = e.currentTarget;
    if (saveBtn.disabled) return;
    const name = container.querySelector("#svName").value.trim();
    if (!name) return showToast("กรอกชื่อลูกค้า");

    saveBtn.disabled = true;
    const origText = saveBtn.textContent;
    saveBtn.textContent = "⏳ กำลังบันทึก...";

    const labor = parseFloat(container.querySelector("#svLabor").value) || 0;
    const discount = parseFloat(container.querySelector("#svDiscount").value) || 0;
    const itemsTotal = st.items.reduce((s, it) => s + Number(it.line_total || 0), 0);
    const net = Math.max(0, itemsTotal + labor - discount);
    const description = container.querySelector("#svDescription").value.trim();

    const statusEl = container.querySelector("#svStatus");
    statusEl.classList.remove("hidden");
    statusEl.textContent = "กำลังบันทึก...";

    try {
      const supaCfg = window.SUPABASE_CONFIG;
      const token = (await state.supabase.auth.getSession())?.data?.session?.access_token || supaCfg.anonKey;

      // Phase 43: items ที่ user pick "บ้าน" ใน picker → re-pick เป็น mobile แรก (force transfer)
      const mobileWhList = _getMobileWarehouses(state);
      const fullItems = [];
      st.items.forEach(it => {
        const homeWhTmp = _getHomeWarehouse(state);
        const isPickedHome = homeWhTmp && String(it.warehouse_id) === String(homeWhTmp.id);
        if (isPickedHome && mobileWhList.length > 0) {
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

      // เช็คก่อน save — ของในรถพอมั้ย? ถ้าไม่พอ + บ้านมี → confirm auto-transfer
      const transfersNeeded = [];
      const homeWh = _getHomeWarehouse(state);
      for (const it of fullItems) {
        if (!it.warehouse_id || !it.product_id) continue;
        const prod = (state.products || []).find(p => String(p.id) === String(it.product_id));
        if (!prod) continue;
        const ws = (state.warehouseStock || []).find(w =>
          String(w.product_id) === String(it.product_id) &&
          String(w.warehouse_id) === String(it.warehouse_id)
        );
        const stockAvail = Number(ws?.stock || 0);
        const need = Number(it.qty || 0);
        if (stockAvail < need) {
          const isHome = homeWh && String(it.warehouse_id) === String(homeWh.id);
          if (isHome) continue;
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

      if (transfersNeeded.length > 0) {
        const summary = transfersNeeded.map(t =>
          `${t.productName}: โอน ${t.qty} ชิ้น (${t.fromWhName} → ${t.toWhName})`
        ).join(" • ");
        const msg = `🚐 ของในรถไม่พอ — ต้องโอนจากบ้านขึ้นรถก่อน: ${summary} — ตกลงโอน + ตัดสต็อกอัตโนมัติ?`;
        const ok = await window.App?.confirm?.(msg);
        if (!ok) {
          throw new Error("ยกเลิกการบันทึก — โอนสต็อกขึ้นรถก่อนแล้วลองใหม่");
        }
      }

      const desc = [
        description,
        ...st.items.map(it => `${it.name} x${it.qty} = ฿${Number(it.line_total).toLocaleString()}`),
        labor ? `ค่าแรง: ฿${labor.toLocaleString()}` : "",
        discount ? `ส่วนลด: -฿${discount.toLocaleString()}` : "",
      ].filter(Boolean).join(" | ");

      const record = {
        job_no: "JOB-" + Date.now(),
        customer_name: name,
        customer_phone: container.querySelector("#svPhone").value.trim(),
        customer_address: container.querySelector("#svAddress").value.trim(),
        job_type: cfg.job_type,
        description: desc,
        items_json: fullItems,
        status: "pending",
        note: container.querySelector("#svNote").value.trim()
      };

      const resp = await fetch(`${supaCfg.url}/rest/v1/service_jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supaCfg.anonKey,
          "Authorization": `Bearer ${token}`,
          "Prefer": "return=representation"
        },
        body: JSON.stringify(record)
      });
      if (!resp.ok) {
        let errBody = "";
        try { errBody = await resp.text(); } catch(e) {}
        console.error("[service_form save fail]", serviceType, resp.status, errBody, "payload:", record);
        throw new Error(`HTTP ${resp.status}: ${errBody.slice(0, 300) || "no body"}`);
      }
      const inserted = await resp.json();
      const jobId = inserted?.[0]?.id || null;
      const jobNo = inserted?.[0]?.job_no || "";

      // Auto-transfer + deduct stock
      let stockOpsFailed = false;
      try {
        for (const t of transfersNeeded) {
          if (typeof window._appTransferWarehouseStock === "function") {
            const r = await window._appTransferWarehouseStock({
              productId: t.productId,
              fromWarehouseId: t.fromWhId,
              toWarehouseId: t.toWhId,
              qty: t.qty,
              note: `auto-transfer for ${cfg.job_type} ${jobNo}`
            });
            if (!r?.ok) {
              console.error("[service_form transfer fail]", t, r);
              stockOpsFailed = true;
            }
          }
        }
        for (const it of fullItems) {
          if (!it.warehouse_id || !it.product_id) continue;
          if (typeof window._appApplyStockMovement === "function") {
            const r = await window._appApplyStockMovement({
              productId: it.product_id,
              warehouseId: it.warehouse_id,
              movementType: "out",
              qty: Number(it.qty || 0),
              note: `${cfg.job_type}: ${jobNo} — ${name}`
            });
            if (!r?.ok) {
              console.error("[service_form deduct fail]", it, r);
              stockOpsFailed = true;
            }
          }
        }
      } catch (stockErr) {
        console.error("[service_form stock ops]", stockErr);
        stockOpsFailed = true;
      }

      // Phase 45.4: optimistic update state.warehouseStock + ไม่ await loadAllData
      // เหตุผล: loadAllData → renderAll → showRoute → renderServiceFormPage → re-mount form →
      //         labor/discount input reset เป็น value="0" ทั้งที่ user เพิ่งกรอกค่า
      try {
        for (const it of fullItems) {
          if (!it.warehouse_id || !it.product_id) continue;
          const ws = (state.warehouseStock || []).find(w =>
            String(w.product_id) === String(it.product_id) &&
            String(w.warehouse_id) === String(it.warehouse_id)
          );
          if (ws) ws.stock = Math.max(0, Number(ws.stock || 0) - Number(it.qty || 0));
        }
      } catch(e) { console.warn("[service_form] optimistic stock update fail", e); }

      if (stockOpsFailed) {
        showToast?.("⚠️ ใบงาน save แล้ว แต่ตัดสต็อก/โอนบางรายการล้มเหลว — ตรวจ Console");
      }

      st.lastSavedJob = {
        id: jobId,
        jobNo,
        serviceType,
        cfg,
        customer_name: name,
        customer_phone: container.querySelector("#svPhone").value.trim(),
        address: container.querySelector("#svAddress").value.trim(),
        description,
        items: fullItems,
        labor,
        discount,
        total: net
      };

      statusEl.innerHTML = `<div style="text-align:center;color:#059669;font-weight:700">✅ บันทึกใบงาน${escHtml(cfg.label)}สำเร็จ!${jobNo ? ` (เลขที่ ${escHtml(jobNo)})` : ""}</div>`;
      showToast("บันทึกสำเร็จ!");

      _renderAfterSaveActions(container, ctx, serviceType);
    } catch (e) {
      console.error("[service_form save]", serviceType, e);
      statusEl.textContent = "เกิดข้อผิดพลาด: " + e.message;
    } finally {
      if (saveBtn.isConnected) {
        saveBtn.disabled = false;
        saveBtn.textContent = origText;
      }
    }
  });

  updateTotal();
}

// ═══════════════════════════════════════════════════════════
//  Items list rendering + binding
// ═══════════════════════════════════════════════════════════
function _renderItemsList(container, money, st) {
  const el = container.querySelector("#svItemsList");
  if (!el) return;
  if (st.items.length === 0) {
    el.innerHTML = `<div class="sku" style="text-align:center;padding:14px;color:#94a3b8">ยังไม่มีอุปกรณ์ — กด "+ เพิ่มอุปกรณ์"</div>`;
    return;
  }
  const locked = !!st.lastSavedJob;
  el.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead style="background:#f1f5f9">
          <tr>
            <th style="padding:8px;text-align:left">อุปกรณ์</th>
            <th style="padding:8px;text-align:left;width:110px">คลัง</th>
            <th style="padding:8px;text-align:center;width:70px">จำนวน</th>
            <th style="padding:8px;text-align:right;width:90px">ราคา/ชิ้น</th>
            <th style="padding:8px;text-align:right;width:90px">รวม</th>
            <th style="padding:8px;width:30px"></th>
          </tr>
        </thead>
        <tbody>
          ${st.items.map((it, idx) => {
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
              <td style="padding:6px"><input type="number" min="1" value="${it.qty}" data-item-qty="${idx}" ${locked ? "disabled" : ""} style="width:54px;text-align:center;padding:4px;border:1px solid #cbd5e1;border-radius:6px${locked ? ";background:#f1f5f9;color:#94a3b8" : ""}" /></td>
              <td style="padding:6px"><input type="number" min="0" step="1" value="${Number(it.unit_price)}" data-item-price="${idx}" ${locked ? "disabled" : ""} style="width:80px;text-align:right;padding:4px;border:1px solid #cbd5e1;border-radius:6px${locked ? ";background:#f1f5f9;color:#94a3b8" : ""}" /></td>
              <td style="padding:8px;text-align:right;font-weight:700;color:#0284c7">${money(it.line_total)}</td>
              <td style="padding:6px;text-align:center">${locked ? "" : `<button data-item-del="${idx}" class="btn light" style="font-size:14px;padding:2px 8px;color:#dc2626" title="ลบ">×</button>`}</td>
            </tr>
          `;}).join("")}
        </tbody>
      </table>
    </div>
    ${locked ? `<div style="padding:8px 12px;margin-top:8px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;font-size:12px;color:#92400e">🔒 ใบงานบันทึกแล้ว — แก้ไขได้แค่หมายเหตุ/รูป (สร้างใบใหม่ถ้าต้องการแก้)</div>` : ""}
  `;
}

function _bindItemListEvents(container, updateTotal, money, st) {
  container.querySelector("#svItemsList")?.addEventListener("input", (e) => {
    const tgt = e.target;
    if (tgt.dataset.itemQty !== undefined) {
      const idx = Number(tgt.dataset.itemQty);
      const qty = Math.max(1, parseInt(tgt.value) || 1);
      st.items[idx].qty = qty;
      st.items[idx].line_total = qty * Number(st.items[idx].unit_price || 0);
      _renderItemsList(container, money, st);
      updateTotal();
    } else if (tgt.dataset.itemPrice !== undefined) {
      const idx = Number(tgt.dataset.itemPrice);
      const price = Math.max(0, parseFloat(tgt.value) || 0);
      st.items[idx].unit_price = price;
      st.items[idx].line_total = Number(st.items[idx].qty) * price;
      _renderItemsList(container, money, st);
      updateTotal();
    }
  });
  container.querySelector("#svItemsList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-item-del]");
    if (btn) {
      const idx = Number(btn.dataset.itemDel);
      st.items.splice(idx, 1);
      _renderItemsList(container, money, st);
      updateTotal();
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  Picker modal
// ═══════════════════════════════════════════════════════════
function _openItemPicker(ctx, container, updateTotal, st) {
  const { state, money, showToast } = ctx;
  document.getElementById("svItemPickerModal")?.remove();

  const allInStock = (state.products || []).filter(p => {
    const mobileTotal = _getMobileStocks(p, state).reduce((s, x) => s + x.stock, 0);
    const homeStock = _getHomeStock(p, state)?.stock || 0;
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
      const mobileStocks = _getMobileStocks(p, state);
      const homeStock = _getHomeStock(p, state);
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
        <button class="svpk-item" data-pk-id="${p.id}" style="display:block;width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;cursor:pointer;text-align:left;font:inherit;margin-bottom:6px">
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
  modal.id = "svItemPickerModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:500px;width:100%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0;font-size:16px">🔧 เลือกอุปกรณ์</h3>
        <button id="svpkClose" class="btn light" style="font-size:18px;padding:4px 10px">✕</button>
      </div>
      <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0">
        <input id="svpkSearch" type="text" placeholder="🔍 ค้นหา ชื่อ / barcode / หมวด..." style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit" />
      </div>
      <div id="svpkList" style="flex:1;overflow-y:auto;padding:12px 16px"></div>
    </div>
  `;
  document.body.appendChild(modal);

  const listEl = modal.querySelector("#svpkList");
  listEl.innerHTML = renderList("");

  modal.querySelector("#svpkClose").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelector("#svpkSearch").addEventListener("input", (e) => {
    listEl.innerHTML = renderList(e.target.value);
  });

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-pk-id]");
    if (!btn) return;
    const id = btn.dataset.pkId;
    const p = (state.products || []).find(x => String(x.id) === String(id));
    if (!p) return;

    const mobileStocks = _getMobileStocks(p, state);
    const homeStock = _getHomeStock(p, state);

    let chosenWh = null;
    if (mobileStocks.length === 1) {
      chosenWh = mobileStocks[0];
    } else if (mobileStocks.length > 1) {
      chosenWh = await _pickMobileWarehouse(mobileStocks, p.name);
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

    const existing = st.items.find(it =>
      String(it.product_id) === String(p.id) &&
      String(it.warehouse_id) === String(chosenWh.warehouse_id)
    );
    if (existing) {
      existing.qty = Number(existing.qty) + 1;
      existing.line_total = existing.qty * Number(existing.unit_price || 0);
    } else {
      st.items.push({
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
    _renderItemsList(container, money, st);
    updateTotal();
    showToast?.(`เพิ่ม "${p.name}" จาก ${chosenWh.warehouse_name} แล้ว`);
  });

  setTimeout(() => modal.querySelector("#svpkSearch")?.focus(), 100);
}

// ═══════════════════════════════════════════════════════════
//  After-save actions
// ═══════════════════════════════════════════════════════════
function _renderAfterSaveActions(container, ctx, serviceType) {
  const st = _getStateFor(serviceType);
  const el = container.querySelector("#svAfterSave");
  if (!el || !st.lastSavedJob) return;
  el.innerHTML = `
    <div class="panel" style="background:#f0fdf4;border:2px solid #86efac;margin-top:12px">
      <div style="font-weight:700;color:#15803d;margin-bottom:8px">📋 ขั้นต่อไป</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="svViewReceipt" class="btn primary" style="flex:1;min-width:140px">📄 ดูใบเสร็จ / พิมพ์</button>
        <button id="svSendLine" class="btn" style="flex:1;min-width:140px;background:#06c755;color:#fff;border:none;border-radius:14px;padding:12px;font-weight:700">📤 ส่ง LINE ลูกค้า</button>
        <button id="svNewBill" class="btn light" style="flex:1;min-width:140px">+ สร้างใบใหม่</button>
      </div>
    </div>
  `;

  el.querySelector("#svViewReceipt")?.addEventListener("click", () => _openReceiptPreview(ctx, container, st));
  el.querySelector("#svSendLine")?.addEventListener("click", () => _sendLineReceipt(ctx, container, st));
  el.querySelector("#svNewBill")?.addEventListener("click", async () => {
    // Phase 45.4: reload data ตอนนี้ (ใบงานก่อนหน้า save แล้ว — ไม่กระทบ form)
    try { await ctx.loadAllData?.(); } catch(e) {}
    st.items = [];
    st.lastSavedJob = null;
    renderServiceFormPage(ctx, serviceType);
  });
}

// ═══════════════════════════════════════════════════════════
//  Receipt preview
// ═══════════════════════════════════════════════════════════
function _openReceiptPreview(ctx, container, st) {
  const { state, money } = ctx;
  if (!st.lastSavedJob) return;
  const job = st.lastSavedJob;
  const cfg = job.cfg;
  const storeInfo = state.storeInfo || {};
  const storeName = storeInfo.name || "บุญสุข อิเล็กทรอนิกส์";
  const storeAddr = storeInfo.address || "";
  const storePhone = storeInfo.phone || "";
  const today = new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });

  document.getElementById("svReceiptModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "svReceiptModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:560px;width:100%;overflow:hidden;display:flex;flex-direction:column">
      <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;background:#f8fafc">
        <h3 style="margin:0;font-size:15px">📄 ใบเสร็จงาน${escHtml(cfg.label)}</h3>
        <div style="display:flex;gap:6px">
          <button id="svrcPrint" class="btn primary" style="font-size:12px;padding:6px 12px">🖨️ พิมพ์</button>
          <button id="svrcClose" class="btn light" style="font-size:18px;padding:4px 10px">✕</button>
        </div>
      </div>
      <div id="svrcBody" style="padding:20px;font-family:'Sarabun',sans-serif">
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
          <div><strong>${cfg.icon} ประเภทงาน:</strong> ${escHtml(cfg.label)}</div>
          <div><strong>👤 ลูกค้า:</strong> ${escHtml(job.customer_name)}</div>
          ${job.customer_phone ? `<div><strong>📞 โทร:</strong> ${escHtml(job.customer_phone)}</div>` : ""}
          ${job.address ? `<div><strong>📍 ที่อยู่:</strong> ${escHtml(job.address)}</div>` : ""}
          ${job.description ? `<div><strong>📝 รายละเอียด:</strong> ${escHtml(job.description)}</div>` : ""}
        </div>
        ${(job.items || []).length > 0 ? `
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
                <td style="padding:8px">${escHtml(it.name)}</td>
                <td style="padding:8px;text-align:center">${it.qty}</td>
                <td style="padding:8px;text-align:right">${money(it.unit_price)}</td>
                <td style="padding:8px;text-align:right;font-weight:600">${money(it.line_total)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        ` : ""}
        <div style="margin-bottom:14px;padding:10px 14px;background:#f8fafc;border-radius:8px">
          ${(job.items || []).length > 0 ? `
          <div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0">
            <span>รวมอุปกรณ์</span>
            <span>${money((job.items || []).reduce((s, it) => s + Number(it.line_total || 0), 0))}</span>
          </div>` : ""}
          ${job.labor > 0 ? `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0"><span>ค่าแรง</span><span>+${money(job.labor)}</span></div>` : ""}
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

  modal.querySelector("#svrcClose").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector("#svrcPrint").addEventListener("click", () => {
    const body = modal.querySelector("#svrcBody").innerHTML;
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
//  LINE notify
// ═══════════════════════════════════════════════════════════
async function _sendLineReceipt(ctx, container, st) {
  const { showToast } = ctx;
  if (!st.lastSavedJob) return;
  const job = st.lastSavedJob;
  const cfg = job.cfg;
  const btn = container.querySelector("#svSendLine");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ กำลังส่ง..."; }

  try {
    const lines = [
      `🧾 ใบเสร็จงาน${cfg.label}`,
      "━━━━━━━━━━━━━━━",
      `เลขที่: ${job.jobNo || "-"}`,
      `ลูกค้า: ${job.customer_name}`,
      job.customer_phone ? `โทร: ${job.customer_phone}` : "",
      job.description ? `รายละเอียด: ${job.description}` : "",
      "",
      (job.items || []).length > 0 ? "📦 อุปกรณ์:" : "",
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
    console.error("[service_form line]", e);
    showToast?.("ส่ง LINE ไม่สำเร็จ: " + (e?.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "📤 ส่ง LINE ลูกค้า"; }
  }
}

// ═══════════════════════════════════════════════════════════
//  Mobile warehouse picker (เลือกรถ)
// ═══════════════════════════════════════════════════════════
function _pickMobileWarehouse(mobileStocks, productName) {
  return new Promise((resolve) => {
    document.getElementById("svWhPickModal")?.remove();
    const modal = document.createElement("div");
    modal.id = "svWhPickModal";
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
          <button id="svWhPickCancel" style="width:100%;padding:10px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:10px;cursor:pointer;font:inherit;color:#64748b">ยกเลิก</button>
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
    modal.querySelector("#svWhPickCancel").addEventListener("click", () => { cleanup(); resolve(null); });
    modal.addEventListener("click", (e) => { if (e.target === modal) { cleanup(); resolve(null); } });
  });
}
