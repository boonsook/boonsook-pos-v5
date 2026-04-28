// ═══════════════════════════════════════════════════════════
//  AC INSTALL — ใบงานติดตั้งแอร์
//  Phase 41: line items + receipt + LINE
//  Phase 43: ตัดสต็อกจากคลังในรถ (mobile) + auto-transfer จากบ้านถ้าไม่พอ
// ═══════════════════════════════════════════════════════════

// Module-level state
let _items = [];           // [{product_id, name, qty, unit_price, line_total, warehouse_id, warehouse_name}]
let _showPicker = false;
let _pickerSearch = "";
let _lastSavedJob = null;  // ถ้ามีค่า → form อยู่ใน read-only (lock items, edit ได้แค่ note)

const escHtml = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

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
      <h3 style="color:var(--primary2);margin-bottom:4px">🏗️ ใบงานติดตั้งแอร์</h3>
      <p class="sku">เลือกรุ่นแอร์ + เพิ่มอุปกรณ์จากสต็อก + คำนวณราคา</p>
    </div>

    <!-- ข้อมูลลูกค้า -->
    <div class="panel">
      <div class="set-section-title">👤 ข้อมูลลูกค้า</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
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
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
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

    <!-- สรุปราคา -->
    <div id="acPriceSummary" class="panel" style="text-align:center">
      <div class="sku">ราคารวมทั้งหมด</div>
      <div style="font-size:36px;font-weight:900;color:var(--primary2)">฿ 0</div>
    </div>

    <button id="acSaveBtn" class="set-save-btn">💾 บันทึกใบงานติดตั้ง</button>
    <div id="acStatus" class="hidden panel mt16"></div>
    <div id="acAfterSave"></div>
  `;

  // Render initial items list
  _renderItemsList(container, money);

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
  container.querySelector("#acAddItemBtn")?.addEventListener("click", () => _openItemPicker(ctx, container, updateTotal));
  _bindItemListEvents(container, updateTotal, money);

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
    statusEl.textContent = "กำลังบันทึก...";

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
      for (const it of fullItems) {
        if (!it.warehouse_id || !it.product_id) continue; // ไม่ตัดสต็อก (เช่น service)
        const prod = (state.products || []).find(p => String(p.id) === String(it.product_id));
        if (!prod) continue;
        const ws = (state.warehouseStock || []).find(w =>
          String(w.product_id) === String(it.product_id) &&
          String(w.warehouse_id) === String(it.warehouse_id)
        );
        const stockAvail = Number(ws?.stock || 0);
        const need = Number(it.qty || 0);
        if (stockAvail < need) {
          // ถ้า warehouse ที่เลือกเป็น home (โดย user เลือกเอง) → ตัดจากบ้านได้
          // (case นี้ไม่ค่อยเจอเพราะเรา re-pick เป็น mobile ข้างบนแล้ว — เก็บไว้เผื่อ edge case)
          const isHome = homeWh && String(it.warehouse_id) === String(homeWh.id);
          if (isHome) continue;
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
        productId ? `รุ่น: ${productName} x${qty}` : "",
        ..._items.map(it => `${it.name} x${it.qty} = ฿${Number(it.line_total).toLocaleString()}`),
        labor ? `ค่าแรง: ฿${labor.toLocaleString()}` : "",
        discount ? `ส่วนลด: -฿${discount.toLocaleString()}` : "",
      ].filter(Boolean).join(" | ");

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
        status: "pending",
        note: container.querySelector("#acNote").value.trim()
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

      // ★ Phase 43: Auto-transfer (ถ้ามี) → ตัดสต็อก
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
        // Step 2: Deduct stock จาก warehouse ที่เลือก (ทุก item)
        for (const it of fullItems) {
          if (!it.warehouse_id || !it.product_id) continue;
          if (typeof window._appApplyStockMovement === "function") {
            const r = await window._appApplyStockMovement({
              productId: it.product_id,
              warehouseId: it.warehouse_id,
              movementType: "out",
              qty: Number(it.qty || 0),
              note: `service_install: ${jobNo} — ${name}`
            });
            if (!r?.ok) {
              console.error("[ac_install deduct fail]", it, r);
              stockOpsFailed = true;
            }
          }
        }
      } catch (stockErr) {
        console.error("[ac_install stock ops]", stockErr);
        stockOpsFailed = true;
      }

      // Phase 45.5: optimistic update state.warehouseStock + ไม่ await loadAllData
      // เหตุผล: loadAllData → renderAll → showRoute → renderAcInstallPage → re-mount form →
      //         ค่าแรง/ส่วนลด/หมายเหตุ input reset เป็น value="0" ทั้งที่ user เพิ่งกรอกค่า
      try {
        for (const it of fullItems) {
          if (!it.warehouse_id || !it.product_id) continue;
          const ws = (state.warehouseStock || []).find(w =>
            String(w.product_id) === String(it.product_id) &&
            String(w.warehouse_id) === String(it.warehouse_id)
          );
          if (ws) ws.stock = Math.max(0, Number(ws.stock || 0) - Number(it.qty || 0));
        }
      } catch(e) { console.warn("[ac_install] optimistic stock update fail", e); }

      if (stockOpsFailed) {
        showToast?.("⚠️ ใบงาน save แล้ว แต่ตัดสต็อก/โอนบางรายการล้มเหลว — ตรวจ Console");
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

      statusEl.innerHTML = `<div style="text-align:center;color:#059669;font-weight:700">✅ บันทึกใบงานติดตั้งสำเร็จ!${jobNo ? ` (เลขที่ ${escHtml(jobNo)})` : ""}</div>`;
      showToast("บันทึกสำเร็จ!");

      // ★ Phase 41 — แสดงปุ่มหลังบันทึก: ดูใบเสร็จ / ส่ง LINE / สร้างใบใหม่
      _renderAfterSaveActions(container, ctx);
    } catch (e) {
      console.error("[ac_install save] error:", e);
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

function _bindItemListEvents(container, updateTotal, money) {
  // delegated event — bind on container for child inputs (re-render-friendly)
  container.querySelector("#acItemsList")?.addEventListener("input", (e) => {
    const tgt = e.target;
    if (tgt.dataset.itemQty !== undefined) {
      const idx = Number(tgt.dataset.itemQty);
      const qty = Math.max(1, parseInt(tgt.value) || 1);
      _items[idx].qty = qty;
      _items[idx].line_total = qty * Number(_items[idx].unit_price || 0);
      _renderItemsList(container, money);
      updateTotal();
    } else if (tgt.dataset.itemPrice !== undefined) {
      const idx = Number(tgt.dataset.itemPrice);
      const price = Math.max(0, parseFloat(tgt.value) || 0);
      _items[idx].unit_price = price;
      _items[idx].line_total = Number(_items[idx].qty) * price;
      _renderItemsList(container, money);
      updateTotal();
    }
  });
  container.querySelector("#acItemsList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-item-del]");
    if (btn) {
      const idx = Number(btn.dataset.itemDel);
      _items.splice(idx, 1);
      _renderItemsList(container, money);
      updateTotal();
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  Phase 41 — Picker modal: search + select equipment
// ═══════════════════════════════════════════════════════════
function _openItemPicker(ctx, container, updateTotal) {
  const { state, money, showToast } = ctx;
  document.getElementById("acItemPickerModal")?.remove();

  // Phase 43: กรองเฉพาะสินค้าที่มีใน mobile (รถ) หรือบ้าน (เผื่อ auto-transfer)
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
        <button class="acpk-item" data-pk-id="${p.id}" style="display:block;width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;cursor:pointer;text-align:left;font:inherit;margin-bottom:6px">
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
  modal.id = "acItemPickerModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:500px;width:100%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0;font-size:16px">🔧 เลือกอุปกรณ์</h3>
        <button id="acpkClose" class="btn light" style="font-size:18px;padding:4px 10px">✕</button>
      </div>
      <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0">
        <input id="acpkSearch" type="text" placeholder="🔍 ค้นหา ชื่อ / barcode / หมวด..." style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit" />
      </div>
      <div id="acpkList" style="flex:1;overflow-y:auto;padding:12px 16px"></div>
    </div>
  `;
  document.body.appendChild(modal);

  const listEl = modal.querySelector("#acpkList");
  listEl.innerHTML = renderList("");

  modal.querySelector("#acpkClose").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelector("#acpkSearch").addEventListener("input", (e) => {
    listEl.innerHTML = renderList(e.target.value);
  });

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-pk-id]");
    if (!btn) return;
    const id = btn.dataset.pkId;
    const p = (state.products || []).find(x => String(x.id) === String(id));
    if (!p) return;

    // Phase 43: เลือก warehouse (รถ) ที่จะตัดสต็อก
    const mobileStocks = _getMobileStocks(p, state);
    const homeStock = _getHomeStock(p, state);

    let chosenWh = null;
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
    modal.remove();
    _renderItemsList(container, money);
    updateTotal();
    showToast?.(`เพิ่ม "${p.name}" จาก ${chosenWh.warehouse_name} แล้ว`);
  });

  setTimeout(() => modal.querySelector("#acpkSearch")?.focus(), 100);
}

// ═══════════════════════════════════════════════════════════
//  Phase 41 — After-save actions: ใบเสร็จ + ส่ง LINE + สร้างใบใหม่
// ═══════════════════════════════════════════════════════════
function _renderAfterSaveActions(container, ctx) {
  const { state, money, showToast } = ctx;
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
    renderAcInstallPage(ctx);
  });
}

// ═══════════════════════════════════════════════════════════
//  Receipt preview (HTML modal — print-ready)
// ═══════════════════════════════════════════════════════════
function _openReceiptPreview(ctx, container) {
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
