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

      <!-- Token Input -->
      <div class="form-group" style="margin-bottom: 20px;">
        <label for="line-token" style="display: block; margin-bottom: 8px; font-weight: 500; color: #333;">
          LINE Notify Token
        </label>
        <div style="display: flex; gap: 10px;">
          <input
            type="password"
            id="line-token"
            placeholder="ใส่ LINE Notify Token ของคุณ"
            value="${settings.line_notify_token || ''}"
            style="flex: 1; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; font-family: monospace;"
          >
          <button id="line-token-toggle" type="button" style="padding: 10px 15px; background-color: #f0f0f0; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 14px;">
            👁️
          </button>
          <button id="line-test-button" type="button" style="padding: 10px 15px; background-color: #00b900; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
            ทดสอบ
          </button>
        </div>
        <small style="color: #666; margin-top: 8px; display: block;">
          📖 <a href="https://notify-bot.line.me/" target="_blank" style="color: #00b900; text-decoration: none;">รับ Token จากที่นี่</a>
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
  const tokenInput = container.querySelector('#line-token');
  const tokenToggleBtn = container.querySelector('#line-token-toggle');
  const testButton = container.querySelector('#line-test-button');
  const saveButton = container.querySelector('#line-save-button');
  const isActiveCheckbox = container.querySelector('#line-is-active');

  // Toggle password visibility
  tokenToggleBtn.addEventListener('click', () => {
    const isPassword = tokenInput.type === 'password';
    tokenInput.type = isPassword ? 'text' : 'password';
    tokenToggleBtn.textContent = isPassword ? '🙈' : '👁️';
  });

  // Test notification
  testButton.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      showToast('⚠️ กรุณาใส่ LINE Notify Token', 'warning');
      return;
    }

    testButton.disabled = true;
    testButton.textContent = '⏳ กำลังทดสอบ...';

    try {
      await sendLineNotify('🧪 ทดสอบ LINE Notify - Boonsook POS', {
        ...ctx,
        overrideToken: token
      });
      showToast('✅ ส่งทดสอบสำเร็จ! ตรวจสอบ LINE ของคุณ', 'success');
    } catch (error) {
      showToast(`❌ ข้อผิดพลาด: ${error.message}`, 'error');
    } finally {
      testButton.disabled = false;
      testButton.textContent = '✅ ทดสอบ';
    }
  });

  // Save settings
  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    saveButton.textContent = '⏳ กำลังบันทึก...';

    try {
      const updatedSettings = {
        line_notify_token: tokenInput.value.trim(),
        is_active: isActiveCheckbox.checked,
        notify_low_stock: container.querySelector('#line-low-stock').checked,
        notify_new_order: container.querySelector('#line-new-order').checked,
        notify_job_done: container.querySelector('#line-job-done').checked,
        notify_daily_summary: container.querySelector('#line-daily-summary').checked
      };

      // If settings have ID, use PATCH; otherwise use POST
      if (settings.id) {
        await window._appXhrPatch(
          `/api/line_notify_settings/${settings.id}`,
          updatedSettings
        );
      } else {
        await window._appXhrPost(
          '/api/line_notify_settings',
          updatedSettings
        );
      }

      // Update state
      state.lineNotifySettings = { ...settings, ...updatedSettings };

      showToast('✅ บันทึกสำเร็จ', 'success');

      if (loadAllData) {
        await loadAllData();
      }
    } catch (error) {
      showToast(`❌ ข้อผิดพลาด: ${error.message}`, 'error');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = '💾 บันทึก';
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
  const { state, showToast, overrideToken } = ctx;
  const settings = state.lineNotifySettings;

  // Check if LINE Notify is enabled
  if (!settings || !settings.is_active) {
    // LINE Notify disabled
    return;
  }

  const token = overrideToken || settings.line_notify_token;
  if (!token) {
    console.warn('LINE Notify token not configured');
    showToast && showToast('⚠️ ยังไม่ได้ตั้งค่า LINE Notify Token', 'warning');
    return;
  }

  try {
    // Try direct API call (may fail due to CORS in browser)
    const response = await fetch('https://notify-api.line.me/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${token}`
      },
      body: new URLSearchParams({ message }),
      mode: 'cors'
    });

    if (!response.ok) {
      throw new Error(`LINE API returned ${response.status}`);
    }

    const result = await response.json();
    // LINE Notify sent OK
  } catch (error) {
    console.error('LINE Notify error (CORS limitation - this is expected in browser):', error);

    // Fallback: Attempt to send via backend if available
    if (window._appXhrPost) {
      try {
        await window._appXhrPost('/api/send_line_notify', {
          message,
          token
        });
        // sent via backend OK
      } catch (backendError) {
        console.error('Backend send also failed:', backendError);
        // Silent fail - notification queue approach would go here
      }
    }
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
    'pending': 'รอดำเนินการ',
    'processing': 'กำลังดำเนินการ',
    'completed': 'เสร็จสิ้น',
    'cancelled': 'ยกเลิก',
    'draft': 'ร่าง',
    'confirmed': 'ยืนยันแล้ว',
    'shipped': 'จัดส่งแล้ว'
  };

  return statusMap[status] || status;
}

export default {
  renderLineNotifySettings,
  sendLineNotify,
  notifyLowStock,
  notifyNewOrder,
  notifyJobDone,
  notifyDailySummary
};
