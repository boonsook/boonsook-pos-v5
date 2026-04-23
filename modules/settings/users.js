import { escHtml } from "./utils.js";

export function renderSettingsUsers(el, ctx, goBack, navigateToView) {
  const { state, ROLE_LABELS, changeRole, openAddUserDrawer, showToast } = ctx;
  const roleColors = { admin: "#dc2626", technician: "#d97706", sales: "#0284c7", customer: "#059669" };

  el.innerHTML = `
    <div class="set-subpage">
      <div class="set-subpage-header">
        <button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">ตั้งค่าผู้ใช้งาน</h3>
      </div>

      <div style="text-align:right;margin-bottom:12px">
        <button id="openAddUserBtn" class="btn primary">+ เพิ่มผู้ใช้</button>
      </div>

      <div class="set-user-list">
        ${(state.allProfiles || []).filter(p => p.role !== "customer").map(p => {
          const rLabel = ROLE_LABELS[p.role] || p.role;
          const rColor = roleColors[p.role] || "#64748b";
          const isMe = p.id === state.currentUser?.id;
          return `
            <div class="set-user-card">
              <div class="set-user-avatar" style="background:${rColor}">${(p.full_name || "?").charAt(0).toUpperCase()}</div>
              <div class="set-user-info">
                <div class="set-user-name">${escHtml(p.full_name || "-")}${isMe ? ' <span class="badge ok" style="font-size:10px;padding:2px 6px">คุณ</span>' : ''}</div>
                <div class="set-user-role" style="color:${rColor}">${rLabel}</div>
                <div class="sku">${new Date(p.created_at).toLocaleDateString("th-TH")}</div>
              </div>
              ${isMe ? '' : `
                <select data-role-user-id="${p.id}" class="set-role-select">
                  <option value="admin" ${p.role==='admin'?'selected':''}>ผู้ดูแลระบบ</option>
                  <option value="technician" ${p.role==='technician'?'selected':''}>ช่าง</option>
                  <option value="sales" ${p.role==='sales'?'selected':''}>พนักงานขาย</option>
                  <option value="customer" ${p.role==='customer'?'selected':''}>ลูกค้า</option>
                </select>
              `}
            </div>
          `;
        }).join("") || '<div class="sku" style="text-align:center;padding:24px">ไม่มีผู้ใช้</div>'}
      </div>
    </div>
  `;

  document.getElementById("setBackBtn")?.addEventListener("click", goBack);
  document.getElementById("openAddUserBtn")?.addEventListener("click", openAddUserDrawer);
  el.querySelectorAll("[data-role-user-id]").forEach(sel => {
    sel.addEventListener("change", () => changeRole(sel.dataset.roleUserId, sel.value));
  });
}


// ═══════════════════════════════════════════════════════════
//  DOCUMENT SETTINGS SUB-PAGE
// ═══════════════════════════════════════════════════════════
