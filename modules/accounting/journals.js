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

// Phase 92.20: deep-link target — surface (sales list / receipt / audit log) ตั้งค่าก่อน
// navigate มาที่ route นี้ → consume + auto-open drawer ของ JV ใบนั้น (1-shot)
let _pendingOpenJvId = null;

/**
 * ตั้ง id ของ JV ที่จะให้ renderJournalsPage รอบหน้าเปิด drawer ให้ทันทีหลัง load entries
 * (1-shot — ถูก clear หลัง consume; ไม่ persist ข้าม navigate)
 * @param {number|string|null} id - JV entry id (จาก data-jv-id ของ sale-acct-trace badge)
 */
export function setPendingJvId(id) {
  _pendingOpenJvId = (id == null || id === "") ? null : id;
}

export async function renderJournalsPage(ctx) {
  const container = document.getElementById("page-accounting_journals");
  if (!container) return;

  const { state: _state, showToast: _showToast } = ctx;
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
    // Phase 92.20: load fail → clear pending deep-link (ถ้ามี) เพื่อกัน stale consume
    // เมื่อ user ออกจากหน้า/refresh แล้วกลับมาทีหลังโดยไม่ได้คลิก surface อีกครั้ง
    _pendingOpenJvId = null;
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

  // ★ Phase 88.7: Click row → เปิด drawer drill-down (lines + source link)
  container.querySelectorAll("[data-jv-row]").forEach(row => row.addEventListener("click", () => {
    const id = Number(row.dataset.jvRow);
    const entry = _entries.find(e => e.id === id);
    if (entry) _openJvDrawer(entry, ctx);
  }));

  // ★ Phase 92.20: deep-link consume — surface ตั้ง pending id ก่อน navigate
  //   → entries โหลดเสร็จแล้วเปิด drawer ของ JV ใบนั้นทันที (1-shot)
  if (_pendingOpenJvId != null) {
    const want = String(_pendingOpenJvId);
    _pendingOpenJvId = null; // 1-shot — clear ก่อน open กัน re-entry
    const target = _entries.find(e => String(e.id) === want);
    if (target) {
      // queueMicrotask → ให้ DOM bind events เสร็จก่อน (drawer overlay อยู่บน body, ไม่ขัดกัน)
      queueMicrotask(() => _openJvDrawer(target, ctx));
    } else {
      console.info("[journals deep-link] JV id", want, "not in first 200 entries — drawer ไม่เปิด");
    }
  }
}


// ═══════════════════════════════════════════════════════════
//  Phase 88.7 — JV Drill-down Drawer
//  คลิก row → drawer แสดง lines + source preview + navigate ปุ่ม
// ═══════════════════════════════════════════════════════════

const SOURCE_LABELS = {
  sales:        { icon: "🛒", label: "การขาย POS",   route: "sales" },
  expenses:     { icon: "💸", label: "รายจ่าย",       route: "expenses" },
  receipts:     { icon: "🧾", label: "ใบเสร็จ",       route: "receipts" },
  service_jobs: { icon: "🔧", label: "งานช่าง",       route: "service_jobs" }
};

async function _openJvDrawer(entry, ctx) {
  // เปิด drawer แบบ overlay
  document.getElementById("jvDrawer")?.remove();
  const drawer = document.createElement("div");
  drawer.id = "jvDrawer";
  drawer.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;justify-content:flex-end";
  drawer.innerHTML = `
    <div style="background:#fff;width:100%;max-width:680px;height:100%;overflow-y:auto;box-shadow:-4px 0 20px rgba(0,0,0,.15);display:flex;flex-direction:column">
      <div style="padding:16px 18px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:12px">
        <div style="flex:1">
          <div style="font-size:11px;color:#64748b">รายละเอียด JV</div>
          <div style="font-weight:800;font-size:18px;color:#0284c7;font-family:monospace">${escHtml(entry.doc_no)}</div>
        </div>
        <button id="jvDrawerClose" style="background:#f1f5f9;border:none;width:36px;height:36px;border-radius:10px;cursor:pointer;font-size:18px">×</button>
      </div>
      <div id="jvDrawerBody" style="flex:1;padding:18px">
        <div style="text-align:center;color:#94a3b8;padding:40px">⏳ กำลังโหลด...</div>
      </div>
    </div>
  `;
  document.body.appendChild(drawer);

  // close handlers
  drawer.addEventListener("click", e => { if (e.target === drawer) drawer.remove(); });
  document.getElementById("jvDrawerClose").addEventListener("click", () => drawer.remove());

  // Fetch lines + COA + source row in parallel
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };

  try {
    const [linesRes, coaRes, sourceRow] = await Promise.all([
      fetch(`${cfg.url}/rest/v1/journal_lines?select=*&entry_id=eq.${entry.id}&order=line_no.asc`, { headers }).then(r => r.json()),
      fetch(`${cfg.url}/rest/v1/chart_of_accounts?select=code,name`, { headers }).then(r => r.json()),
      _fetchSourceRow(entry, headers)
    ]);

    const coaMap = {};
    (coaRes || []).forEach(a => { coaMap[a.code] = a.name; });

    _renderJvDrawerBody(entry, linesRes || [], coaMap, sourceRow, ctx);
  } catch(err) {
    console.error("[jv-drawer] load fail:", err);
    document.getElementById("jvDrawerBody").innerHTML = `
      <div style="padding:20px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;color:#991b1b">
        ❌ โหลดข้อมูลไม่สำเร็จ: ${escHtml(err.message || String(err))}
      </div>`;
  }
}

async function _fetchSourceRow(entry, headers) {
  if (!entry.source_table || !entry.source_id) return null;
  if (!SOURCE_LABELS[entry.source_table]) return null;
  const cfg = window.SUPABASE_CONFIG;
  try {
    const r = await fetch(`${cfg.url}/rest/v1/${entry.source_table}?select=*&id=eq.${entry.source_id}&limit=1`, { headers });
    if (!r.ok) return null;
    const arr = await r.json();
    return arr?.[0] || null;
  } catch(_) { return null; }
}

function _renderJvDrawerBody(entry, lines, coaMap, sourceRow, _ctx) {
  const body = document.getElementById("jvDrawerBody");
  if (!body) return;

  const st = STATUS_LABEL[entry.status] || STATUS_LABEL.draft;
  const dtLabel = DOC_TYPE_LABEL[entry.doc_type] || entry.doc_type;
  const totalDr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01;

  // Source preview
  let sourceSection = "";
  if (entry.source_table) {
    const meta = SOURCE_LABELS[entry.source_table];
    if (sourceRow) {
      sourceSection = `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px;margin-top:14px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:18px">${meta?.icon || "🔗"}</span>
            <div style="flex:1">
              <div style="font-size:11px;color:#1e40af">ที่มา (Source)</div>
              <div style="font-weight:700;color:#1e3a8a">${escHtml(meta?.label || entry.source_table)} #${entry.source_id}</div>
            </div>
            ${meta?.route ? `<button class="jv-goto-source" data-route="${meta.route}" style="padding:6px 12px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">เปิดหน้า →</button>` : ''}
          </div>
          ${_renderSourcePreview(entry.source_table, sourceRow)}
        </div>`;
    } else {
      sourceSection = `
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:12px;margin-top:14px;font-size:12px;color:#78350f">
          ⚠️ ไม่พบ source row (${escHtml(entry.source_table)} #${entry.source_id}) — อาจถูกลบไปแล้ว
        </div>`;
    }
  }

  body.innerHTML = `
    <!-- Meta -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;background:#f8fafc;border-radius:10px;padding:12px;margin-bottom:14px">
      <div>
        <div style="font-size:11px;color:#64748b">วันที่</div>
        <div style="font-weight:700">${dateTH(entry.doc_date)}</div>
      </div>
      <div>
        <div style="font-size:11px;color:#64748b">ประเภท</div>
        <div style="font-weight:700">${entry.doc_type} — ${escHtml(dtLabel)}</div>
      </div>
      <div>
        <div style="font-size:11px;color:#64748b">สถานะ</div>
        <div><span style="display:inline-block;padding:3px 10px;border-radius:12px;background:${st.bg};color:${st.color};font-size:11px;font-weight:700">${st.th}</span></div>
      </div>
    </div>

    <!-- Description -->
    ${entry.description ? `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:14px">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px">คำอธิบาย</div>
        <div style="color:#0f172a;line-height:1.5">${escHtml(entry.description)}</div>
      </div>
    ` : ''}

    <!-- Lines -->
    <div style="margin-bottom:14px">
      <div style="font-weight:700;color:#0f172a;margin-bottom:8px">📋 รายการ Dr/Cr (${lines.length} บรรทัด)</div>
      <div style="overflow-x:auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f8fafc;font-size:11px;color:#64748b">
              <th style="padding:8px 10px;text-align:left;width:40px">#</th>
              <th style="padding:8px 10px;text-align:left;width:80px">รหัส</th>
              <th style="padding:8px 10px;text-align:left">ชื่อบัญชี</th>
              <th style="padding:8px 10px;text-align:right;width:90px">เดบิต</th>
              <th style="padding:8px 10px;text-align:right;width:90px">เครดิต</th>
            </tr>
          </thead>
          <tbody>
            ${lines.map(l => `
              <tr style="border-top:1px solid #f1f5f9">
                <td style="padding:8px 10px;color:#94a3b8;font-family:monospace">${l.line_no}</td>
                <td style="padding:8px 10px;color:#475569;font-family:monospace">${escHtml(l.account_code)}</td>
                <td style="padding:8px 10px">${escHtml(coaMap[l.account_code] || "(ไม่พบ)")}</td>
                <td style="padding:8px 10px;text-align:right;font-family:monospace;color:#0f172a">${l.debit > 0 ? money(l.debit) : '<span style="color:#cbd5e1">-</span>'}</td>
                <td style="padding:8px 10px;text-align:right;font-family:monospace;color:#0f172a">${l.credit > 0 ? money(l.credit) : '<span style="color:#cbd5e1">-</span>'}</td>
              </tr>
            `).join("")}
            <tr style="background:#f8fafc;font-weight:800">
              <td colspan="3" style="padding:10px;text-align:right;color:${balanced ? '#15803d' : '#dc2626'}">${balanced ? '✓' : '⚠️'} รวม</td>
              <td style="padding:10px;text-align:right;font-family:monospace;color:${balanced ? '#15803d' : '#dc2626'}">${money(totalDr)}</td>
              <td style="padding:10px;text-align:right;font-family:monospace;color:${balanced ? '#15803d' : '#dc2626'}">${money(totalCr)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      ${!balanced ? `<div style="font-size:11px;color:#dc2626;margin-top:6px">⚠️ Dr ≠ Cr (ผลต่าง ${money(totalDr - totalCr)}) — JV นี้อาจมีปัญหา ติดต่อ admin</div>` : ''}
    </div>

    ${sourceSection}

    <!-- Audit info -->
    <div style="margin-top:18px;padding:10px;background:#fafbfc;border-radius:8px;font-size:11px;color:#64748b;line-height:1.7">
      <div>📅 สร้าง: ${entry.created_at ? new Date(entry.created_at).toLocaleString("th-TH") : "-"}</div>
      ${entry.approved_at ? `<div>✅ อนุมัติ: ${new Date(entry.approved_at).toLocaleString("th-TH")}</div>` : ""}
      ${entry.voided_at ? `<div>❌ ยกเลิก: ${new Date(entry.voided_at).toLocaleString("th-TH")}${entry.void_reason ? ` (${escHtml(entry.void_reason)})` : ""}</div>` : ""}
    </div>
  `;

  // Wire goto source button
  body.querySelector(".jv-goto-source")?.addEventListener("click", () => {
    const route = body.querySelector(".jv-goto-source").dataset.route;
    document.getElementById("jvDrawer")?.remove();
    // Navigate via existing app routing
    document.querySelector(`[data-route="${route}"]`)?.click();
  });
}

function _renderSourcePreview(sourceTable, row) {
  if (!row) return "";
  if (sourceTable === "sales") {
    return `
      <div style="font-size:12px;color:#1e3a8a;line-height:1.7">
        <div>เลขบิล: <b>${escHtml(row.order_no || row.id)}</b></div>
        <div>ลูกค้า: ${escHtml(row.customer_name || "-")}</div>
        <div>ยอดรวม: <b>${money(row.total_amount || row.grand_total)}</b> · ชำระ: ${escHtml(row.payment_method || "-")}</div>
      </div>`;
  }
  if (sourceTable === "expenses") {
    return `
      <div style="font-size:12px;color:#1e3a8a;line-height:1.7">
        <div>หมวด: <b>${escHtml(row.category || "-")}</b></div>
        <div>คำอธิบาย: ${escHtml(row.description || "-")}</div>
        <div>ยอด: <b>${money(row.amount)}</b> · ชำระ: ${escHtml(row.payment_method || "-")}</div>
        ${row.receipt_url ? `<div><a href="${escHtml(row.receipt_url)}" target="_blank" style="color:#3b82f6">📷 ดูรูปบิล</a></div>` : ""}
      </div>`;
  }
  if (sourceTable === "service_jobs") {
    return `
      <div style="font-size:12px;color:#1e3a8a;line-height:1.7">
        <div>เลขที่: <b>${escHtml(row.job_no || row.id)}</b></div>
        <div>ลูกค้า: ${escHtml(row.customer_name || "-")} · ${escHtml(row.customer_phone || "")}</div>
        <div>ประเภท: ${escHtml(row.job_type || "-")} · สถานะ: <b>${escHtml(row.status || "-")}</b></div>
        <div>ยอด: <b>${money(row.total_cost)}</b></div>
        ${row.payment_slip_url ? `<div><a href="${escHtml(row.payment_slip_url)}" target="_blank" style="color:#3b82f6">📷 ดูสลิป</a></div>` : ""}
      </div>`;
  }
  if (sourceTable === "receipts") {
    return `
      <div style="font-size:12px;color:#1e3a8a;line-height:1.7">
        <div>เลขที่: <b>${escHtml(row.receipt_no || row.id)}</b></div>
        <div>ลูกค้า: ${escHtml(row.customer_name || "-")}</div>
        <div>ยอด: <b>${money(row.grand_total || row.total_amount)}</b> · สถานะ: ${escHtml(row.status || "-")}</div>
      </div>`;
  }
  return `<div style="font-size:11px;color:#64748b">id ${row.id}</div>`;
}
