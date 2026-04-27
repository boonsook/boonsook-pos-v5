export function renderStockMovementsPage(ctx) {
  const { state, money, showToast, loadAllData, currentRole, requireAdmin } = ctx;

  // Formatting helper
  function dateTH(d) {
    if (!d) return "-";
    try {
      return new Date(d).toLocaleDateString("th-TH", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) {
      return d;
    }
  }

  // Get product name by ID (tolerant of string/number mismatch)
  function getProductName(productId) {
    const pid = productId == null ? null : String(productId);
    const product = state.products?.find(p => String(p.id) === pid);
    return product ? product.name : `(ID: ${productId})`;
  }

  // Get color class for movement type
  function getTypeColor(type) {
    if (type === 'in' || type === 'return') return 'green';
    if (type === 'out' || type === 'sale') return 'red';
    if (type === 'adjust' || type === 'transfer') return 'yellow';
    return 'gray';
  }

  // Get Thai label for movement type
  function getTypeLabel(type) {
    const labels = {
      'in': 'รับเข้า',
      'out': 'จ่ายออก',
      'adjust': 'ปรับสต็อก',
      'transfer': 'โอนย้าย',
      'sale': 'ขาย',
      'return': 'คืนสินค้า'
    };
    return labels[type] || type;
  }

  // Calculate summary stats (current month)
  function getMonthlyStats() {
    const now = new Date();
    const currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    const movements = state.stockMovements || [];
    const filtered = movements.filter(m => {
      if (!m.created_at) return false;
      const mDate = m.created_at.substring(0, 7);
      return mDate === currentMonth;
    });

    const inCount = filtered.filter(m => m.type === 'in').length;
    const outCount = filtered.filter(m => m.type === 'out' || m.type === 'sale').length;
    const adjustCount = filtered.filter(m => m.type === 'adjust').length;

    return { inCount, outCount, adjustCount };
  }

  // Render the page
  const page = document.getElementById("page-stock_movements");
  if (!page) return;

  const stats = getMonthlyStats();
  const thNum = (n) => (n || 0).toLocaleString('th-TH');

  // Escape HTML to prevent XSS in product names / notes
  function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  let html = `
    <div class="panel">
      <h2>ประวัติเคลื่อนไหวสต็อก</h2>

      <div class="stats-grid mt16">
        <div class="stat-card">
          <div class="stat-value">${thNum(stats.inCount)}</div>
          <div class="stat-label">รายการเข้า</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${thNum(stats.outCount)}</div>
          <div class="stat-label">รายการออก</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${thNum(stats.adjustCount)}</div>
          <div class="stat-label">ปรับสต็อก</div>
        </div>
      </div>

      <div class="mt16">
        <div class="row" style="flex-wrap: wrap; gap: 8px;">
          <input type="text" id="sm-search" class="sm-search" placeholder="ค้นหาสินค้า..." aria-label="ค้นหาสินค้า" style="flex: 1; min-width: 180px; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
          <select id="sm-type-filter" aria-label="กรองตามประเภท" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
            <option value="">ทั้งหมด</option>
            <option value="in">รับเข้า</option>
            <option value="out">จ่ายออก</option>
            <option value="adjust">ปรับสต็อก</option>
            <option value="sale">ขาย</option>
            <option value="return">คืนสินค้า</option>
            <option value="transfer">โอนย้าย</option>
          </select>
          <input type="date" id="sm-date-from" aria-label="วันที่เริ่มต้น" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
          <input type="date" id="sm-date-to" aria-label="วันที่สิ้นสุด" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
          <button class="btn btn-light" id="sm-filter-btn" aria-label="ค้นหา">ค้นหา</button>
          <button class="btn btn-light" id="sm-clear-btn" aria-label="ล้างตัวกรอง">ล้าง</button>
        </div>
      </div>

      <div class="mt16" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="sm-add-btn" aria-label="เพิ่มเคลื่อนไหวสต็อก">+ เพิ่มเคลื่อนไหวสต็อก</button>
        <button class="btn" id="sm-transfer-btn" aria-label="ย้ายคลัง" style="background:#f59e0b;color:#fff;border:none;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:600">🔄 ย้ายระหว่างคลัง</button>
      </div>

      <div id="sm-table-container" class="mt16" style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead style="background: #f5f5f5; border-bottom: 2px solid #ddd;">
            <tr>
              <th style="padding: 10px; text-align: left;">วันที่เวลา</th>
              <th style="padding: 10px; text-align: left;">สินค้า</th>
              <th style="padding: 10px; text-align: center;">ประเภท</th>
              <th style="padding: 10px; text-align: right;">จำนวน</th>
              <th style="padding: 10px; text-align: center;" colspan="2">ก่อน → หลัง (ใน note)</th>
              <th style="padding: 10px; text-align: left;">หมายเหตุ</th>
              <th style="padding: 10px; text-align: left;">ผู้ทำ</th>
            </tr>
          </thead>
          <tbody id="sm-tbody">
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add Movement Modal -->
    <div id="sm-modal" class="sm-modal-hidden" role="dialog" aria-modal="true" aria-label="เพิ่มเคลื่อนไหวสต็อก" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center;">
      <div style="background: white; padding: 20px; border-radius: 8px; width: 90%; max-width: 500px; max-height: 80vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0;">เพิ่มเคลื่อนไหวสต็อก</h3>
          <button id="sm-close-btn" aria-label="ปิด" style="background: none; border: none; font-size: 24px; cursor: pointer; line-height: 1; padding: 0 8px;">&times;</button>
        </div>

        <div style="margin-top: 15px;">
          <label for="sm-product-select" style="display: block; margin-bottom: 5px; font-weight: bold;">เลือกสินค้า:</label>
          <select id="sm-product-select" aria-label="เลือกสินค้า" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
            <option value="">-- เลือกสินค้า --</option>
            ${(state.products || []).map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('')}
          </select>
        </div>

        <div style="margin-top: 15px;">
          <label for="sm-type-select" style="display: block; margin-bottom: 5px; font-weight: bold;">ประเภท:</label>
          <select id="sm-type-select" aria-label="ประเภทการเคลื่อนไหว" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
            <option value="">-- เลือกประเภท --</option>
            <option value="in">รับเข้า (+)</option>
            <option value="out">จ่ายออก (-)</option>
            <option value="adjust">ปรับสต็อก (ตั้งค่าใหม่)</option>
            <option value="return">คืนสินค้า (+)</option>
          </select>
        </div>

        <div style="margin-top: 15px;">
          <label for="sm-warehouse-select" style="display: block; margin-bottom: 5px; font-weight: bold;">คลัง:</label>
          <select id="sm-warehouse-select" aria-label="เลือกคลัง" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
            <option value="">-- เลือกคลัง --</option>
            ${(state.warehouses || []).map(w => `<option value="${escHtml(w.id)}">${escHtml(w.name)}</option>`).join('')}
          </select>
        </div>

        <div style="margin-top: 15px;">
          <label for="sm-qty-input" style="display: block; margin-bottom: 5px; font-weight: bold;">จำนวน:</label>
          <input type="number" id="sm-qty-input" aria-label="จำนวน" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="กรอกจำนวน" min="1" step="1">
        </div>

        <div id="sm-preview" style="margin-top: 10px; padding: 8px 12px; background: #f5f7fa; border-radius: 4px; font-size: 13px; color: #666; display: none;"></div>

        <div style="margin-top: 15px;">
          <label for="sm-note-input" style="display: block; margin-bottom: 5px; font-weight: bold;">หมายเหตุ:</label>
          <input type="text" id="sm-note-input" aria-label="หมายเหตุ" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="หมายเหตุ (ตัวเลือก)" maxlength="200">
        </div>

        <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
          <button class="btn btn-light" id="sm-cancel-btn">ยกเลิก</button>
          <button class="btn btn-primary" id="sm-save-btn">บันทึก</button>
        </div>
      </div>
    </div>

    <!-- Transfer Between Warehouses Modal -->
    <div id="sm-transfer-modal" class="sm-modal-hidden" role="dialog" aria-modal="true" aria-label="ย้ายระหว่างคลัง" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center;">
      <div style="background: white; padding: 20px; border-radius: 8px; width: 90%; max-width: 500px; max-height: 80vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0;">🔄 ย้ายสต็อกระหว่างคลัง</h3>
          <button id="smt-close-btn" aria-label="ปิด" style="background: none; border: none; font-size: 24px; cursor: pointer; line-height: 1; padding: 0 8px;">&times;</button>
        </div>

        <div style="margin-top: 15px;">
          <label for="smt-product-select" style="display: block; margin-bottom: 5px; font-weight: bold;">สินค้า:</label>
          <select id="smt-product-select" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
            <option value="">-- เลือกสินค้า --</option>
            ${(state.products || []).filter(p => p.product_type !== 'service' && p.product_type !== 'non_stock').map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('')}
          </select>
        </div>

        <div style="margin-top: 15px;">
          <label for="smt-from-select" style="display: block; margin-bottom: 5px; font-weight: bold;">คลังต้นทาง:</label>
          <select id="smt-from-select" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
            <option value="">-- เลือกคลังต้นทาง --</option>
            ${(state.warehouses || []).map(w => `<option value="${escHtml(w.id)}">${escHtml(w.name)}</option>`).join('')}
          </select>
          <div id="smt-from-stock" style="font-size:12px;color:#64748b;margin-top:4px"></div>
        </div>

        <div style="margin-top: 15px;">
          <label for="smt-to-select" style="display: block; margin-bottom: 5px; font-weight: bold;">คลังปลายทาง:</label>
          <select id="smt-to-select" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
            <option value="">-- เลือกคลังปลายทาง --</option>
            ${(state.warehouses || []).map(w => `<option value="${escHtml(w.id)}">${escHtml(w.name)}</option>`).join('')}
          </select>
        </div>

        <div style="margin-top: 15px;">
          <label for="smt-qty-input" style="display: block; margin-bottom: 5px; font-weight: bold;">จำนวนที่ย้าย:</label>
          <input type="number" id="smt-qty-input" min="1" step="1" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="กรอกจำนวน">
        </div>

        <div style="margin-top: 15px;">
          <label for="smt-note-input" style="display: block; margin-bottom: 5px; font-weight: bold;">หมายเหตุ:</label>
          <input type="text" id="smt-note-input" maxlength="200" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="เช่น ลงรถคันขาวไปส่ง">
        </div>

        <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
          <button class="btn btn-light" id="smt-cancel-btn">ยกเลิก</button>
          <button class="btn btn-primary" id="smt-save-btn">ย้าย</button>
        </div>
      </div>
    </div>

    <style>
      #sm-modal.sm-modal-hidden, #sm-transfer-modal.sm-modal-hidden { display: none !important; }
      #sm-modal:not(.sm-modal-hidden), #sm-transfer-modal:not(.sm-modal-hidden) { display: flex !important; }
    </style>
  `;

  page.innerHTML = html;

  // Modal helpers
  const modal = document.getElementById("sm-modal");
  const openModal = () => {
    modal?.classList.remove("sm-modal-hidden");
    updatePreview();
    setTimeout(() => document.getElementById("sm-product-select")?.focus(), 50);
  };
  const closeModal = () => {
    modal?.classList.add("sm-modal-hidden");
    const sel = document.getElementById("sm-product-select"); if (sel) sel.value = '';
    const ty  = document.getElementById("sm-type-select");    if (ty)  ty.value = '';
    const wh  = document.getElementById("sm-warehouse-select"); if (wh) wh.value = '';
    const qt  = document.getElementById("sm-qty-input");      if (qt)  qt.value = '';
    const nt  = document.getElementById("sm-note-input");     if (nt)  nt.value = '';
    const pv  = document.getElementById("sm-preview");        if (pv)  pv.style.display = 'none';
  };

  // Transfer modal helpers
  const transferModal = document.getElementById("sm-transfer-modal");
  const openTransferModal = () => {
    transferModal?.classList.remove("sm-modal-hidden");
    setTimeout(() => document.getElementById("smt-product-select")?.focus(), 50);
    updateTransferFromStock();
  };
  const closeTransferModal = () => {
    transferModal?.classList.add("sm-modal-hidden");
    ["smt-product-select","smt-from-select","smt-to-select","smt-qty-input","smt-note-input"].forEach(id => {
      const e = document.getElementById(id); if (e) e.value = '';
    });
    const fs = document.getElementById("smt-from-stock"); if (fs) fs.textContent = '';
  };
  function updateTransferFromStock() {
    const pid = document.getElementById("smt-product-select")?.value;
    const wid = document.getElementById("smt-from-select")?.value;
    const el = document.getElementById("smt-from-stock");
    if (!el) return;
    if (!pid || !wid) { el.textContent = ''; return; }
    const ws = (state.warehouseStock || []).find(w =>
      String(w.product_id) === String(pid) && String(w.warehouse_id) === String(wid)
    );
    const n = Number(ws?.stock || 0);
    el.textContent = `สต็อกคลังนี้เหลือ: ${thNum(n)}`;
    el.style.color = n > 0 ? "#059669" : "#dc2626";
  }

  // Live preview: show expected stock_before / stock_after
  function updatePreview() {
    const pv = document.getElementById("sm-preview");
    if (!pv) return;
    const productIdStr = document.getElementById("sm-product-select")?.value || '';
    const movementType = document.getElementById("sm-type-select")?.value || '';
    const qtyRaw = document.getElementById("sm-qty-input")?.value;
    const qty = parseInt(qtyRaw || '0', 10);

    if (!productIdStr || !movementType || !qtyRaw || isNaN(qty) || qty <= 0) {
      pv.style.display = 'none';
      return;
    }
    const product = state.products?.find(p => String(p.id) === String(productIdStr));
    const before = Number(product?.stock) || 0;
    let after = before;
    if (movementType === 'in' || movementType === 'return') after = before + qty;
    else if (movementType === 'out' || movementType === 'sale') after = before - qty;
    else if (movementType === 'adjust') after = qty;

    const warn = after < 0 ? ' <span style="color:#c53030; font-weight:bold;">⚠️ สต็อกจะติดลบ</span>' : '';
    pv.innerHTML = `สต็อกก่อน: <b>${thNum(before)}</b> → หลัง: <b>${thNum(after)}</b>${warn}`;
    pv.style.display = 'block';
  }

  // Render movement log table
  function renderTable(movements) {
    const tbody = document.getElementById("sm-tbody");
    if (!tbody) return;

    if (!movements || movements.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="padding: 20px; text-align: center; color: #999;">ไม่มีข้อมูลเคลื่อนไหวสต็อก</td></tr>';
      return;
    }

    tbody.innerHTML = movements.map(m => {
      const color = getTypeColor(m.type);
      const typeLabel = getTypeLabel(m.type);
      const productName = getProductName(m.product_id);
      const bgColor = color === 'green' ? '#d4edda' : color === 'red' ? '#f8d7da' : color === 'yellow' ? '#fff3cd' : '#e2e3e5';

      return `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px; font-size: 13px;">${escHtml(dateTH(m.created_at))}</td>
          <td style="padding: 10px;">${escHtml(productName)}</td>
          <td style="padding: 10px; text-align: center; background: ${bgColor}; font-weight: bold;">${escHtml(typeLabel)}</td>
          <td style="padding: 10px; text-align: right;">${thNum(m.qty)}</td>
          <td style="padding: 10px; text-align: right; color:#94a3b8;font-size:11px" colspan="2">ดูใน note</td>
          <td style="padding: 10px; font-size: 13px; color: #666;">${escHtml(m.note || '-')}</td>
          <td style="padding: 10px; font-size: 13px;">${escHtml(m.created_by || '-')}</td>
        </tr>
      `;
    }).join('');
  }

  // Initial table render (sort by created_at desc)
  const sorted = [...(state.stockMovements || [])].sort((a, b) => {
    const ad = a.created_at || ''; const bd = b.created_at || '';
    return bd.localeCompare(ad);
  });
  renderTable(sorted);

  // Filter and search logic
  function applyFilters() {
    let filtered = [...(state.stockMovements || [])].sort((a, b) => {
      const ad = a.created_at || ''; const bd = b.created_at || '';
      return bd.localeCompare(ad);
    });

    const search = document.getElementById("sm-search")?.value?.toLowerCase() || '';
    const typeFilter = document.getElementById("sm-type-filter")?.value || '';
    const dateFrom = document.getElementById("sm-date-from")?.value || '';
    const dateTo = document.getElementById("sm-date-to")?.value || '';

    if (search) {
      filtered = filtered.filter(m => {
        const productName = getProductName(m.product_id).toLowerCase();
        return productName.includes(search);
      });
    }

    if (typeFilter) {
      filtered = filtered.filter(m => m.type === typeFilter);
    }

    if (dateFrom) {
      filtered = filtered.filter(m => {
        const mDate = m.created_at?.substring(0, 10) || '';
        return mDate >= dateFrom;
      });
    }

    if (dateTo) {
      filtered = filtered.filter(m => {
        const mDate = m.created_at?.substring(0, 10) || '';
        return mDate <= dateTo;
      });
    }

    renderTable(filtered);
  }

  function clearFilters() {
    const s = document.getElementById("sm-search");       if (s)  s.value = '';
    const t = document.getElementById("sm-type-filter");  if (t)  t.value = '';
    const f = document.getElementById("sm-date-from");    if (f)  f.value = '';
    const tt = document.getElementById("sm-date-to");     if (tt) tt.value = '';
    applyFilters();
  }

  // Attach event listeners — use onEvent property to avoid duplicate listeners on re-render
  const $search = document.getElementById("sm-search");
  const $typeF  = document.getElementById("sm-type-filter");
  const $dFrom  = document.getElementById("sm-date-from");
  const $dTo    = document.getElementById("sm-date-to");
  const $filter = document.getElementById("sm-filter-btn");
  const $clear  = document.getElementById("sm-clear-btn");
  const $add    = document.getElementById("sm-add-btn");
  const $close  = document.getElementById("sm-close-btn");
  const $cancel = document.getElementById("sm-cancel-btn");
  const $save   = document.getElementById("sm-save-btn");
  const $prod   = document.getElementById("sm-product-select");
  const $type   = document.getElementById("sm-type-select");
  const $qty    = document.getElementById("sm-qty-input");

  if ($search) $search.oninput  = applyFilters;
  if ($typeF)  $typeF.onchange   = applyFilters;
  if ($dFrom)  $dFrom.onchange   = applyFilters;
  if ($dTo)    $dTo.onchange     = applyFilters;
  if ($filter) $filter.onclick   = applyFilters;
  if ($clear)  $clear.onclick    = clearFilters;
  if ($add)    $add.onclick      = openModal;
  if ($close)  $close.onclick    = closeModal;
  if ($cancel) $cancel.onclick   = closeModal;

  // Transfer modal
  const $transferBtn = document.getElementById("sm-transfer-btn");
  const $smtClose = document.getElementById("smt-close-btn");
  const $smtCancel = document.getElementById("smt-cancel-btn");
  const $smtSave = document.getElementById("smt-save-btn");
  const $smtProd = document.getElementById("smt-product-select");
  const $smtFrom = document.getElementById("smt-from-select");
  if ($transferBtn) $transferBtn.onclick = openTransferModal;
  if ($smtClose) $smtClose.onclick = closeTransferModal;
  if ($smtCancel) $smtCancel.onclick = closeTransferModal;
  if ($smtProd) $smtProd.onchange = updateTransferFromStock;
  if ($smtFrom) $smtFrom.onchange = updateTransferFromStock;
  if (transferModal) transferModal.onclick = (e) => { if (e.target === transferModal) closeTransferModal(); };

  if ($smtSave) {
    $smtSave.onclick = async () => {
      const pid = document.getElementById("smt-product-select")?.value || '';
      const from = document.getElementById("smt-from-select")?.value || '';
      const to = document.getElementById("smt-to-select")?.value || '';
      const qtyRaw = document.getElementById("smt-qty-input")?.value;
      const qty = parseInt(qtyRaw || '', 10);
      const note = document.getElementById("smt-note-input")?.value || '';

      if (!pid) { showToast('กรุณาเลือกสินค้า', 'error'); return; }
      if (!from) { showToast('กรุณาเลือกคลังต้นทาง', 'error'); return; }
      if (!to) { showToast('กรุณาเลือกคลังปลายทาง', 'error'); return; }
      if (String(from) === String(to)) { showToast('คลังต้นทาง/ปลายทาง ต้องไม่ซ้ำกัน', 'error'); return; }
      if (isNaN(qty) || qty <= 0) { showToast('กรอกจำนวนที่ถูกต้อง (> 0)', 'error'); return; }

      const ws = (state.warehouseStock || []).find(w =>
        String(w.product_id) === String(pid) && String(w.warehouse_id) === String(from)
      );
      const cur = Number(ws?.stock || 0);
      if (qty > cur) {
        if (!(await window.App?.confirm?.(`⚠️ คลังต้นทางเหลือ ${cur} — ย้าย ${qty} จะติดลบ ${cur - qty} — ดำเนินการต่อ?`))) return;
      }

      const pidNum = Number(pid);
      const productId = Number.isFinite(pidNum) && String(pidNum) === pid ? pidNum : pid;
      const fromNum = Number(from), toNum = Number(to);
      const fromWarehouseId = Number.isFinite(fromNum) && String(fromNum) === from ? fromNum : from;
      const toWarehouseId = Number.isFinite(toNum) && String(toNum) === to ? toNum : to;

      $smtSave.disabled = true;
      $smtSave.textContent = 'กำลังย้าย...';
      try {
        const res = await window._appTransferWarehouseStock({ productId, fromWarehouseId, toWarehouseId, qty, note });
        if (res?.ok) {
          showToast('ย้ายสต็อกสำเร็จ', 'success');
          closeTransferModal();
          if (typeof loadAllData === 'function') await loadAllData();
        } else {
          showToast('ข้อผิดพลาด: ' + (res?.error || 'ย้ายไม่สำเร็จ'), 'error');
        }
      } catch (err) {
        showToast('ข้อผิดพลาด: ' + (err?.message || String(err)), 'error');
      } finally {
        $smtSave.disabled = false;
        $smtSave.textContent = 'ย้าย';
      }
    };
  }

  // Live preview update
  if ($prod) $prod.onchange = updatePreview;
  if ($type) $type.onchange = updatePreview;
  if ($qty)  $qty.oninput   = updatePreview;

  // Close modal on backdrop click
  if (modal) {
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  }
  // ESC closes modal
  document.onkeydown = (e) => {
    if (e.key === 'Escape') {
      if (!modal?.classList.contains('sm-modal-hidden')) closeModal();
      if (!transferModal?.classList.contains('sm-modal-hidden')) closeTransferModal();
    }
  };

  // Save movement button — Promise-based + proper validation
  if ($save) {
    $save.onclick = async () => {
      const productIdStr = document.getElementById("sm-product-select")?.value || '';
      const movementType = document.getElementById("sm-type-select")?.value || '';
      const warehouseIdStr = document.getElementById("sm-warehouse-select")?.value || '';
      const qtyRaw = document.getElementById("sm-qty-input")?.value;
      const quantity = parseInt(qtyRaw || '', 10);
      const note = document.getElementById("sm-note-input")?.value || '';

      if (!productIdStr) { showToast('กรุณาเลือกสินค้า', 'error'); return; }
      if (!movementType) { showToast('กรุณาเลือกประเภท', 'error'); return; }
      if (!warehouseIdStr) { showToast('กรุณาเลือกคลัง', 'error'); return; }
      if (isNaN(quantity) || quantity <= 0) {
        showToast('กรุณากรอกจำนวนที่ถูกต้อง (> 0)', 'error');
        return;
      }

      const productIdNum = Number(productIdStr);
      const productId = Number.isFinite(productIdNum) && String(productIdNum) === productIdStr ? productIdNum : productIdStr;
      const warehouseIdNum = Number(warehouseIdStr);
      const warehouseId = Number.isFinite(warehouseIdNum) && String(warehouseIdNum) === warehouseIdStr ? warehouseIdNum : warehouseIdStr;

      // เตือนถ้า out/sale ทำสต็อกติดลบ
      if (movementType === 'out' || movementType === 'sale') {
        const ws = (state.warehouseStock || []).find(w =>
          String(w.product_id) === String(productId) && String(w.warehouse_id) === String(warehouseId)
        );
        const cur = Number(ws?.stock || 0);
        if (cur - quantity < 0) {
          if (!(await window.App?.confirm?.(`⚠️ สต็อกคลังนี้เหลือ ${cur} — จ่ายออก ${quantity} จะติดลบ ${cur - quantity} — บันทึกต่อ?`))) return;
        }
      }

      $save.disabled = true;
      $save.textContent = 'กำลังบันทึก...';

      try {
        if (!window._appApplyStockMovement) {
          throw new Error('ระบบยังโหลดไม่เสร็จ — กรุณารีเฟรชหน้าเว็บ');
        }
        const res = await window._appApplyStockMovement({
          productId, warehouseId, movementType, qty: quantity, note
        });
        if (res && res.ok) {
          showToast('บันทึกเคลื่อนไหวสต็อกสำเร็จ', 'success');
          closeModal();
          if (typeof loadAllData === 'function') await loadAllData();
        } else {
          showToast('ข้อผิดพลาด: ' + (res?.error || 'ไม่สามารถบันทึกได้'), 'error');
        }
      } catch (err) {
        showToast('ข้อผิดพลาด: ' + (err?.message || String(err)), 'error');
      } finally {
        $save.disabled = false;
        $save.textContent = 'บันทึก';
      }
    };
  }
}
