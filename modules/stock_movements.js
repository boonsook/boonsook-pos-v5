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

  // Get product name by ID
  function getProductName(productId) {
    const product = state.products?.find(p => p.id === productId);
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

  let html = `
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

      <div class="mt16">
        <div class="row">
          <input type="text" id="sm-search" class="sm-search" placeholder="ค้นหาสินค้า..." style="flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px; margin-right: 8px;">
          <select id="sm-type-filter" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px; margin-right: 8px;">
            <option value="">ทั้งหมด</option>
            <option value="in">รับเข้า</option>
            <option value="out">จ่ายออก</option>
            <option value="adjust">ปรับสต็อก</option>
            <option value="sale">ขาย</option>
            <option value="return">คืนสินค้า</option>
            <option value="transfer">โอนย้าย</option>
          </select>
          <input type="date" id="sm-date-from" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px; margin-right: 8px;">
          <input type="date" id="sm-date-to" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px; margin-right: 8px;">
          <button class="btn btn-light" id="sm-filter-btn" onclick="document.getElementById('sm-filter-btn').click();">ค้นหา</button>
        </div>
      </div>

      <div class="mt16">
        <button class="btn btn-primary" id="sm-add-btn">+ เพิ่มเคลื่อนไหวสต็อก</button>
      </div>

      <div id="sm-table-container" class="mt16">
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
    <div id="sm-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center;">
      <div style="background: white; padding: 20px; border-radius: 8px; width: 90%; max-width: 500px; max-height: 80vh; overflow-y: auto;">
        <h3>เพิ่มเคลื่อนไหวสต็อก</h3>

        <div style="margin-top: 15px;">
          <label style="display: block; margin-bottom: 5px; font-weight: bold;">เลือกสินค้า:</label>
          <select id="sm-product-select" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
            <option value="">-- เลือกสินค้า --</option>
            ${(state.products || []).map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
          </select>
        </div>

        <div style="margin-top: 15px;">
          <label style="display: block; margin-bottom: 5px; font-weight: bold;">ประเภท:</label>
          <select id="sm-type-select" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
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
          <label style="display: block; margin-bottom: 5px; font-weight: bold;">จำนวน:</label>
          <input type="number" id="sm-qty-input" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="กรอกจำนวน" min="0">
        </div>

        <div style="margin-top: 15px;">
          <label style="display: block; margin-bottom: 5px; font-weight: bold;">หมายเหตุ:</label>
          <input type="text" id="sm-note-input" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="หมายเหตุ (ตัวเลือก)">
        </div>

        <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
          <button class="btn btn-light" onclick="document.getElementById('sm-modal').style.display = 'none';">ยกเลิก</button>
          <button class="btn btn-primary" id="sm-save-btn">บันทึก</button>
        </div>
      </div>
    </div>
  `;

  page.innerHTML = html;

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
          <td style="padding: 10px; font-size: 13px;">${dateTH(m.created_at)}</td>
          <td style="padding: 10px;">${productName}</td>
          <td style="padding: 10px; text-align: center; background: ${bgColor}; font-weight: bold;">${typeLabel}</td>
          <td style="padding: 10px; text-align: right;">${m.quantity || 0}</td>
          <td style="padding: 10px; text-align: right;">${m.stock_before || 0}</td>
          <td style="padding: 10px; text-align: right;">${m.stock_after || 0}</td>
          <td style="padding: 10px; font-size: 13px; color: #666;">${m.note || '-'}</td>
          <td style="padding: 10px; font-size: 13px;">${m.created_by || '-'}</td>
        </tr>
      `;
    }).join('');
  }

  // Initial table render
  renderTable(state.stockMovements || []);

  // Filter and search logic
  function applyFilters() {
    let filtered = [...(state.stockMovements || [])];

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

  // Attach event listeners
  document.getElementById("sm-search")?.addEventListener('input', applyFilters);
  document.getElementById("sm-type-filter")?.addEventListener('change', applyFilters);
  document.getElementById("sm-date-from")?.addEventListener('change', applyFilters);
  document.getElementById("sm-date-to")?.addEventListener('change', applyFilters);
  document.getElementById("sm-filter-btn")?.addEventListener('click', applyFilters);

  // Add movement button
  document.getElementById("sm-add-btn")?.addEventListener('click', () => {
    document.getElementById("sm-modal").style.display = 'flex';
  });

  // Save movement button
  document.getElementById("sm-save-btn")?.addEventListener('click', () => {
    const productId = document.getElementById("sm-product-select")?.value;
    const movementType = document.getElementById("sm-type-select")?.value;
    const quantity = parseInt(document.getElementById("sm-qty-input")?.value || '0', 10);
    const note = document.getElementById("sm-note-input")?.value || '';

    if (!productId) {
      showToast('กรุณาเลือกสินค้า', 'error');
      return;
    }
    if (!movementType) {
      showToast('กรุณาเลือกประเภท', 'error');
      return;
    }
    if (quantity <= 0) {
      showToast('กรุณากรอกจำนวนที่ถูกต้อง', 'error');
      return;
    }

    // Find current stock
    const product = state.products?.find(p => p.id === productId);
    const currentStock = product?.stock || 0;
    let newStock = currentStock;

    if (movementType === 'in' || movementType === 'return') {
      newStock = currentStock + quantity;
    } else if (movementType === 'out' || movementType === 'sale') {
      newStock = currentStock - quantity;
    } else if (movementType === 'adjust' || movementType === 'transfer') {
      newStock = quantity;
    }

    const payload = {
      product_id: productId,
      movement_type: movementType,
      quantity: quantity,
      stock_before: currentStock,
      stock_after: newStock,
      note: note,
      created_by: currentRole || 'User',
      created_at: new Date().toISOString()
    };

    window._appXhrPost('stock_movements', payload, {
      success: () => {
        showToast('บันทึกเคลื่อนไหวสต็อกสำเร็จ', 'success');
        document.getElementById("sm-modal").style.display = 'none';
        document.getElementById("sm-product-select").value = '';
        document.getElementById("sm-type-select").value = '';
        document.getElementById("sm-qty-input").value = '';
        document.getElementById("sm-note-input").value = '';
        loadAllData();
      },
      error: (err) => {
        showToast('ข้อผิดพลาด: ' + (err?.message || 'ไม่สามารถบันทึกได้'), 'error');
      }
    });
  });
}
