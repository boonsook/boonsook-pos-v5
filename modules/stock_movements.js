export function renderStockMovementsPage(ctx) {
  const { state, money, showToast, loadAllData, currentRole, requireAdmin } = ctx;

  function dateTH(d) {
    if (!d) return "-";
    try {
      return new Date(d).toLocaleDateString("th-TH", {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit"
      });
    } catch (e) { return d; }
  }

  function getProductName(productId) {
    const product = state.products?.find(p => p.id === Number(productId)); // ★ Fix: Number()
    return product ? product.name : `(ID: ${productId})`;
  }

  function getTypeColor(type) {
    if (type === 'in' || type === 'return') return 'green';
    if (type === 'out' || type === 'sale') return 'red';
    if (type === 'adjust' || type === 'transfer') return 'yellow';
    return 'gray';
  }

  function getTypeLabel(type) {
    const labels = {
      'in': 'รับเข้า', 'out': 'จ่ายออก', 'adjust': 'ปรับสต็อก',
      'transfer': 'โอนย้าย', 'sale': 'ขาย', 'return': 'คืนสินค้า'
    };
    return labels[type] || type;
  }

  function getMonthlyStats() {
    const now = new Date();
    const currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const movements = state.stockMovements || [];
    const filtered = movements.filter(m => m.created_at?.substring(0, 7) === currentMonth);
    return {
      inCount:     filtered.filter(m => m.movement_type === 'in').length,
      outCount:    filtered.filter(m => m.movement_type === 'out' || m.movement_type === 'sale').length,
      adjustCount: filtered.filter(m => m.movement_type === 'adjust').length
    };
  }

  const page = document.getElementById("page-stock_movements");
  if (!page) return;

  const stats = getMonthlyStats();

  page.innerHTML = `
    <div class="panel">
      <h2>ประวัติเคลื่อนไหวสต็อก</h2>

      <div class="stats-grid mt16">
        <div class="stat-card">
          <div class="stat-value">${stats.inCount}</div>
          <div class="stat-label">รายการเข้า</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.outCount}</div>
          <div class="stat-label">รายการออก</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.adjustCount}</div>
          <div class="stat-label">ปรับสต็อก</div>
        </div>
      </div>

      <div class="mt16" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="text" id="sm-search" placeholder="ค้นหาสินค้า..." style="flex:1;min-width:140px;padding:8px;border:1px solid #ccc;border-radius:4px">
        <select id="sm-type-filter" style="padding:8px;border:1px solid #ccc;border-radius:4px">
          <option value="">ทั้งหมด</option>
          <option value="in">รับเข้า</option>
          <option value="out">จ่ายออก</option>
          <option value="adjust">ปรับสต็อก</option>
          <option value="sale">ขาย</option>
          <option value="return">คืนสินค้า</option>
          <option value="transfer">โอนย้าย</option>
        </select>
        <input type="date" id="sm-date-from" style="padding:8px;border:1px solid #ccc;border-radius:4px">
        <input type="date" id="sm-date-to" style="padding:8px;border:1px solid #ccc;border-radius:4px">
      </div>

      <div class="mt16">
        <button class="btn primary" id="sm-add-btn">+ เพิ่มเคลื่อนไหวสต็อก</button>
      </div>

      <div class="mt16" style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead style="background:#f5f5f5;border-bottom:2px solid #ddd">
            <tr>
              <th style="padding:10px;text-align:left">วันที่เวลา</th>
              <th style="padding:10px;text-align:left">สินค้า</th>
              <th style="padding:10px;text-align:center">ประเภท</th>
              <th style="padding:10px;text-align:right">จำนวน</th>
              <th style="padding:10px;text-align:right">ก่อน</th>
              <th style="padding:10px;text-align:right">หลัง</th>
              <th style="padding:10px;text-align:left">หมายเหตุ</th>
              <th style="padding:10px;text-align:left">ผู้ทำ</th>
            </tr>
          </thead>
          <tbody id="sm-tbody"></tbody>
        </table>
      </div>
    </div>

    <!-- Modal -->
    <div id="sm-modal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:1000;justify-content:center;align-items:center">
      <div style="background:#fff;padding:24px;border-radius:10px;width:90%;max-width:500px;max-height:80vh;overflow-y:auto">
        <h3 style="margin:0 0 16px">เพิ่มเคลื่อนไหวสต็อก</h3>

        <label style="display:block;margin-bottom:4px;font-weight:600">เลือกสินค้า</label>
        <select id="sm-product-select" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box">
          <option value="">-- เลือกสินค้า --</option>
          ${(state.products || []).filter(p => p.product_type !== 'service').map(p =>
            `<option value="${p.id}">${p.name} (คงเหลือ: ${p.stock || 0})</option>`
          ).join('')}
        </select>

        <div id="sm-stock-hint" style="margin:8px 0 0;padding:6px 10px;background:#f0f9ff;border-radius:6px;font-size:13px;color:#0369a1;display:none"></div>

        <label style="display:block;margin:14px 0 4px;font-weight:600">ประเภท</label>
        <select id="sm-type-select" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box">
          <option value="">-- เลือกประเภท --</option>
          <option value="in">รับเข้า (+)</option>
          <option value="out">จ่ายออก (-)</option>
          <option value="adjust">ปรับสต็อก (ตั้งค่าใหม่ =)</option>
          <option value="return">คืนสินค้า (+)</option>
          <option value="transfer">โอนย้าย (-)</option>
        </select>

        <label style="display:block;margin:14px 0 4px;font-weight:600">จำนวน</label>
        <input type="number" id="sm-qty-input" min="1" placeholder="กรอกจำนวน"
          style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box">

        <label style="display:block;margin:14px 0 4px;font-weight:600">หมายเหตุ</label>
        <input type="text" id="sm-note-input" placeholder="หมายเหตุ (ตัวเลือก)"
          style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box">

        <div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end">
          <button class="btn light" id="sm-cancel-btn">ยกเลิก</button>
          <button class="btn primary" id="sm-save-btn">บันทึก</button>
        </div>
      </div>
    </div>
  `;

  // ─── Render table ───
  function renderTable(movements) {
    const tbody = page.querySelector("#sm-tbody");
    if (!tbody) return;
    if (!movements?.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="padding:20px;text-align:center;color:#999">ไม่มีข้อมูลเคลื่อนไหวสต็อก</td></tr>';
      return;
    }
    const sorted = [...movements].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    tbody.innerHTML = sorted.map(m => {
      const color = getTypeColor(m.movement_type);
      const bg = color === 'green' ? '#d4edda' : color === 'red' ? '#f8d7da' : color === 'yellow' ? '#fff3cd' : '#e2e3e5';
      const valColor = color === 'green' ? '#16a34a' : color === 'red' ? '#dc2626' : '#92400e';
      return `
        <tr style="border-bottom:1px solid #eee">
          <td style="padding:10px;font-size:13px;white-space:nowrap">${dateTH(m.created_at)}</td>
          <td style="padding:10px">${getProductName(m.product_id)}</td>
          <td style="padding:10px;text-align:center;background:${bg};font-weight:700;white-space:nowrap">${getTypeLabel(m.movement_type)}</td>
          <td style="padding:10px;text-align:right;font-weight:700">${m.quantity || 0}</td>
          <td style="padding:10px;text-align:right;color:#64748b">${m.stock_before ?? '-'}</td>
          <td style="padding:10px;text-align:right;font-weight:600;color:${valColor}">${m.stock_after ?? '-'}</td>
          <td style="padding:10px;font-size:13px;color:#666">${m.note || '-'}</td>
          <td style="padding:10px;font-size:13px">${m.created_by || '-'}</td>
        </tr>`;
    }).join('');
  }

  renderTable(state.stockMovements || []);

  // ─── Filter ───
  function applyFilters() {
    let f = [...(state.stockMovements || [])];
    const search = page.querySelector("#sm-search")?.value?.toLowerCase() || '';
    const type   = page.querySelector("#sm-type-filter")?.value || '';
    const from   = page.querySelector("#sm-date-from")?.value || '';
    const to     = page.querySelector("#sm-date-to")?.value || '';
    if (search) f = f.filter(m => getProductName(m.product_id).toLowerCase().includes(search));
    if (type)   f = f.filter(m => m.movement_type === type);
    if (from)   f = f.filter(m => (m.created_at?.substring(0, 10) || '') >= from);
    if (to)     f = f.filter(m => (m.created_at?.substring(0, 10) || '') <= to);
    renderTable(f);
  }

  page.querySelector("#sm-search")?.addEventListener('input', applyFilters);
  page.querySelector("#sm-type-filter")?.addEventListener('change', applyFilters);
  page.querySelector("#sm-date-from")?.addEventListener('change', applyFilters);
  page.querySelector("#sm-date-to")?.addEventListener('change', applyFilters);

  // แสดง hint เมื่อเลือกสินค้า
  page.querySelector("#sm-product-select")?.addEventListener('change', () => {
    const pid = Number(page.querySelector("#sm-product-select")?.value);
    const prod = state.products?.find(p => p.id === pid);
    const hint = page.querySelector("#sm-stock-hint");
    if (prod && hint) {
      hint.style.display = 'block';
      hint.textContent = `📦 ${prod.name} — คงเหลือปัจจุบัน: ${prod.stock || 0} ชิ้น`;
    } else if (hint) { hint.style.display = 'none'; }
  });

  // Open modal
  page.querySelector("#sm-add-btn")?.addEventListener('click', () => {
    page.querySelector("#sm-product-select").value = '';
    page.querySelector("#sm-type-select").value = '';
    page.querySelector("#sm-qty-input").value = '';
    page.querySelector("#sm-note-input").value = '';
    const hint = page.querySelector("#sm-stock-hint");
    if (hint) hint.style.display = 'none';
    page.querySelector("#sm-modal").style.display = 'flex';
  });

  page.querySelector("#sm-cancel-btn")?.addEventListener('click', () => {
    page.querySelector("#sm-modal").style.display = 'none';
  });

  // ★ Save — fixed: async/await, Number type, currentRole(), updates products.stock
  page.querySelector("#sm-save-btn")?.addEventListener('click', async () => {
    const productId    = Number(page.querySelector("#sm-product-select")?.value);
    const movementType = page.querySelector("#sm-type-select")?.value;
    const quantity     = parseInt(page.querySelector("#sm-qty-input")?.value || '0', 10);
    const note         = page.querySelector("#sm-note-input")?.value?.trim() || '';

    if (!productId)    { showToast('กรุณาเลือกสินค้า'); return; }
    if (!movementType) { showToast('กรุณาเลือกประเภท'); return; }
    if (!quantity || quantity <= 0) { showToast('กรุณากรอกจำนวนที่ถูกต้อง'); return; }

    // ★ Fix: Number() แล้ว find() จะ match ได้
    const product = state.products?.find(p => p.id === productId);
    if (!product) { showToast('ไม่พบสินค้าที่เลือก'); return; }

    const currentStock = Number(product.stock || 0);
    let newStock = currentStock;

    if (movementType === 'in' || movementType === 'return') {
      newStock = currentStock + quantity;
    } else if (movementType === 'out' || movementType === 'sale') {
      if (currentStock < quantity) { showToast(`⚠️ สต็อกไม่พอ (มีอยู่ ${currentStock} ชิ้น)`); return; }
      newStock = currentStock - quantity;
    } else if (movementType === 'adjust') {
      newStock = quantity;
    } else if (movementType === 'transfer') {
      if (currentStock < quantity) { showToast(`⚠️ สต็อกไม่พอ (มีอยู่ ${currentStock} ชิ้น)`); return; }
      newStock = currentStock - quantity;
    }

    // ★ Fix: currentRole เป็น function ต้องเรียก currentRole()
    const createdBy = typeof currentRole === 'function'
      ? (currentRole() || state.currentUser?.email || 'User')
      : (state.profile?.full_name || state.currentUser?.email || 'User');

    const saveBtn = page.querySelector("#sm-save-btn");
    saveBtn.disabled = true;
    saveBtn.textContent = 'กำลังบันทึก...';

    try {
      // 1. บันทึก movement log
      const res = await window._appXhrPost('stock_movements', {
        product_id:    productId,       // ★ Number แล้ว
        movement_type: movementType,
        quantity:      quantity,
        stock_before:  currentStock,
        stock_after:   newStock,
        note:          note,
        created_by:    createdBy,       // ★ string จริง
        created_at:    new Date().toISOString()
      });

      if (!res.ok) {
        showToast('บันทึกไม่สำเร็จ: ' + (res.error?.message || 'ไม่ทราบสาเหตุ'));
        return;
      }

      // 2. ★ Fix: อัปเดต stock จริงใน products table
      const patchRes = await window._appXhrPatch('products', { stock: newStock }, 'id', productId);
      if (!patchRes.ok) {
        showToast('⚠️ บันทึก log แล้ว แต่อัปเดตสต็อกไม่สำเร็จ: ' + (patchRes.error?.message || ''));
        return;
      }

      // 3. อัปเดต local state ทันที
      product.stock = newStock;

      showToast(`✅ บันทึกสำเร็จ — ${getTypeLabel(movementType)} ${quantity} ชิ้น | สต็อกใหม่: ${newStock}`);
      page.querySelector("#sm-modal").style.display = 'none';

      // 4. Reload และ re-render
      if (typeof loadAllData === 'function') await loadAllData();
      renderTable(state.stockMovements || []);

    } catch (err) {
      showToast('เกิดข้อผิดพลาด: ' + (err.message || err));
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'บันทึก';
    }
  });
}
