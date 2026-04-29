/**
 * Permission Matrix Module
 * Boonsook POS V5 PRO
 *
 * Manages role-based permission matrix UI and permission checking
 */

// Permission definitions with Thai labels
const PERMISSION_DEFINITIONS = {
  view_cost: 'ดูต้นทุนสินค้า',
  delete_sale: 'ลบรายการขาย',
  edit_product: 'แก้ไขสินค้า',
  view_report: 'ดูรายงาน',
  manage_users: 'จัดการผู้ใช้',
  delete_quotation: 'ลบใบเสนอราคา',
  view_expenses: 'ดูรายจ่าย',
  manage_expenses: 'จัดการรายจ่าย',
  view_stock_log: 'ดูประวัติสต็อก',
  manage_loyalty: 'จัดการแต้มสะสม'
};

// Role definitions with Thai labels
const ROLE_LABELS = {
  admin: 'ผู้ดูแล',
  sales: 'พนง.ขาย',
  technician: 'ช่าง',
  customer: 'ลูกค้า'
};

const ROLES = ['admin', 'sales', 'technician', 'customer'];

/**
 * Renders the permission matrix UI
 * @param {Object} ctx - Context object containing state, showToast, etc.
 * @param {HTMLElement} container - Container element to render into
 */
export function renderPermissionMatrix(ctx, container) {
  const { state, showToast, requireAdmin } = ctx;

  // Check admin permission
  if (!requireAdmin()) {
    container.innerHTML = '<div style="padding: 20px; color: #d32f2f; font-size: 14px;">⛔ คุณไม่มีสิทธิ์เข้าถึงหน้านี้</div>';
    return;
  }

  // Clear container
  container.innerHTML = '';

  // Create wrapper div
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding: 20px; background-color: #f5f5f5;';

  // Create title
  const title = document.createElement('h2');
  title.textContent = 'เมทริกซ์สิทธิ์การใช้งาน';
  title.style.cssText = 'margin-top: 0; margin-bottom: 20px; color: #333; font-size: 24px;';
  wrapper.appendChild(title);

  // Create table
  const table = document.createElement('table');
  table.style.cssText = `
    width: 100%;
    border-collapse: collapse;
    background-color: white;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    border-radius: 4px;
    overflow: hidden;
  `;

  // Create header row
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.style.cssText = 'background-color: #1976d2; color: white; font-weight: bold;';

  // Header cell for permission names
  const permHeaderCell = document.createElement('th');
  permHeaderCell.textContent = 'สิทธิ์';
  permHeaderCell.style.cssText = 'padding: 12px; text-align: left; border: 1px solid #ddd;';
  headerRow.appendChild(permHeaderCell);

  // Header cells for roles
  ROLES.forEach(role => {
    const th = document.createElement('th');
    th.textContent = ROLE_LABELS[role];
    th.style.cssText = 'padding: 12px; text-align: center; border: 1px solid #ddd; min-width: 100px;';
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Create body rows
  const tbody = document.createElement('tbody');
  const permKeys = Object.keys(PERMISSION_DEFINITIONS);

  permKeys.forEach((permKey, index) => {
    const row = document.createElement('tr');
    const isEvenRow = index % 2 === 0;
    row.style.cssText = `background-color: ${isEvenRow ? '#ffffff' : '#f9f9f9'}; border-bottom: 1px solid #ddd;`;

    // Permission name cell
    const permCell = document.createElement('td');
    permCell.textContent = PERMISSION_DEFINITIONS[permKey];
    permCell.style.cssText = 'padding: 12px; text-align: left; border: 1px solid #ddd; font-weight: 500; color: #333;';
    row.appendChild(permCell);

    // Permission checkbox cells for each role
    ROLES.forEach(role => {
      const cell = document.createElement('td');
      cell.style.cssText = 'padding: 12px; text-align: center; border: 1px solid #ddd;';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';

      // Find current permission state
      const permission = state.permissions.find(
        p => p.role === role && p.permission_key === permKey
      );

      checkbox.checked = permission ? permission.allowed : false;

      // Disable admin column checkboxes - admin always has all permissions
      if (role === 'admin') {
        checkbox.checked = true;
        checkbox.disabled = true;
        checkbox.style.cursor = 'not-allowed';
        checkbox.style.opacity = '0.6';
      }

      // Add change listener
      checkbox.addEventListener('change', async (e) => {
        await handlePermissionChange(ctx, role, permKey, e.target.checked, showToast);
      });

      cell.appendChild(checkbox);
      row.appendChild(cell);
    });

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);

  // Add info message
  const infoDiv = document.createElement('div');
  infoDiv.style.cssText = 'margin-top: 15px; padding: 12px; background-color: #e3f2fd; border-left: 4px solid #1976d2; color: #1565c0; font-size: 13px;';
  infoDiv.textContent = 'ℹ️ การเปลี่ยนแปลงสิทธิ์จะบันทึกอัตโนมัติ • คอลัมน์ผู้ดูแลไม่สามารถแก้ไขได้ (มีสิทธิ์ทั้งหมด)';
  wrapper.appendChild(infoDiv);

  container.appendChild(wrapper);
}

/**
 * Handles permission checkbox change
 * @param {Object} ctx - Context object
 * @param {string} role - Role name
 * @param {string} permKey - Permission key
 * @param {boolean} allowed - Whether permission is allowed
 * @param {Function} showToast - Toast notification function
 */
async function handlePermissionChange(ctx, role, permKey, allowed, showToast) {
  const { state } = ctx;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const baseHeaders = {
    'Content-Type': 'application/json',
    'apikey': cfg.anonKey,
    'Authorization': 'Bearer ' + token,
    'Prefer': 'return=representation'
  };

  try {
    let permission = state.permissions.find(
      p => p.role === role && p.permission_key === permKey
    );

    let resp;
    if (permission && permission.id) {
      resp = await fetch(cfg.url + '/rest/v1/permissions?id=eq.' + permission.id, {
        method: 'PATCH',
        headers: baseHeaders,
        body: JSON.stringify({ allowed })
      });
    } else {
      resp = await fetch(cfg.url + '/rest/v1/permissions', {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify({ role, permission_key: permKey, allowed })
      });
    }

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error('HTTP ' + resp.status + ' ' + txt.slice(0, 200));
    }

    const data = await resp.json();
    const newRec = Array.isArray(data) ? data[0] : data;

    if (permission) {
      Object.assign(permission, newRec || { allowed });
    } else if (newRec) {
      state.permissions.push(newRec);
    }

    const action = allowed ? 'เปิด' : 'ปิด';
    showToast(action + 'สิทธิ์ ' + PERMISSION_DEFINITIONS[permKey] + ' สำหรับ ' + ROLE_LABELS[role] + ' สำเร็จ', 'success');
  } catch (error) {
    console.error('Permission update error:', error);
    showToast('เกิดข้อผิดพลาดในการบันทึกสิทธิ์: ' + error.message, 'error');

    // Revert checkbox state
    const permission = state.permissions.find(
      p => p.role === role && p.permission_key === permKey
    );
    if (permission) {
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(cb => {
        if (cb.dataset.role === role && cb.dataset.permKey === permKey) {
          cb.checked = !allowed;
        }
      });
    }
  }
}

/**
 * Checks if current user has a specific permission
 * @param {string} permKey - Permission key to check
 * @param {Object} ctx - Context object containing state and currentRole
 * @returns {boolean} Whether user has the permission
 */
export function hasPermission(permKey, ctx) {
  const { state, currentRole } = ctx;

  // Admin always has all permissions
  if (currentRole === 'admin') {
    return true;
  }

  // Look up permission in state
  const permission = state.permissions.find(
    p => p.role === currentRole && p.permission_key === permKey
  );

  // Default to false if permission not found
  return permission ? permission.allowed : false;
}
