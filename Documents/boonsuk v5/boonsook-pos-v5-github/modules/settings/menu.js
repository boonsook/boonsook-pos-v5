// ═══════════════════════════════════════════════════════════
//  settings/menu.js — Main Settings Menu
// ═══════════════════════════════════════════════════════════

import { escHtml, ROLE_COLORS } from './utils.js';

/**
 * Render main settings menu
 * @param {HTMLElement} el - Container element
 * @param {object} ctx - Context object
 * @param {function} goBack - Back navigation callback
 * @param {function} navigate - Navigation callback
 */
export function renderSettingsMainMenu(el, ctx, goBack, navigate) {
  const { state, currentRole, ROLE_LABELS } = ctx;
  const role = currentRole();
  const isAdmin = role === 'admin';
  const roleTh = ROLE_LABELS[role] || role;

  el.innerHTML = `
    <!-- Profile Card -->
    <div class="set-profile-card">
      <div class="set-profile-avatar">
        <img src="${localStorage.getItem('bsk_store_logo') || './logo.svg'}" 
             alt="Logo" class="set-profile-logo" 
             onerror="this.style.display='none'" />
      </div>
      <div class="set-profile-info">
        <div class="set-profile-name">
          ${escHtml(state.storeInfo?.name || 'บุญสุข อิเล็กทรอนิกส์')}
        </div>
        <div class="set-profile-detail">
          ${escHtml(state.profile?.full_name || state.currentUser?.email || '-')} • 
          <span style="color:${ROLE_COLORS[role] || '#64748b'}">${roleTh}</span>
        </div>
        <div class="set-profile-detail">
          ${escHtml(state.currentUser?.email || '')}
        </div>
        <div class="set-profile-detail">
          แพ็กเกจ: <strong style="color:var(--primary2)">Pro</strong>
        </div>
      </div>
    </div>

    <!-- Menu List -->
    <div class="set-menu-list">
      <button class="set-menu-item" data-action="navigate" data-target="store">
        <span class="set-menu-icon">🏪</span>
        <span class="set-menu-label">ตั้งค่าข้อมูลร้าน</span>
        <span class="set-menu-arrow">›</span>
      </button>
      <button class="set-menu-item" data-action="navigate" data-target="logo">
        <span class="set-menu-icon">🖼️</span>
        <span class="set-menu-label">โลโก้ร้าน</span>
        <span class="set-menu-arrow">›</span>
      </button>
      ${isAdmin ? `
      <button class="set-menu-item" data-action="navigate" data-target="users">
        <span class="set-menu-icon">👥</span>
        <span class="set-menu-label">ตั้งค่าผู้ใช้งาน</span>
        <span class="set-menu-arrow">›</span>
      </button>
      <button class="set-menu-item" data-action="navigate" data-target="payment">
        <span class="set-menu-icon">💳</span>
        <span class="set-menu-label">ตั้งค่าการชำระเงิน</span>
        <span class="set-menu-arrow">›</span>
      </button>
      <button class="set-menu-item" data-action="navigate" data-target="permissions">
        <span class="set-menu-icon">🔐</span>
        <span class="set-menu-label">สิทธิ์การใช้งาน</span>
        <span class="set-menu-arrow">›</span>
      </button>
      <button class="set-menu-item" data-action="navigate" data-target="ac-catalog">
        <span class="set-menu-icon">❄️</span>
        <span class="set-menu-label">คลังสินค้า AC</span>
        <span class="set-menu-arrow">›</span>
      </button>
      <button class="set-menu-item" data-action="navigate" data-target="line-notify">
        <span class="set-menu-icon">💬</span>
        <span class="set-menu-label">LINE Notify</span>
        <span class="set-menu-arrow">›</span>
      </button>
      <button class="set-menu-item" data-action="navigate" data-target="document">
        <span class="set-menu-icon">📄</span>
        <span class="set-menu-label">เทมเพลตเอกสาร</span>
        <span class="set-menu-arrow">›</span>
      </button>
      <button class="set-menu-item" data-action="navigate" data-target="product-settings">
        <span class="set-menu-icon">📦</span>
        <span class="set-menu-label">ตั้งค่าสินค้า</span>
        <span class="set-menu-arrow">›</span>
      </button>
      ` : ''}
      <button class="set-menu-item" data-action="navigate" data-target="about">
        <span class="set-menu-icon">ℹ️</span>
        <span class="set-menu-label">เกี่ยวกับระบบ</span>
        <span class="set-menu-arrow">›</span>
      </button>
    </div>
  `;

  // Event delegation
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const target = btn.dataset.target;

    if (action === 'navigate' && target) {
      navigate(target);
    }
  });
}
