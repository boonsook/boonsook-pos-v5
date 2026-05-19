/**
 * Loyalty Points (สะสมแต้ม) Module for Boonsook POS V5 PRO
 * Manages customer loyalty program with points earning, redemption, and settings
 */

function money(n) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
  }).format(Number(n || 0));
}

// Phase 51: dedup + fix XSS gap (added apostrophe escape via shared utils)
import { escHtml } from "./utils.js";

function dateTH(d) {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("th-TH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (e) {
    return d;
  }
}

/**
 * Get total points for a customer (earned - redeemed)
 */
export function getCustomerPoints(customerId, ctx) {
  const { state } = ctx;
  const transactions = state.loyaltyPoints || [];

  let totalEarned = 0;
  let totalRedeemed = 0;

  // Phase 90.10: cast both sides — customers.id is bigint (number from DB) but
  // <select>.value (and Object.entries keys) are strings. `1 === "1"` is false.
  const cidStr = String(customerId);
  transactions.forEach(t => {
    if (String(t.customer_id) === cidStr) {
      if (t.type === 'earn') {
        totalEarned += Number(t.points || 0);
      } else if (t.type === 'redeem') {
        totalRedeemed += Number(t.points || 0);
      }
    }
  });

  return {
    earned: totalEarned,
    redeemed: totalRedeemed,
    remaining: totalEarned - totalRedeemed,
  };
}

/**
 * Add points from a sale
 */
export async function earnPoints(customerId, amount, refType, refId, ctx) {
  const { state, showToast, loadAllData } = ctx;
  const settings = state.loyaltySettings || {};

  // Phase 90.9: every exit path returns {ok, error} so callers (e.g. manual tab) can decide whether to clear UI.
  if (!settings.is_active) {
    if (showToast) showToast("ระบบแต้มไม่เปิดใช้งาน", "warning");
    return { ok: false, error: { message: "ระบบแต้มไม่เปิดใช้งาน" } };
  }

  const pointsPerBaht = Number(settings.points_per_baht || 0);
  if (pointsPerBaht <= 0) {
    if (showToast) showToast("ยังไม่ตั้งค่าอัตราแต้ม", "warning");
    return { ok: false, error: { message: "ยังไม่ตั้งค่าอัตราแต้ม" } };
  }

  const pointsToAdd = Math.floor(Number(amount || 0) * pointsPerBaht);

  if (pointsToAdd <= 0) return { ok: false, error: { message: "amount เล็กเกินไป" } };

  const newRecord = {
    customer_id: customerId,
    type: 'earn',
    points: pointsToAdd,
    ref_type: refType || 'sale',
    ref_id: refId || null,
    note: null,
    created_at: new Date().toISOString(),
  };

  // Phase 90.8: was _appXhrPost('/api/loyalty-points', rec, cb) — wrong URL (Supabase table name expected) + callback ignored (xhrPost returns a Promise).
  const r = await window._appXhrPost('loyalty_points', newRecord);
  if (r?.ok) {
    if (showToast) showToast(`บันทึกแต้ม ${pointsToAdd} แต้มสำหรับลูกค้า`, "success");
    if (loadAllData) loadAllData();
    return { ok: true, error: null };
  }
  if (showToast) showToast('บันทึกแต้มล้มเหลว: ' + (r?.error?.message || 'unknown'), "error");
  return { ok: false, error: r?.error || { message: "unknown" } };
}

/**
 * Redeem points
 */
export async function redeemPoints(customerId, points, note, ctx) {
  const { state, showToast, loadAllData, requireAdmin: _requireAdmin } = ctx;
  const settings = state.loyaltySettings || {};

  // Phase 90.9: every exit path returns {ok, error} so the manual tab handler can clear form only on success
  // (previous bug: form cleared even when redeem failed early — "insufficient points", "below min_redeem", etc.).
  if (!settings.is_active) {
    if (showToast) showToast("ระบบแต้มไม่เปิดใช้งาน", "warning");
    return { ok: false, error: { message: "ระบบแต้มไม่เปิดใช้งาน" } };
  }

  const minRedeem = Number(settings.min_redeem || 0);
  if (Number(points || 0) < minRedeem) {
    if (showToast) showToast(`ต้องแลกอย่างน้อย ${minRedeem} แต้ม`, "warning");
    return { ok: false, error: { message: `ต้องแลกอย่างน้อย ${minRedeem} แต้ม` } };
  }

  const customerPoints = getCustomerPoints(customerId, ctx);
  if (customerPoints.remaining < Number(points || 0)) {
    if (showToast) showToast("แต้มไม่พอแลก", "error");
    return { ok: false, error: { message: "แต้มไม่พอแลก" } };
  }

  const newRecord = {
    customer_id: customerId,
    type: 'redeem',
    points: Number(points || 0),
    ref_type: 'redemption',
    ref_id: null,
    note: note || null,
    created_at: new Date().toISOString(),
  };

  // Phase 90.8: same signature fix as earnPoints — table name + Promise pattern.
  const r = await window._appXhrPost('loyalty_points', newRecord);
  if (r?.ok) {
    if (showToast) showToast(`แลกแต้ม ${points} แต้ม สำเร็จ`, "success");
    if (loadAllData) loadAllData();
    return { ok: true, error: null };
  }
  if (showToast) showToast('แลกแต้มล้มเหลว: ' + (r?.error?.message || 'unknown'), "error");
  return { ok: false, error: r?.error || { message: "unknown" } };
}

/**
 * Main loyalty page renderer
 */
export function renderLoyaltyPage(ctx) {
  // Phase 90.12: requireAdmin is now used at the settings save handler (defense-in-depth).
  const { state, money: _moneyFn, showToast: _showToast, loadAllData: _loadAllData, currentRole, requireAdmin } = ctx;

  const container = document.getElementById("page-loyalty");
  if (!container) return;

  const loyaltyPoints = state.loyaltyPoints || [];
  const settings = state.loyaltySettings || {};
  const customers = state.customers || [];

  // Calculate summary stats
  const customersWithPoints = new Set(
    loyaltyPoints
      .filter(t => t.type === 'earn')
      .map(t => t.customer_id)
  ).size;

  const totalEarned = loyaltyPoints
    .filter(t => t.type === 'earn')
    .reduce((sum, t) => sum + Number(t.points || 0), 0);

  const totalRedeemed = loyaltyPoints
    .filter(t => t.type === 'redeem')
    .reduce((sum, t) => sum + Number(t.points || 0), 0);

  const totalRemaining = totalEarned - totalRedeemed;
  const totalValue = totalRemaining * Number(settings.points_value || 0);

  // Phase 90.4 Bug 2: currentRole is a function (main.js:1022) — must call it
  // (was comparing function reference vs string -> always false -> admins blocked from Settings tab)
  const isAdmin = currentRole() === 'admin' || currentRole() === 'super_admin';

  const html = `
    <div style="padding: 20px;">
      <h1 style="margin-bottom: 30px;">สะสมแต้มลูกค้า (Loyalty Points)</h1>

      <!-- Summary Cards -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 40px;">
        <div style="background: #f0f8ff; border-radius: 8px; padding: 20px; border-left: 4px solid #4a90e2;">
          <div style="font-size: 12px; color: #666; margin-bottom: 8px;">สมาชิกทั้งหมด</div>
          <div style="font-size: 28px; font-weight: bold; color: #4a90e2;">${customersWithPoints}</div>
          <div style="font-size: 11px; color: #999; margin-top: 8px;">คน</div>
        </div>

        <div style="background: #f0fff4; border-radius: 8px; padding: 20px; border-left: 4px solid #52c41a;">
          <div style="font-size: 12px; color: #666; margin-bottom: 8px;">แต้มที่แจกไป</div>
          <div style="font-size: 28px; font-weight: bold; color: #52c41a;">${totalEarned.toLocaleString('th-TH')}</div>
          <div style="font-size: 11px; color: #999; margin-top: 8px;">แต้ม</div>
        </div>

        <div style="background: #fff1f0; border-radius: 8px; padding: 20px; border-left: 4px solid #ff4d4f;">
          <div style="font-size: 12px; color: #666; margin-bottom: 8px;">แต้มที่ใช้ไป</div>
          <div style="font-size: 28px; font-weight: bold; color: #ff4d4f;">${totalRedeemed.toLocaleString('th-TH')}</div>
          <div style="font-size: 11px; color: #999; margin-top: 8px;">แต้ม</div>
        </div>

        <div style="background: #fef7e0; border-radius: 8px; padding: 20px; border-left: 4px solid #faad14;">
          <div style="font-size: 12px; color: #666; margin-bottom: 8px;">แต้มคงเหลือรวม</div>
          <div style="font-size: 28px; font-weight: bold; color: #faad14;">${totalRemaining.toLocaleString('th-TH')}</div>
          <div style="font-size: 11px; color: #999; margin-top: 8px;">แต้ม (${money(totalValue)})</div>
        </div>
      </div>

      <!-- Tabs Navigation -->
      <div style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid #ddd; padding-bottom: 10px;">
        <button class="loyalty-tab-btn" data-tab="summary" style="padding: 10px 20px; border: none; background: none; cursor: pointer; font-weight: bold; color: #4a90e2; border-bottom: 2px solid #4a90e2;">สรุปแต้ม</button>
        <button class="loyalty-tab-btn" data-tab="settings" style="padding: 10px 20px; border: none; background: none; cursor: pointer; font-weight: normal; color: #999;">ตั้งค่า</button>
        <button class="loyalty-tab-btn" data-tab="manual" style="padding: 10px 20px; border: none; background: none; cursor: pointer; font-weight: normal; color: #999;">เพิ่ม/แลก</button>
      </div>

      <!-- Tab Content -->
      <div id="loyalty-tab-summary" style="display: block;">
        ${renderSummaryTab(loyaltyPoints, customers, settings, ctx)}
      </div>

      <div id="loyalty-tab-settings" style="display: none;">
        ${isAdmin ? renderSettingsTab(settings, ctx) : '<p style="color: #999; text-align: center; padding: 20px;">เฉพาะผู้ดูแลระบบเท่านั้น</p>'}
      </div>

      <div id="loyalty-tab-manual" style="display: none;">
        ${renderManualTab(customers, ctx)}
      </div>

      <!-- Point History Modal -->
      <div id="loyalty-history-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; padding: 20px; overflow-y: auto;">
        <div style="background: white; border-radius: 8px; margin: 50px auto 20px; max-width: 600px; max-height: calc(100vh - 80px); overflow-y: auto; padding-bottom: 20px;">
          <div style="padding: 20px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center;">
            <h3 id="loyalty-history-title" style="margin: 0;">ประวัติแต้ม</h3>
            <button id="loyalty-history-close" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #999;">✕</button>
          </div>
          <div id="loyalty-history-content" style="padding: 20px;"></div>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Phase 89.23: history modal close button (was inline onclick)
  document.getElementById('loyalty-history-close')?.addEventListener('click', () => {
    const m = document.getElementById('loyalty-history-modal');
    if (m) m.style.display = 'none';
  });

  // Tab switching
  document.querySelectorAll('.loyalty-tab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const tabName = this.dataset.tab;

      // Hide all tabs
      document.querySelectorAll('[id^="loyalty-tab-"]').forEach(el => {
        el.style.display = 'none';
      });

      // Show selected tab
      const tabEl = document.getElementById(`loyalty-tab-${tabName}`);
      if (tabEl) tabEl.style.display = 'block';

      // Update button styles
      document.querySelectorAll('.loyalty-tab-btn').forEach(b => {
        b.style.fontWeight = 'normal';
        b.style.color = '#999';
        b.style.borderBottom = 'none';
      });
      this.style.fontWeight = 'bold';
      this.style.color = '#4a90e2';
      this.style.borderBottom = '2px solid #4a90e2';
    });
  });
}

function renderSummaryTab(loyaltyPoints, customers, settings, ctx) {
  // Group points by customer
  const customerPointsMap = {};

  loyaltyPoints.forEach(t => {
    if (!customerPointsMap[t.customer_id]) {
      customerPointsMap[t.customer_id] = { earned: 0, redeemed: 0 };
    }
    if (t.type === 'earn') {
      customerPointsMap[t.customer_id].earned += Number(t.points || 0);
    } else if (t.type === 'redeem') {
      customerPointsMap[t.customer_id].redeemed += Number(t.points || 0);
    }
  });

  const _pointsPerValue = Number(settings.points_value || 0);
  const pointsValue = Number(settings.points_value || 0);

  const rows = Object.entries(customerPointsMap)
    .map(([customerId, points]) => {
      // Phase 90.10: customerId here is an Object.entries key (always string) but c.id is bigint (number).
      const customer = customers.find(c => String(c.id) === String(customerId));
      const remaining = points.earned - points.redeemed;
      const value = remaining * pointsValue;

      return {
        customerId,
        name: customer?.name || `ลูกค้า #${customerId}`,
        earned: points.earned,
        redeemed: points.redeemed,
        remaining,
        value,
      };
    })
    .sort((a, b) => b.remaining - a.remaining);

  let searchHtml = '';
  if (rows.length > 10) {
    searchHtml = `
      <div style="margin-bottom: 15px;">
        <input type="text" id="loyalty-customer-search" placeholder="ค้นหาลูกค้า..." style="padding: 8px 12px; width: 250px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
      </div>
    `;
  }

  let tableHtml = `
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
      <thead>
        <tr style="background: #f5f5f5; border-bottom: 1px solid #ddd;">
          <th style="padding: 10px; text-align: left;">ลูกค้า</th>
          <th style="padding: 10px; text-align: right;">แต้มสะสม</th>
          <th style="padding: 10px; text-align: right;">แต้มใช้ไป</th>
          <th style="padding: 10px; text-align: right;">คงเหลือ</th>
          <th style="padding: 10px; text-align: right;">มูลค่า</th>
          <th style="padding: 10px; text-align: center;">ดำเนินการ</th>
        </tr>
      </thead>
      <tbody id="loyalty-table-body">
  `;

  rows.forEach((row, idx) => {
    const rowBg = idx % 2 === 0 ? 'white' : '#fafafa';
    tableHtml += `
      <tr style="background: ${rowBg}; border-bottom: 1px solid #eee;">
        <td style="padding: 10px; text-align: left;">${escHtml(row.name)}</td>
        <td style="padding: 10px; text-align: right;">${row.earned.toLocaleString('th-TH')}</td>
        <td style="padding: 10px; text-align: right; color: #ff4d4f;">${row.redeemed.toLocaleString('th-TH')}</td>
        <td style="padding: 10px; text-align: right; font-weight: bold; color: #4a90e2;">${row.remaining.toLocaleString('th-TH')}</td>
        <td style="padding: 10px; text-align: right;">${money(row.value)}</td>
        <td style="padding: 10px; text-align: center;">
          <button class="loyalty-view-history-btn" data-customer-id="${row.customerId}" style="background: #4a90e2; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">ประวัติ</button>
        </td>
      </tr>
    `;
  });

  tableHtml += `
      </tbody>
    </table>
  `;

  const html = searchHtml + tableHtml;

  // Will add event listeners after this function returns
  setTimeout(() => {
    const searchInput = document.getElementById('loyalty-customer-search');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        const query = this.value.toLowerCase();
        document.querySelectorAll('#loyalty-table-body tr').forEach(row => {
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(query) ? '' : 'none';
        });
      });
    }

    document.querySelectorAll('.loyalty-view-history-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const customerId = this.dataset.customerId;
        showPointHistory(customerId, loyaltyPoints, customers, ctx);
      });
    });
  }, 0);

  return html;
}

function renderSettingsTab(settings, ctx) {
  // Phase 90.12: requireAdmin used at the save handler as defense-in-depth.
  // The tab content is already gated by isAdmin at render time (renderLoyaltyPage L230),
  // but a runtime check here catches edge cases: a role downgrade mid-session
  // where stale DOM still has the save button, or DevTools injection.
  const { showToast, loadAllData, requireAdmin } = ctx;

  const html = `
    <div style="max-width: 500px; padding: 20px; background: #f9f9f9; border-radius: 8px;">
      <h3 style="margin-bottom: 20px; margin-top: 0;">ตั้งค่าระบบแต้ม</h3>

      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px;">ทุกกี่บาทได้ 1 แต้ม</label>
        <input type="number" id="loyalty-points-per-baht" value="${Number(settings.points_per_baht || 0)}" step="0.1" min="0" style="padding: 10px; width: 100%; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
        <div style="font-size: 12px; color: #999; margin-top: 4px;">เช่น 100 = ทุก 100 บาทได้ 1 แต้ม</div>
      </div>

      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px;">1 แต้ม = กี่บาท</label>
        <input type="number" id="loyalty-points-value" value="${Number(settings.points_value || 0)}" step="0.01" min="0" style="padding: 10px; width: 100%; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
        <div style="font-size: 12px; color: #999; margin-top: 4px;">มูลค่าของแต้มเมื่อแลก</div>
      </div>

      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px;">แต้มขั้นต่ำในการแลก</label>
        <input type="number" id="loyalty-min-redeem" value="${Number(settings.min_redeem || 0)}" step="1" min="0" style="padding: 10px; width: 100%; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
      </div>

      <div style="margin-bottom: 30px;">
        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
          <input type="checkbox" id="loyalty-is-active" ${settings.is_active ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
          <span style="font-weight: bold; font-size: 14px;">เปิดใช้งานระบบแต้ม</span>
        </label>
      </div>

      <button id="loyalty-save-settings" style="background: #4a90e2; color: white; border: none; padding: 12px 30px; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold;">บันทึกการตั้งค่า</button>
    </div>
  `;

  // Phase 90.4: setTimeout was previously AFTER return -> unreachable -> click handler never attached.
  // Now attaches before returning html (matches the working pattern at renderSummaryTab line 358).
  // Phase 90.6: save handler now uses the correct _appXhrPatch(table, payload, eqCol, eqVal)
  // signature (Promise-based) + POST fallback for first-time setup. Was previously calling
  // with a REST URL + Express-style callback (silently ignored — settings never saved).
  setTimeout(() => {
    document.getElementById('loyalty-save-settings')?.addEventListener('click', async function() {
      // Phase 90.12: runtime admin guard. Settings tab content is already gated at render
      // time, but if a role was downgraded mid-session (or this handler is reached via
      // DevTools/injection), refuse the write. Supabase RLS is the real gate; this is
      // defense-in-depth + user-visible feedback.
      if (!requireAdmin?.()) {
        if (showToast) showToast('สิทธิ์ไม่พอ — เฉพาะผู้ดูแลระบบเท่านั้น', 'error');
        return;
      }

      const newSettings = {
        // Note: no 'id' field — that's the WHERE-clause value for PATCH (4th arg below),
        // and for POST inserts the server generates it. Including it would block POST.
        points_per_baht: Number(document.getElementById('loyalty-points-per-baht').value),
        points_value: Number(document.getElementById('loyalty-points-value').value),
        min_redeem: Number(document.getElementById('loyalty-min-redeem').value),
        is_active: document.getElementById('loyalty-is-active').checked,
        updated_at: new Date().toISOString(),
      };

      // PATCH if a row already exists, POST if first-time setup (mirrors modules/line_notify.js)
      let saveResult = { ok: false, error: { message: 'API helpers unavailable' } };
      if (settings.id && window._appXhrPatch) {
        saveResult = await window._appXhrPatch('loyalty_settings', newSettings, 'id', settings.id);
      } else if (window._appXhrPost) {
        saveResult = await window._appXhrPost('loyalty_settings', newSettings);
      }

      if (saveResult?.ok) {
        if (showToast) showToast('บันทึกการตั้งค่าสำเร็จ', 'success');
        if (loadAllData) loadAllData();
      } else {
        const msg = saveResult?.error?.message || 'unknown';
        if (showToast) showToast('บันทึกการตั้งค่าล้มเหลว: ' + msg, 'error');
      }
    });
  }, 0);

  return html;
}

function renderManualTab(customers, ctx) {
  const { showToast, loadAllData } = ctx;

  const customerOptions = customers
    .map(c => `<option value="${c.id}">${c.name || `ลูกค้า #${c.id}`}</option>`)
    .join('');

  const html = `
    <div style="max-width: 500px; padding: 20px; background: #f9f9f9; border-radius: 8px;">
      <h3 style="margin-bottom: 20px; margin-top: 0;">เพิ่มหรือแลกแต้มด้วยตนเอง</h3>

      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px;">เลือกลูกค้า</label>
        <select id="loyalty-manual-customer" style="padding: 10px; width: 100%; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
          <option value="">-- เลือกลูกค้า --</option>
          ${customerOptions}
        </select>
      </div>

      <div style="margin-bottom: 20px;">
        <label style="display: flex; gap: 30px; margin-bottom: 12px; font-weight: bold; font-size: 14px;">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="radio" name="loyalty-manual-type" value="earn" checked> เพิ่มแต้ม
          </label>
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="radio" name="loyalty-manual-type" value="redeem"> แลกแต้ม
          </label>
        </label>
      </div>

      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px;">จำนวนแต้ม</label>
        <input type="number" id="loyalty-manual-points" value="0" step="1" min="0" style="padding: 10px; width: 100%; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
      </div>

      <div style="margin-bottom: 30px;">
        <label style="display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px;">หมายเหตุ (ไม่บังคับ)</label>
        <textarea id="loyalty-manual-note" style="padding: 10px; width: 100%; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; font-family: inherit; resize: vertical; min-height: 80px;"></textarea>
      </div>

      <button id="loyalty-manual-submit" style="background: #4a90e2; color: white; border: none; padding: 12px 30px; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold;">บันทึก</button>
    </div>
  `;

  setTimeout(() => {
    // Phase 90.8: listener now async — earn branch awaits xhrPost (table name + Promise pattern),
    // redeem branch awaits redeemPoints (now async too). Was silently failing: wrong REST path + ignored callback.
    document.getElementById('loyalty-manual-submit')?.addEventListener('click', async function() {
      const customerId = document.getElementById('loyalty-manual-customer').value;
      const type = document.querySelector('input[name="loyalty-manual-type"]:checked').value;
      const points = Number(document.getElementById('loyalty-manual-points').value);
      const note = document.getElementById('loyalty-manual-note').value;

      if (!customerId) {
        if (showToast) showToast('กรุณาเลือกลูกค้า', 'warning');
        return;
      }

      if (points <= 0) {
        if (showToast) showToast('กรุณาระบุจำนวนแต้ม', 'warning');
        return;
      }

      if (type === 'earn') {
        const newRecord = {
          customer_id: customerId,
          type: 'earn',
          points,
          ref_type: 'manual',
          ref_id: null,
          note: note || null,
          created_at: new Date().toISOString(),
        };

        const r = await window._appXhrPost('loyalty_points', newRecord);
        if (r?.ok) {
          if (showToast) showToast(`เพิ่มแต้ม ${points} แต้มสำเร็จ`, 'success');
          document.getElementById('loyalty-manual-customer').value = '';
          document.getElementById('loyalty-manual-points').value = '0';
          document.getElementById('loyalty-manual-note').value = '';
          if (loadAllData) loadAllData();
        } else {
          if (showToast) showToast('บันทึกล้มเหลว: ' + (r?.error?.message || 'unknown'), 'error');
        }
      } else {
        // Phase 90.9: only clear form on success — early returns ("แต้มไม่พอแลก", "ต้องแลกอย่างน้อย N",
        // "ระบบแต้มไม่เปิดใช้งาน") now propagate {ok:false} so user keeps their input to correct it.
        const r = await redeemPoints(customerId, points, note, ctx);
        if (r?.ok) {
          document.getElementById('loyalty-manual-customer').value = '';
          document.getElementById('loyalty-manual-points').value = '0';
          document.getElementById('loyalty-manual-note').value = '';
        }
      }
    });
  }, 0);

  return html;
}

function showPointHistory(customerId, loyaltyPoints, customers, _ctx) {
  // Phase 90.10: same id-type-mismatch fix as getCustomerPoints (bigint vs string).
  const cidStr = String(customerId);
  const customer = customers.find(c => String(c.id) === cidStr);
  const customerName = customer?.name || `ลูกค้า #${customerId}`;

  const transactions = loyaltyPoints
    .filter(t => String(t.customer_id) === cidStr)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const title = document.getElementById('loyalty-history-title');
  if (title) title.textContent = `ประวัติแต้ม - ${customerName}`;

  let content = '';

  if (transactions.length === 0) {
    content = '<p style="color: #999; text-align: center; padding: 30px;">ไม่มีประวัติแต้ม</p>';
  } else {
    content = `
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: #f5f5f5; border-bottom: 1px solid #ddd;">
            <th style="padding: 10px; text-align: left;">วันที่</th>
            <th style="padding: 10px; text-align: left;">ประเภท</th>
            <th style="padding: 10px; text-align: right;">แต้ม</th>
            <th style="padding: 10px; text-align: left;">อ้างอิง</th>
            <th style="padding: 10px; text-align: left;">หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
    `;

    transactions.forEach((t, idx) => {
      const rowBg = idx % 2 === 0 ? 'white' : '#fafafa';
      const typeLabel = t.type === 'earn' ? 'เพิ่มแต้ม' : 'แลกแต้ม';
      const typeColor = t.type === 'earn' ? '#52c41a' : '#ff4d4f';
      // Phase 89.18: escape ref_type / ref_id / note (stored XSS surface — note เป็น free text)
      const refType = escHtml(t.ref_type || '');
      const refId = escHtml(t.ref_id || '');
      const refLabel = t.ref_id ? `${refType} #${refId}` : (refType || '-');
      const note = t.note ? escHtml(t.note) : '-';

      content += `
        <tr style="background: ${rowBg}; border-bottom: 1px solid #eee;">
          <td style="padding: 10px; text-align: left;">${dateTH(t.created_at)}</td>
          <td style="padding: 10px; text-align: left; color: ${typeColor}; font-weight: bold;">${typeLabel}</td>
          <td style="padding: 10px; text-align: right; color: ${typeColor}; font-weight: bold;">${t.points.toLocaleString('th-TH')}</td>
          <td style="padding: 10px; text-align: left; font-size: 12px; color: #666;">${refLabel}</td>
          <td style="padding: 10px; text-align: left; font-size: 12px; color: #666;">${note}</td>
        </tr>
      `;
    });

    content += `
        </tbody>
      </table>
    `;
  }

  const contentDiv = document.getElementById('loyalty-history-content');
  if (contentDiv) contentDiv.innerHTML = content;

  const modal = document.getElementById('loyalty-history-modal');
  if (modal) modal.style.display = 'block';

  // Close modal on background click
  modal?.addEventListener('click', function(e) {
    if (e.target === this) this.style.display = 'none';
  });
}
