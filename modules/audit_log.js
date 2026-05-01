// ═══════════════════════════════════════════════════════════
//  AUDIT LOG VIEWER (Phase 57)
//  ดูประวัติการใช้งาน — admin only
// ═══════════════════════════════════════════════════════════
import { renderSkeleton, renderEmpty, renderError } from "./ui_states.js";
import { escHtml } from "./utils.js";

const ACTION_META = {
  delete_sale:        { icon: "🗑️", color: "#dc2626", label: "ลบบิลขาย" },
  delete_quotation:   { icon: "🗑️", color: "#dc2626", label: "ลบใบเสนอราคา" },
  delete_service_job: { icon: "🗑️", color: "#dc2626", label: "ลบใบงานช่าง" },
  delete_invoice:     { icon: "🗑️", color: "#dc2626", label: "ลบใบส่งสินค้า" },
  delete_receipt:     { icon: "🗑️", color: "#dc2626", label: "ลบใบเสร็จ" },
  cancel_sale:        { icon: "🚫", color: "#f59e0b", label: "ยกเลิกบิลขาย" },
  change_role:        { icon: "🔑", color: "#7c3aed", label: "เปลี่ยน role" },
  reset_pin:          { icon: "🔐", color: "#0284c7", label: "รีเซ็ต PIN" },
  permission_change:  { icon: "🛡️", color: "#0284c7", label: "เปลี่ยน permission" },
  login:              { icon: "🔓", color: "#10b981", label: "เข้าระบบ" },
  signup:             { icon: "✨", color: "#10b981", label: "สมัครสมาชิก" },
  logout:             { icon: "🚪", color: "#64748b", label: "ออกระบบ" },
};

function _formatDate(s) {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleString("th-TH", {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
  } catch { return String(s); }
}

let _logs = [];
let _filterAction = "all";

export async function renderAuditLogPage(ctx) {
  const { state, showToast, requireAdmin } = ctx;
  const container = document.getElementById("page-audit_log");
  if (!container) return;

  if (!requireAdmin?.()) {
    container.innerHTML = renderError({
      message: "เฉพาะผู้ดูแลระบบ",
      detail: "หน้านี้เห็นได้เฉพาะ role admin เท่านั้น",
      retryLabel: "",
      retryId: ""
    });
    return;
  }

  container.innerHTML = renderSkeleton({ type: "list", count: 6 });

  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;

  try {
    const res = await fetch(cfg.url + "/rest/v1/activity_log?select=*&order=created_at.desc&limit=200", {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token }
    });
    if (!res.ok) {
      container.innerHTML = renderError({
        message: "ตาราง activity_log ยังไม่มีในฐานข้อมูล",
        detail: "รัน supabase-phase57-activity-log.sql ใน Supabase SQL Editor ก่อน (HTTP " + res.status + ")",
        retryLabel: "ลองโหลดใหม่",
        retryId: "alRetryBtn"
      });
      document.getElementById("alRetryBtn")?.addEventListener("click", () => renderAuditLogPage(ctx));
      return;
    }
    _logs = await res.json();
  } catch (e) {
    container.innerHTML = renderError({
      message: "โหลดข้อมูลไม่สำเร็จ",
      detail: e?.message || String(e),
      retryLabel: "ลองใหม่",
      retryId: "alRetryBtn"
    });
    document.getElementById("alRetryBtn")?.addEventListener("click", () => renderAuditLogPage(ctx));
    return;
  }

  // unique actions for filter
  const actionCounts = {};
  _logs.forEach(l => { actionCounts[l.action] = (actionCounts[l.action] || 0) + 1; });

  let view = _logs;
  if (_filterAction !== "all") view = _logs.filter(l => l.action === _filterAction);

  container.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#dbeafe,#fef3c7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">📜</div>
        <h2 style="margin:0 0 4px;color:#0f172a">ประวัติการใช้งาน (Audit Log)</h2>
        <p style="margin:0;color:#475569;font-size:13px">ดูใครทำอะไรเมื่อไหร่ — ตรวจย้อนหลัง 200 รายการล่าสุด</p>
      </div>

      <!-- Filter pills -->
      <div class="panel" style="padding:12px;margin-bottom:14px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="al-filter-btn" data-f="all" style="padding:6px 12px;border-radius:14px;border:1px solid ${_filterAction==='all'?'#0284c7':'#cbd5e1'};background:${_filterAction==='all'?'#0284c7':'#fff'};color:${_filterAction==='all'?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">ทั้งหมด (${_logs.length})</button>
        ${Object.entries(actionCounts).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([act,n]) => {
          const m = ACTION_META[act] || { icon: "•", color: "#64748b", label: act };
          return `<button class="al-filter-btn" data-f="${escHtml(act)}" style="padding:6px 12px;border-radius:14px;border:1px solid ${_filterAction===act?m.color:'#cbd5e1'};background:${_filterAction===act?m.color:'#fff'};color:${_filterAction===act?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">${m.icon} ${escHtml(m.label)} (${n})</button>`;
        }).join("")}
      </div>

      <!-- Log list -->
      <div class="panel" style="padding:0">
        ${view.length === 0 ? renderEmpty({
          icon: "📭",
          title: _logs.length === 0 ? "ยังไม่มีประวัติการใช้งาน" : "ไม่พบรายการในตัวกรองนี้",
          message: _logs.length === 0 ? "เมื่อมีการลบบิล/ใบเสนอราคา/ใบงาน หรือเปลี่ยน role จะถูกบันทึกที่นี่อัตโนมัติ" : "ลองเปลี่ยนตัวกรองด้านบน"
        }) : `
          <div style="display:flex;flex-direction:column">
            ${view.map(l => {
              const m = ACTION_META[l.action] || { icon: "•", color: "#64748b", label: l.action };
              return `
                <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-bottom:1px solid #f1f5f9">
                  <div style="width:40px;height:40px;border-radius:50%;background:${m.color};color:#fff;display:grid;place-items:center;font-size:18px;flex-shrink:0">${m.icon}</div>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:13px;font-weight:700;color:${m.color}">${escHtml(m.label)}</div>
                    ${l.summary ? `<div style="font-size:13px;color:#0f172a;margin-top:2px">${escHtml(l.summary)}</div>` : ''}
                    <div style="font-size:11px;color:#64748b;margin-top:4px">
                      👤 ${escHtml(l.user_name || "ไม่ระบุ")}${l.user_role ? ` <span style="background:#f1f5f9;padding:1px 6px;border-radius:6px;font-size:10px">${escHtml(l.user_role)}</span>` : ''}
                      &nbsp;•&nbsp; 📅 ${_formatDate(l.created_at)}
                      ${l.entity_type ? ` &nbsp;•&nbsp; ${escHtml(l.entity_type)}${l.entity_id ? ` #${escHtml(l.entity_id)}` : ''}` : ''}
                    </div>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        `}
      </div>
    </div>
  `;

  // Filter buttons
  container.querySelectorAll(".al-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _filterAction = btn.dataset.f;
      renderAuditLogPage(ctx);
    });
  });
}
