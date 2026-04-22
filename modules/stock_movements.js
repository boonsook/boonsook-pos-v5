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

    const inCount = filtered.filter(m => m.movement_type === 'in').length;
    const outCount = filtered.filter(m => m.movement_type === 'out' || m.movement_type === 'sale').length;
    const adjustCount = filtered.filter(m => m.movement_type === 'adjust').length;

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

      <div class="mt16">
        <button class="btn btn-primary" id="sm-add-btn" aria-label="เพิ่มเคลื่อนไหวสต็อก">+ เพิ่มเคลื่อนไหวสต็อก</button>
      </div>

      <div id="sm-table-container" class="mt16" style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead style="background: #f5f5f5; border-bottom: 2px solid #ddd;">
            <tr>
              <th style="padding: 10px; text-align: left;">วันที่เวลา</th>
              <th style="padding: 10px; text-align: left;">สินค้า</th>
              <th style="padding: 10px; text-align: center;">ประเภท</th>
              <th style="padding: 10px; text-align: right;">จำนวน</th>
              <th style="padding: 10px; text-align: right;">ก่อน</th>
              <th style="padding: 10px; text-align: right;">หลัง</th>
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
            <option value="in">รับเข้า</option>
            <option value="out">จ่ายออก</option>
            <option value="adjust">ปรับสต็อก</option>
            <option value="sale">ขาย</option>
            <option value="return">คืนสินค้า</option>
            <option value="transfer">โอนย้าย</option>
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

    <style>
      #sm-modal.sm-modal-hidden { display: none !important; }
      #sm-modal:not(.sm-modal-hidden) { display: flex !important; }
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
    const qt  = document.getElementById("sm-qty-input");      if (qt)  qt.value = '';
    const nt  = document.getElementById("sm-note-input");     if (nt)  nt.value = '';
    const pv  = document.getElementById("sm-preview");        if (pv)  pv.style.display = 'none';
  };

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
    else if (movementType === 'adjust' || movementType === 'transfer') after = qty;

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
      const color = getTypeColor(m.movement_type);
      const typeLabel = getTypeLabel(m.movement_type);
      const productName = getProductName(m.product_id);
      const bgColor = color === 'green' ? '#d4edda' : color === 'red' ? '#f8d7da' : color === 'yellow' ? '#fff3cd' : '#e2e3e5';

      return `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px; font-size: 13px;">${escHtml(dateTH(m.created_at))}</td>
          <td style="padding: 10px;">${escHtml(productName)}</td>
          <td style="padding: 10px; text-align: center; background: ${bgColor}; font-weight: bold;">${escHtml(typeLabel)}</td>
          <td style="padding: 10px; text-align: right;">${thNum(m.quantity)}</td>
          <td style="padding: 10px; text-align: right;">${thNum(m.stock_before)}</td>
          <td style="padding: 10px; text-align: right;">${thNum(m.stock_after)}</td>
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
      filtered = filtered.filter(m => m.movement_type === typeFilter);
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
    if (e.key === 'Escape' && !modal?.classList.contains('sm-modal-hidden')) {
      closeModal();
    }
  };

  // Save movement button — Promise-based + proper validation
  if ($save) {
    $save.onclick = async () => {
      const productIdStr = document.getElementById("sm-product-select")?.value || '';
      const movementType = document.getElementById("sm-type-select")?.value || '';
      const qtyRaw = document.getElementById("sm-qty-input")?.value;
      const quantity = parseInt(qtyRaw || '', 10);
      const note = document.getElementById("sm-note-input")?.value || '';

      if (!productIdStr) {
        showToast('กรุณาเลือกสินค้า', 'error');
        return;
      }
      if (!movementType) {
        showToast('กรุณาเลือกประเภท', 'error');
        return;
      }
      if (isNaN(quantity) || quantity <= 0) {
        showToast('กรุณากรอกจำนวนที่ถูกต้อง (> 0)', 'error');
        return;
      }

      // product_id should be numeric if the DB column is integer
      const productIdNum = Number(productIdStr);
      const productId = Number.isFinite(productIdNum) && String(productIdNum) === productIdStr
        ? productIdNum
        : productIdStr;

      // Find current stock (compare as strings for safety)
      const product = state.products?.find(p => String(p.id) === String(productIdStr));
      const currentStock = Number(product?.stock) || 0;
      let newStock = currentStock;

      if (movementType === 'in' || movementType === 'return') {
        newStock = currentStock + quantity;
      } else if (movementType === 'out' || movementType === 'sale') {
        newStock = currentStock - quantity;
        if (newStock < 0) {
          const ok = await window.App?.confirm?.(
            `⚠️ คำเตือน: สต็อกหลังจะติดลบ (${newStock})\n` +
            `สต็อกปัจจุบัน: ${currentStock}\n` +
            `จำนวนที่จะหัก: ${quantity}\n\n` +
            `ต้องการบันทึกต่อหรือไม่?`
          );
          if (!ok) return;
        }
      } else if (movementType === 'adjust' || movementType === 'transfer') {
        newStock = quantity;
      }

      const payload = {
        product_id: productId,
        movement_type: movementType,
        quantity: quantity,
        stock_before: currentStock,
        stock_after: newStock,
        note: String(note).slice(0, 200),
        created_by: String(currentRole || 'User'),
        created_at: new Date().toISOString()
      };

      // Disable save button while request in flight
      $save.disabled = true;
      $save.textContent = 'กำลังบันทึก...';

      try {
        if (!window._appXhrPost) {
          throw new Error('ระบบยังโหลดไม่เสร็จ — กรุณารีเฟรชหน้าเว็บ');
        }
        const res = await window._appXhrPost('stock_movements', payload);
        if (res && res.ok) {
          showToast('บันทึกเคลื่อนไหวสต็อกสำเร็จ', 'success');
          closeModal();
          if (typeof loadAllData === 'function') {
            await loadAllData();
          }
        } else {
          const msg = res?.error?.message || 'ไม่สามารถบันทึกได้';
          showToast('ข้อผิดพลาด: ' + msg, 'error');
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
