// ═══════════════════════════════════════════════════════════
//  accounting/journals.js — สมุดรายวัน list view (Phase 88.0)
//
//  แสดง journal entries ทั้งหมด — filter ตาม status / doc_type / date range
//  ปุ่ม "+ บันทึกรายการบัญชี" → เปิด journal_form
// ═══════════════════════════════════════════════════════════

import { renderEmpty } from "../ui_states.js";

const escHtml = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
function money(n) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}
function dateTH(d) {
  if (!d) return "-";
  try { return new Date(d).toLocaleDateString("th-TH", { year: "2-digit", month: "2-digit", day: "2-digit" }); }
  catch(e) { return d; }
}

const DOC_TYPE_LABEL = {
  JV: "รายวันทั่วไป",
  PV: "จ่าย",
  SV: "ขาย",
  RV: "รับ",
  CV: "เงินสด",
  AJ: "ปรับปรุง",
  OB: "ยอดยกมา"
};

const STATUS_LABEL = {
  draft:    { th: "ฉบับร่าง",  color: "#64748b", bg: "#f1f5f9" },
  approved: { th: "อนุมัติแล้ว", color: "#065f46", bg: "#ecfdf5" },
  void:     { th: "ยกเลิก",    color: "#7f1d1d", bg: "#fef2f2" }
};

let _filterStatus = "all";          // all | draft | approved | void
let _filterDocType = "all";          // all | JV | PV | SV | RV | CV | AJ | OB
let _entries = [];                   // cached after fetch

export async function renderJournalsPage(ctx) {
  const container = document.getElementById("page-accounting_journals");
  if (!container) return;

  const { state, showToast } = ctx;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;

  // ─── Fetch entries ───────────────────────────────────────
  container.innerHTML = `
    <div class="panel">
      <div class="row">
        <h3 style="margin:0">📒 สมุดรายวัน</h3>
        <button id="jvAddBtn" class="btn primary">+ บันทึกรายการบัญชี</button>
      </div>
      <div style="padding:30px;text-align:center;color:#94a3b8">⏳ กำลังโหลด...</div>
    </div>`;

  try {
    const resp = await fetch(`${cfg.url}/rest/v1/journal_entries?select=*&order=doc_date.desc,id.desc&limit=200`, {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    _entries = await resp.json();
  } catch(err) {
    console.error("[journals] fetch error:", err);
    container.innerHTML = `
      <div class="panel">
        <div class="row"><h3 style="margin:0">📒 สมุดรายวัน</h3></div>
        ${renderEmpty({
          icon: "⚠️",
          title: "โหลดข้อมูลไม่สำเร็จ",
          message: "อาจยังไม่ได้รัน supabase-phase88-accounting-foundation.sql<br>หรือไม่มีสิทธิ์เข้าถึง (ต้องเป็น admin)",
          actionLabel: "ลองใหม่",
          actionId: "jvRetryBtn"
        })}
      </div>`;
    document.getElementById("jvRetryBtn")?.addEventListener("click", () => renderJournalsPage(ctx));
    return;
  }

  // Apply filters
  const filtered = _entries.filter(e => {
    if (_filterStatus !== "all" && e.status !== _filterStatus) return false;
    if (_filterDocType !== "all" && e.doc_type !== _filterDocType) return false;
    return true;
  });

  // Counts
  const cAll      = _entries.length;
  const cDraft    = _entries.filter(e => e.status === "draft").length;
  const cApproved = _entries.filter(e => e.status === "approved").length;
  const cVoid     = _entries.filter(e => e.status === "void").length;

  const chip = (key, label, count, color) => {
    const active = _filterStatus === key;
    return `<button class="jv-status-chip" data-jv-status="${key}" style="padding:6px 14px;border-radius:18px;border:1px solid ${active?color:'#cbd5e1'};background:${active?color:'#fff'};color:${active?'#fff':'#475569'};cursor:pointer;font-size:12px;font-weight:600">${label}${count > 0 ? ` (${count})` : ''}</button>`;
  };

  container.innerHTML = `
    <div class="panel">
      <div class="row">
        <h3 style="margin:0">📒 สมุดรายวัน</h3>
        <button id="jvAddBtn" class="btn primary">+ บันทึกรายการบัญชี</button>
      </div>

      <!-- Status filter chips -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;align-items:center">
        <span style="font-size:12px;color:#64748b;font-weight:600;margin-right:4px">สถานะ:</span>
        ${chip("all",      "ทั้งหมด",   cAll,      "#475569")}
        ${chip("draft",    "📝 ร่าง",    cDraft,    "#64748b")}
        ${chip("approved", "✅ อนุมัติ", cApproved, "#10b981")}
        ${chip("void",     "❌ ยกเลิก",  cVoid,     "#ef4444")}
      </div>

      <!-- Doc type filter -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">
        <span style="font-size:12px;color:#64748b;font-weight:600;margin-right:4px">ประเภท:</span>
        <select id="jvDocTypeFilter" style="padding:5px 10px;border-radius:14px;border:1px solid #cbd5e1;font-size:12px">
          <option value="all" ${_filterDocType==='all'?'selected':''}>ทั้งหมด</option>
          ${Object.entries(DOC_TYPE_LABEL).map(([k, v]) =>
            `<option value="${k}" ${_filterDocType===k?'selected':''}>${k} — ${v}</option>`
          ).join("")}
        </select>
        <span style="font-size:11px;color:#94a3b8">→ พบ ${filtered.length} รายการ</span>
      </div>

      <!-- Entries table -->
      <div style="overflow-x:auto;margin-top:14px">
        <table class="doc-list-table" style="width:100%;border-collapse:collapse;font-size:13px;background:#fff">
          <thead>
            <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
              <th style="padding:10px 12px;text-align:left;width:90px">วันที่</th>
              <th style="padding:10px 12px;text-align:left;width:140px">เลขที่เอกสาร</th>
              <th style="padding:10px 12px;text-align:left;width:80px">ประเภท</th>
              <th style="padding:10px 12px;text-align:left">คำอธิบาย</th>
              <th style="padding:10px 12px;text-align:right;width:130px">ยอดรวมสุทธิ</th>
              <th style="padding:10px 12px;text-align:left;width:110px">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length ? filtered.map(e => {
              const st = STATUS_LABEL[e.status] || STATUS_LABEL.draft;
              const dtLabel = DOC_TYPE_LABEL[e.doc_type] || e.doc_type;
              return `
                <tr data-jv-row="${e.id}" style="border-bottom:1px solid #f1f5f9;cursor:pointer" onmouseover="this.style.background='#fafbfc'" onmouseout="this.style.background=''">
                  <td style="padding:8px 12px">${dateTH(e.doc_date)}</td>
                  <td style="padding:8px 12px;font-weight:700;color:#0284c7">${escHtml(e.doc_no)}</td>
                  <td style="padding:8px 12px;font-size:11px;color:#64748b">${e.doc_type} — ${escHtml(dtLabel)}</td>
                  <td style="padding:8px 12px;color:#334155">${escHtml((e.description || "").slice(0, 80))}${(e.description||"").length > 80 ? '…' : ''}</td>
                  <td style="padding:8px 12px;text-align:right;font-weight:700">${money(e.total_debit)}</td>
                  <td style="padding:8px 12px"><span style="display:inline-block;padding:3px 10px;border-radius:12px;background:${st.bg};color:${st.color};font-size:11px;font-weight:700">${st.th}</span></td>
                </tr>`;
            }).join("") : `
              <tr><td colspan="6" style="padding:0">${renderEmpty({
                icon: cAll === 0 ? "📒" : "🔍",
                title: cAll === 0 ? "ยังไม่มีรายการบัญชี" : "ไม่พบรายการตามเงื่อนไข",
                message: cAll === 0 ? "เริ่มบันทึกรายการบัญชีแรก — กดปุ่ม + ด้านบน หรือรอ auto-post จาก sales/expenses (Phase 88.1)" : "ลองเปลี่ยนตัวกรอง",
                actionLabel: cAll === 0 ? "+ บันทึกรายการบัญชี" : "ล้างตัวกรอง",
                actionId: cAll === 0 ? "jvEmptyAddBtn" : "jvClearFilter"
              })}</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>`;

  // ─── Bind events ─────────────────────────────────────────
  container.querySelectorAll("[data-jv-status]").forEach(btn => btn.addEventListener("click", () => {
    _filterStatus = btn.dataset.jvStatus;
    renderJournalsPage(ctx);
  }));
  document.getElementById("jvDocTypeFilter")?.addEventListener("change", (ev) => {
    _filterDocType = ev.target.value;
    renderJournalsPage(ctx);
  });
  document.getElementById("jvAddBtn")?.addEventListener("click", () => {
    location.hash = "accounting_journal_new";
  });
  document.getElementById("jvEmptyAddBtn")?.addEventListener("click", () => {
    location.hash = "accounting_journal_new";
  });
  document.getElementById("jvClearFilter")?.addEventListener("click", () => {
    _filterStatus = "all"; _filterDocType = "all";
    renderJournalsPage(ctx);
  });

  // Click row → ดูรายละเอียด (Phase 88.0b — TBD: drawer drill-down)
  container.querySelectorAll("[data-jv-row]").forEach(row => row.addEventListener("click", () => {
    const id = Number(row.dataset.jvRow);
    showToast?.("กำลังเปิดรายละเอียด JV " + id + " (Phase 88.0b)");
    // TODO Phase 88.0b: open drawer with JV detail + journal_lines
  }));
}
