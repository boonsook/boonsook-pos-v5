/**
 * LINE Notify Integration Module for Boonsook POS V5 PRO
 *
 * Handles LINE notification settings and sending notifications
 * via LINE Notify API with CORS-friendly approach
 */

/**
 * Render LINE Notify settings UI
 * @param {Object} ctx - Context object containing { state, showToast, loadAllData }
 * @param {HTMLElement} container - Container element to render into (optional)
 */
export function renderLineNotifySettings(ctx, targetContainer) {
  const { state, showToast } = ctx;

  // Get or create settings from state
  const settings = state.lineNotifySettings || {
    id: null,
    line_notify_token: '',
    is_active: false,
    notify_low_stock: false,
    notify_new_order: false,
    notify_job_done: false,
    notify_daily_summary: false
  };

  const container = targetContainer || document.getElementById('line-notify-settings') || createSettingsContainer();

  const html = `
    <div class="line-notify-section" style="border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 20px 0; background-color: #f9f9f9;">
      <h3 style="margin-top: 0; color: #00b900; display: flex; align-items: center;">
        <span style="font-size: 24px; margin-right: 10px;">📱</span>
        LINE Notify ตั้งค่า
      </h3>

      <!-- Master Toggle -->
      <div class="form-group" style="margin-bottom: 20px; padding: 15px; background-color: #fff; border-radius: 6px;">
        <label style="display: flex; align-items: center; cursor: pointer; font-weight: 500;">
          <input type="checkbox" id="line-is-active" ${settings.is_active ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer; margin-right: 10px;">
          <span>เปิด/ปิดระบบ LINE Notify</span>
        </label>
      </div>

      <!-- Server Status (token อยู่ที่ Cloudflare Pages env vars — ไม่ใส่ใน UI แล้ว) -->
      <div class="form-group" style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #333;">
          🔐 สถานะเซิร์ฟเวอร์ LINE
        </label>
        <div id="line-server-status" style="padding: 12px; border: 1px solid #ddd; border-radius: 6px; background-color: #fff; font-size: 14px; color: #666;">
          ⏳ กำลังตรวจสอบ...
        </div>
        <div style="display: flex; gap: 10px; margin-top: 10px;">
          <button id="line-test-button" type="button" style="flex: 1; padding: 10px 15px; background-color: #00b900; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
            🧪 ส่งทดสอบ
          </button>
        </div>
        <small style="color: #666; margin-top: 8px; display: block; line-height: 1.6;">
          📖 Token/UserID เก็บไว้ที่ <b>Cloudflare Pages → Settings → Environment variables</b><br>
          ตัวแปรที่ต้องตั้ง: <code>LINE_CHANNEL_ACCESS_TOKEN</code> และ <code>LINE_USER_ID</code><br>
          (LINE Notify เดิมถูกปิดตั้งแต่ 2025-03-31 — ตอนนี้ใช้ LINE Messaging API)
        </small>
      </div>

      <!-- Notification Toggle Switches -->
      <div style="background-color: #fff; border-radius: 6px; padding: 15px;">
        <h4 style="margin: 0 0 15px 0; color: #333; font-size: 15px;">ตัวเลือกการแจ้งเตือน:</h4>

        <div class="notification-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #eee;">
          <label style="display: flex; align-items: center; flex: 1; cursor: pointer;">
            <span style="font-size: 20px; margin-right: 12px;">📦</span>
            <span>แจ้งเตือนสต็อกต่ำ</span>
          </label>
          <div class="toggle-switch">
            <input type="checkbox" id="line-low-stock" class="toggle-input" ${settings.notify_low_stock ? 'checked' : ''}>
            <label for="line-low-stock" class="toggle-label"></label>
          </div>
        </div>

        <div class="notification-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #eee;">
          <label style="display: flex; align-items: center; flex: 1; cursor: pointer;">
            <span style="font-size: 20px; margin-right: 12px;">🛒</span>
            <span>แจ้งเตือนออเดอร์ใหม่</span>
          </label>
          <div class="toggle-switch">
            <input type="checkbox" id="line-new-order" class="toggle-input" ${settings.notify_new_order ? 'checked' : ''}>
            <label for="line-new-order" class="toggle-label"></label>
          </div>
        </div>

        <div class="notification-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #eee;">
          <label style="display: flex; align-items: center; flex: 1; cursor: pointer;">
            <span style="font-size: 20px; margin-right: 12px;">✅</span>
            <span>แจ้งเตือนงานช่างเสร็จ</span>
          </label>
          <div class="toggle-switch">
            <input type="checkbox" id="line-job-done" class="toggle-input" ${settings.notify_job_done ? 'checked' : ''}>
            <label for="line-job-done" class="toggle-label"></label>
          </div>
        </div>

        <div class="notification-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0;">
          <label style="display: flex; align-items: center; flex: 1; cursor: pointer;">
            <span style="font-size: 20px; margin-right: 12px;">📊</span>
            <span>สรุปยอดประจำวัน</span>
          </label>
          <div class="toggle-switch">
            <input type="checkbox" id="line-daily-summary" class="toggle-input" ${settings.notify_daily_summary ? 'checked' : ''}>
            <label for="line-daily-summary" class="toggle-label"></label>
          </div>
        </div>
      </div>

      <!-- Save Button -->
      <div style="margin-top: 20px; display: flex; gap: 10px;">
        <button id="line-save-button" type="button" style="flex: 1; padding: 12px 20px; background-color: #00b900; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 16px;">
          💾 บันทึก
        </button>
      </div>
    </div>

    <style>
      .toggle-switch {
        position: relative;
        width: 50px;
        height: 28px;
      }

      .toggle-input {
        display: none;
      }

      .toggle-label {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: #ccc;
        border-radius: 14px;
        cursor: pointer;
        transition: background-color 0.3s;
      }

      .toggle-input:checked + .toggle-label {
        background-color: #00b900;
      }

      .toggle-label::after {
        content: '';
        position: absolute;
        width: 24px;
        height: 24px;
        background-color: white;
        border-radius: 50%;
        top: 2px;
        left: 2px;
        transition: left 0.3s;
      }

      .toggle-input:checked + .toggle-label::after {
        left: 24px;
      }

      .line-notify-section input[type="text"],
      .line-notify-section input[type="password"] {
        box-sizing: border-box;
      }
    </style>
  `;

  container.innerHTML = html;

  // Attach event listeners
  attachLineNotifyListeners(container, ctx, settings);

  return container;
}

/**
 * Attach event listeners to LINE Notify settings UI
 */
function attachLineNotifyListeners(container, ctx, settings) {
  const { state, showToast, loadAllData } = ctx;
  const statusEl = container.querySelector('#line-server-status');
  const testButton = container.querySelector('#line-test-button');
  const saveButton = container.querySelector('#line-save-button');
  const isActiveCheckbox = container.querySelector('#line-is-active');

  // Probe server on mount — ping /api/line-notify with empty body เพื่อเช็คว่า configured
  (async () => {
    try {
      const resp = await fetch('/api/line-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '' })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.status === 400) {
        // 400 = endpoint ทำงาน แต่ข้อความว่าง → แปลว่า env vars ตั้งแล้ว
        statusEl.innerHTML = '🟢 <b style="color:#059669">เซิร์ฟเวอร์พร้อมส่ง LINE</b>';
        statusEl.style.backgroundColor = '#ecfdf5';
        statusEl.style.borderColor = '#059669';
      } else if (data && data.configured === false) {
        statusEl.innerHTML = '🔴 <b style="color:#b91c1c">ยังไม่ตั้งค่า env vars</b> — ตั้งที่ Cloudflare Pages';
        statusEl.style.backgroundColor = '#fef2f2';
        statusEl.style.borderColor = '#b91c1c';
      } else {
        statusEl.innerHTML = '🟡 <b>สถานะไม่ชัดเจน</b> (HTTP ' + resp.status + ') — ลองกดปุ่มทดสอบ';
        statusEl.style.backgroundColor = '#fffbeb';
      }
    } catch (e) {
      statusEl.innerHTML = '🔴 <b>เชื่อมต่อเซิร์ฟเวอร์ไม่ได้</b> — ' + ((e && e.message) || e);
      statusEl.style.backgroundColor = '#fef2f2';
    }
  })();

  // Test notification — ส่งจริงผ่าน endpoint (ไม่ต้องเปิด is_active ก่อน)
  testButton.addEventListener('click', async () => {
    testButton.disabled = true;
    const originalText = testButton.textContent;
    testButton.textContent = '⏳ กำลังทดสอบ...';

    try {
      const result = await sendLineNotify(
        '🧪 ทดสอบ LINE — Boonsook POS\n⏰ ' + new Date().toLocaleString('th-TH'),
        { state, showToast, forceSend: true }
      );
      if (result && result.ok) {
        showToast('✅ ส่งทดสอบสำเร็จ! ตรวจสอบ LINE ของคุณ', 'success');
      } else if (result && result.configured === false) {
        showToast('⚠️ ยังไม่ได้ตั้ง env vars บน Cloudflare Pages', 'warning');
      } else {
        showToast('❌ ส่งไม่สำเร็จ: ' + ((result && result.error) || 'unknown'), 'error');
      }
    } catch (error) {
      showToast('❌ ข้อผิดพลาด: ' + ((error && error.message) || error), 'error');
    } finally {
      testButton.disabled = false;
      testButton.textContent = originalText;
    }
  });

  // Save settings — ไม่ต้องบันทึก token แล้ว (อยู่ที่ Cloudflare env)
  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    const originalText = saveButton.textContent;
    saveButton.textContent = '⏳ กำลังบันทึก...';

    try {
      const updatedSettings = {
        is_active: isActiveCheckbox.checked,
        notify_low_stock: container.querySelector('#line-low-stock').checked,
        notify_new_order: container.querySelector('#line-new-order').checked,
        notify_job_done: container.querySelector('#line-job-done').checked,
        notify_daily_summary: container.querySelector('#line-daily-summary').checked
      };

      // If settings have ID, use PATCH (table name only — helper prepends /rest/v1/)
      // otherwise POST to create row
      let saveResult = { ok: true };
      if (settings.id && window._appXhrPatch) {
        saveResult = await window._appXhrPatch(
          'line_notify_settings',
          updatedSettings,
          'id',
          settings.id
        );
      } else if (window._appXhrPost) {
        saveResult = await window._appXhrPost(
          'line_notify_settings',
          updatedSettings
        );
      }

      if (saveResult && saveResult.ok === false) {
        throw new Error(saveResult.error?.message || 'บันทึกไม่สำเร็จ');
      }

      // Update state + persist copy to localStorage so toggles survive refresh
      state.lineNotifySettings = { ...settings, ...updatedSettings };
      try { localStorage.setItem('bsk_line_notify_settings', JSON.stringify(state.lineNotifySettings)); } catch(e) {}

      showToast('✅ บันทึกสำเร็จ', 'success');

      if (loadAllData) {
        await loadAllData();
      }
    } catch (error) {
      showToast('❌ ข้อผิดพลาด: ' + ((error && error.message) || error), 'error');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = originalText;
    }
  });
}

/**
 * Create a settings container div if not present
 */
function createSettingsContainer() {
  let container = document.getElementById('line-notify-settings');
  if (!container) {
    container = document.createElement('div');
    container.id = 'line-notify-settings';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Send notification via LINE Notify
 * @param {string} message - Message to send
 * @param {Object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function sendLineNotify(message, ctx) {
  const { state, showToast, forceSend } = ctx || {};
  const settings = state && state.lineNotifySettings;

  // ยกเว้น forceSend (ใช้สำหรับปุ่มทดสอบ) — จะถูก gate ด้วย is_active
  if (!forceSend) {
    if (!settings || !settings.is_active) {
      // LINE Notify ถูกปิดไว้
      return { ok: false, skipped: true, reason: 'disabled' };
    }
  }

  try {
    const response = await fetch('/api/line-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    let result = null;
    try { result = await response.json(); } catch (_) { result = null; }

    if (result && result.configured === false) {
      console.warn('LINE server not configured (env vars missing)');
      showToast && showToast('⚠️ ยังไม่ตั้ง LINE env vars บน Cloudflare Pages', 'warning');
      return { ok: false, configured: false };
    }

    if (!response.ok || !(result && result.ok)) {
      const detail = (result && (result.error || JSON.stringify(result.results || {}))) || `HTTP ${response.status}`;
      console.error('LINE send failed:', detail);
      return { ok: false, error: detail };
    }

    return { ok: true };
  } catch (error) {
    console.error('LINE Notify network error:', error);
    return { ok: false, error: String((error && error.message) || error) };
  }
}

/**
 * Send low stock notification
 * @param {Array} products - Array of low stock products
 * @param {Object} ctx - Context object
 */
export async function notifyLowStock(products, ctx) {
  if (!products || products.length === 0) return;

  const settings = ctx.state.lineNotifySettings;
  if (!settings || !settings.is_active || !settings.notify_low_stock) return;

  let message = '📦 แจ้งเตือนสต็อกต่ำ\n\n';

  products.forEach((product, index) => {
    message += `${index + 1}. ${product.name}\n`;
    message += `   สต็อก: ${product.stock || product.quantity || 0} ${product.unit || "ชิ้น"}\n`;
  });

  message += `\n⏰ ${new Date().toLocaleString('th-TH')}`;

  await sendLineNotify(message, ctx);
}

/**
 * Send new order notification
 * @param {Object} sale - Sale object
 * @param {Object} ctx - Context object
 */
export async function notifyNewOrder(sale, ctx) {
  const settings = ctx.state.lineNotifySettings;
  if (!settings || !settings.is_active || !settings.notify_new_order) return;

  const totalItems = sale.items ? sale.items.reduce((sum, item) => sum + (item.qty || item.quantity || 0), 0) : 0;
  const totalPrice = sale.total_amount || 0;

  let message = '🛒 ออเดอร์ใหม่\n\n';

  if (sale.customer_name) {
    message += `👤 ${sale.customer_name}\n`;
  }

  message += `📝 เลขที่: ${sale.order_id || sale.id}\n`;
  message += `📦 สินค้า: ${totalItems} รายการ\n`;
  message += `💰 ยอดรวม: ${totalPrice.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท\n`;

  if (sale.status) {
    message += `📊 สถานะ: ${translateStatus(sale.status)}\n`;
  }

  message += `\n⏰ ${new Date().toLocaleString('th-TH')}`;

  await sendLineNotify(message, ctx);
}

/**
 * Send job completion notification
 * @param {Object} job - Job object
 * @param {Object} ctx - Context object
 */
export async function notifyJobDone(job, ctx) {
  const settings = ctx.state.lineNotifySettings;
  if (!settings || !settings.is_active || !settings.notify_job_done) return;

  let message = '✅ งานช่างเสร็จแล้ว\n\n';

  if (job.customer_name) {
    message += `👤 ${job.customer_name}\n`;
  }

  if (job.job_id || job.id) {
    message += `📝 เลขที่: ${job.job_id || job.id}\n`;
  }

  if (job.service_description) {
    message += `🔧 บริการ: ${job.service_description}\n`;
  }

  if (job.total_cost) {
    message += `💰 ค่าใช้งาน: ${job.total_cost.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท\n`;
  }

  message += `\n⏰ ${new Date().toLocaleString('th-TH')}`;

  await sendLineNotify(message, ctx);
}

/**
 * Send daily summary notification
 * @param {Object} summary - Summary object with daily stats
 * @param {Object} ctx - Context object
 */
export async function notifyDailySummary(summary, ctx) {
  const settings = ctx.state.lineNotifySettings;
  if (!settings || !settings.is_active || !settings.notify_daily_summary) return;

  let message = '📊 สรุปยอดประจำวัน\n\n';

  if (summary.date) {
    message += `📅 วันที่: ${summary.date}\n`;
  }

  if (summary.total_orders !== undefined) {
    message += `🛒 ออเดอร์ทั้งหมด: ${summary.total_orders} รายการ\n`;
  }

  if (summary.total_revenue !== undefined) {
    message += `💰 รวมรายได้: ${summary.total_revenue.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท\n`;
  }

  if (summary.total_customers !== undefined) {
    message += `👥 ลูกค้าทั้งหมด: ${summary.total_customers} คน\n`;
  }

  if (summary.completed_jobs !== undefined) {
    message += `✅ งานเสร็จ: ${summary.completed_jobs} งาน\n`;
  }

  if (summary.low_stock_count !== undefined && summary.low_stock_count > 0) {
    message += `⚠️ สินค้าสต็อกต่ำ: ${summary.low_stock_count} รายการ\n`;
  }

  message += `\n⏰ ${new Date().toLocaleString('th-TH')}`;

  await sendLineNotify(message, ctx);
}

/**
 * Helper function to translate status
 */
function translateStatus(status) {
  const statusMap = {
    'pending': 'รอดำเน�