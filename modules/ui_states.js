/**
 * UI States Module — Boonsook POS V5 PRO
 *
 * Standardized empty / loading / error states ใช้ทั่วแอป
 * ออกแบบเป็น HTML-string functions (ตาม pattern existing modules)
 *
 * Usage:
 *   import { renderEmpty, renderSkeleton, renderError } from "./ui_states.js";
 *
 *   container.innerHTML = list.length === 0
 *     ? renderEmpty({ icon: "📭", title: "ยังไม่มีงาน", actionLabel: "+ เพิ่มงาน", actionId: "btnAddJob" })
 *     : renderList(list);
 *
 * หลังใส่ HTML แล้ว — bind handler ผ่าน document.getElementById(actionId).onclick
 *
 * Phase 46.1 (29 เม.ย. 2026)
 * Phase 46.5 (29 เม.ย. 2026) — defensive XSS escape on all caller-supplied content
 */

// Phase 46.5: defensive escape — กัน XSS ถ้า caller เผลอส่ง dynamic data (เช่น error message จาก server)
function escHtml(s) {
  return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

// strict ID sanitizer — DOM IDs ต้องเป็น alphanumeric/dash/underscore เท่านั้น
function safeId(s) {
  return String(s || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

// ═══════════════════════════════════════════════════════════
// 1) Inject shimmer keyframes (ครั้งเดียว — guard ด้วย dataset)
// ═══════════════════════════════════════════════════════════
function _injectKeyframes() {
  if (document.head.dataset.uiStatesKf === "1") return;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes ui-shimmer {
      0% { background-position: -400px 0; }
      100% { background-position: 400px 0; }
    }
    .ui-skel {
      background: linear-gradient(90deg, #e2e8f0 0%, #f1f5f9 50%, #e2e8f0 100%);
      background-size: 800px 100%;
      animation: ui-shimmer 1.4s ease-in-out infinite;
      border-radius: 6px;
    }
  `;
  document.head.appendChild(style);
  document.head.dataset.uiStatesKf = "1";
}


// ═══════════════════════════════════════════════════════════
// 2) renderSkeleton — placeholder ระหว่างรอ data
// ═══════════════════════════════════════════════════════════
/**
 * @param {Object} opts
 * @param {'list'|'card-grid'|'table'|'dashboard-cards'} [opts.type='list']
 * @param {number} [opts.count=3] - จำนวน skeleton item
 * @returns {string} HTML
 */
export function renderSkeleton(opts = {}) {
  _injectKeyframes();
  const { type = "list", count = 3 } = opts;

  if (type === "card-grid") {
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-top:12px">
      ${Array.from({ length: count }).map(() => `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px">
          <div class="ui-skel" style="height:90px;margin-bottom:10px"></div>
          <div class="ui-skel" style="height:14px;width:80%;margin-bottom:6px"></div>
          <div class="ui-skel" style="height:14px;width:60%;margin-bottom:8px"></div>
          <div class="ui-skel" style="height:18px;width:50%"></div>
        </div>
      `).join("")}
    </div>`;
  }

  if (type === "table") {
    return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-top:12px">
      ${Array.from({ length: count }).map(() => `
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #f1f5f9">
          <div class="ui-skel" style="height:14px;width:25%"></div>
          <div class="ui-skel" style="height:14px;width:35%"></div>
          <div class="ui-skel" style="height:14px;width:20%"></div>
          <div class="ui-skel" style="height:14px;width:15%"></div>
        </div>
      `).join("")}
    </div>`;
  }

  if (type === "dashboard-cards") {
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:12px">
      ${Array.from({ length: count }).map(() => `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px">
          <div class="ui-skel" style="height:12px;width:50%;margin-bottom:10px"></div>
          <div class="ui-skel" style="height:24px;width:70%"></div>
        </div>
      `).join("")}
    </div>`;
  }

  // type === 'list' (default)
  return `<div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
    ${Array.from({ length: count }).map(() => `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px">
        <div class="ui-skel" style="height:16px;width:40%;margin-bottom:8px"></div>
        <div class="ui-skel" style="height:13px;width:75%;margin-bottom:6px"></div>
        <div class="ui-skel" style="height:13px;width:55%"></div>
      </div>
    `).join("")}
  </div>`;
}


// ═══════════════════════════════════════════════════════════
// 3) renderEmpty — แสดงตอนไม่มี data + optional CTA
// ═══════════════════════════════════════════════════════════
/**
 * @param {Object} opts
 * @param {string} [opts.icon='📭'] - emoji หรือ icon
 * @param {string} [opts.title='ยังไม่มีข้อมูล']
 * @param {string} [opts.message=''] - sub message (อธิบาย/แนะนำขั้นต่อไป)
 * @param {string} [opts.actionLabel=''] - label ปุ่ม CTA (ว่าง = ไม่แสดงปุ่ม)
 * @param {string} [opts.actionId=''] - id ปุ่ม (ใช้ binding handler)
 * @param {string} [opts.actionStyle='primary'] - 'primary' | 'ghost'
 * @returns {string} HTML
 */
export function renderEmpty(opts = {}) {
  const {
    icon = "📭",
    title = "ยังไม่มีข้อมูล",
    message = "",
    actionLabel = "",
    actionId = "",
    actionStyle = "primary"
  } = opts;

  const btnBg     = actionStyle === "ghost" ? "#fff"    : "#0284c7";
  const btnColor  = actionStyle === "ghost" ? "#0284c7" : "#fff";
  const btnBorder = actionStyle === "ghost" ? "1px solid #0284c7" : "none";

  // Phase 46.5: escape all caller-supplied content
  const ctaHtml = actionLabel
    ? `<button id="${safeId(actionId)}" style="margin-top:14px;padding:10px 20px;border:${btnBorder};border-radius:10px;background:${btnBg};color:${btnColor};font-size:14px;font-weight:700;cursor:pointer">${escHtml(actionLabel)}</button>`
    : "";

  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px 20px;text-align:center;background:#fff;border:1px dashed #cbd5e1;border-radius:14px;margin-top:12px">
    <div style="font-size:48px;margin-bottom:10px;opacity:.85">${escHtml(icon)}</div>
    <div style="font-size:16px;font-weight:800;color:#334155;margin-bottom:6px">${escHtml(title)}</div>
    ${message ? `<div style="font-size:13px;color:#64748b;max-width:340px;line-height:1.5">${escHtml(message)}</div>` : ""}
    ${ctaHtml}
  </div>`;
}


// ═══════════════════════════════════════════════════════════
// 4) renderError — แสดงตอน fetch fail + retry button
// ═══════════════════════════════════════════════════════════
/**
 * @param {Object} opts
 * @param {string} [opts.message='เกิดข้อผิดพลาด'] - ข้อความหลัก
 * @param {string} [opts.detail=''] - รายละเอียดเทคนิค (เช่น HTTP code)
 * @param {string} [opts.retryLabel='ลองใหม่'] - label ปุ่ม retry
 * @param {string} [opts.retryId=''] - id ปุ่ม retry (ใช้ binding handler)
 * @returns {string} HTML
 */
export function renderError(opts = {}) {
  const {
    message = "เกิดข้อผิดพลาด",
    detail = "",
    retryLabel = "ลองใหม่",
    retryId = ""
  } = opts;

  // Phase 46.5: escape all caller-supplied content (เพราะ detail มักมาจาก server error)
  const retryHtml = retryId
    ? `<button id="${safeId(retryId)}" style="margin-top:14px;padding:8px 18px;border:1px solid #dc2626;border-radius:10px;background:#fff;color:#dc2626;font-size:13px;font-weight:700;cursor:pointer">🔄 ${escHtml(retryLabel)}</button>`
    : "";

  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px 20px;text-align:center;background:#fef2f2;border:1px solid #fecaca;border-radius:14px;margin-top:12px">
    <div style="font-size:42px;margin-bottom:8px">⚠️</div>
    <div style="font-size:15px;font-weight:800;color:#991b1b;margin-bottom:4px">${escHtml(message)}</div>
    ${detail ? `<div style="font-size:11px;color:#7f1d1d;font-family:ui-monospace,monospace;max-width:400px;word-break:break-all;opacity:.7">${escHtml(detail)}</div>` : ""}
    ${retryHtml}
  </div>`;
}
