import { escHtml } from "./utils.js";

export function renderSettingsPermissions(el, ctx, goBack) {
  el.innerHTML = `
    <div class="set-subpage">
      <div class="set-subpage-header">
        <button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">ตารางสิทธิ์พนักงาน</h3>
      </div>
      <div id="permMatrixContainer"></div>
    </div>
  `;
  document.getElementById("setBackBtn")?.addEventListener("click", goBack);
  // ★ เรียก renderPermissionMatrix จาก main.js context
  if (ctx.renderPermissionMatrix) {
    const container = document.getElementById("permMatrixContainer");
    ctx.renderPermissionMatrix(ctx, container);
  }
}

// ═══════════════════════════════════════════════════════════
//  LINE NOTIFY SUB-PAGE
// ═══════════════════════════════════════════════════════════
