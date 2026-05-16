// ═══════════════════════════════════════════════════════════
//  accounting/journal_form.js — JV form (Phase 88.0)
//
//  สร้างรายการบัญชีใหม่ — double-entry (debit = credit)
//  Header: doc_date, doc_type, description
//  Lines:  account_code (autocomplete), debit, credit, description
//  Validation: total_debit must equal total_credit
//  Save: POST journal_entries → POST journal_lines
//
//  Doc number auto-gen: JV2026MM#### (sequential per month)
// ═══════════════════════════════════════════════════════════

import { todayBkk } from "../utils.js";

const escHtml = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const escAttr = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;");

function money(n) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}

const DOC_TYPE_OPTIONS = [
  ["JV", "JV — รายวันทั่วไป"],
  ["PV", "PV — จ่าย"],
  ["SV", "SV — ขาย"],
  ["RV", "RV — รับ"],
  ["CV", "CV — เงินสด"],
  ["AJ", "AJ — ปรับปรุง"],
  ["OB", "OB — ยอดยกมา"]
];

let _coa = [];                      // chart of accounts cache
let _lines = [{ account_code: "", debit: 0, credit: 0, description: "" }];

export async function renderJournalFormPage(ctx) {
  const container = document.getElementById("page-accounting_journal_new");
  if (!container) return;

  const { state: _state, showToast: _showToast } = ctx;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;

  // ─── Load Chart of Accounts ──────────────────────────────
  if (_coa.length === 0) {
    container.innerHTML = `<div class="panel"><div style="padding:30px;text-align:center;color:#94a3b8">⏳ กำลังโหลดผังบัญชี...</div></div>`;
    try {
      const resp = await fetch(`${cfg.url}/rest/v1/chart_of_accounts?select=*&is_active=eq.true&order=sort_order.asc`, {
        headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token }
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      _coa = await resp.json();
    } catch(err) {
      console.error("[journal form] load COA:", err);
      container.innerHTML = `<div class="panel"><div style="padding:30px;text-align:center;color:#ef4444">⚠️ โหลดผังบัญชีไม่สำเร็จ — รัน supabase-phase88-accounting-foundation.sql ก่อน</div></div>`;
      return;
    }
  }

  // Reset lines if entering fresh (single empty line)
  if (_lines.length === 0) {
    _lines = [{ account_code: "", debit: 0, credit: 0, description: "" }];
  }

  const today = todayBkk();  // Phase 89.1: Bangkok time

  const accountOptions = _coa
    .filter(a => a.parent_code) // skip header rows (parent accounts)
    .map(a => `<option value="${a.code}">${a.code} — ${escHtml(a.name)}</option>`)
    .join("");

  const totalDebit  = _lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = _lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  container.innerHTML = `
    <div class="panel">
      <div class="row">
        <button id="jvBackBtn" class="btn light" style="font-size:13px">← กลับ</button>
        <h3 style="margin:0;flex:1;text-align:center">📝 บันทึกรายการบัญชีใหม่</h3>
        <span style="width:60px"></span>
      </div>

      <!-- Header fields -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:14px">
        <div>
          <label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">📅 วันที่</label>
          <input type="date" id="jvDocDate" value="${today}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">🏷️ ประเภทเอกสาร</label>
          <select id="jvDocType" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px">
            ${DOC_TYPE_OPTIONS.map(([k, l]) => `<option value="${k}">${escHtml(l)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div style="margin-top:10px">
        <label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">📝 คำอธิบาย</label>
        <input type="text" id="jvDesc" placeholder="เช่น: บันทึกรายการเงินเดือนสำหรับงวด 05/2026" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px" />
      </div>

      <!-- Lines table -->
      <div style="margin-top:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h4 style="margin:0;font-size:14px">📋 รายการ Debit / Credit</h4>
          <button id="jvAddLineBtn" class="btn light" style="font-size:12px;padding:6px 12px">+ เพิ่มบรรทัด</button>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:720px">
            <thead>
              <tr style="background:#f8fafc">
                <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;width:30px">#</th>
                <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0">บัญชี</th>
                <th style="padding:8px;text-align:right;border-bottom:2px solid #e2e8f0;width:120px">เดบิต (Dr)</th>
                <th style="padding:8px;text-align:right;border-bottom:2px solid #e2e8f0;width:120px">เครดิต (Cr)</th>
                <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0">คำอธิบายย่อย</th>
                <th style="padding:8px;width:40px;border-bottom:2px solid #e2e8f0"></th>
              </tr>
            </thead>
            <tbody>
              ${_lines.map((line, i) => `
                <tr>
                  <td style="padding:6px;color:#94a3b8;font-size:11px">${i + 1}</td>
                  <td style="padding:6px">
                    <select data-jv-line-acct="${i}" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px">
                      <option value="">— เลือกบัญชี —</option>
                      ${accountOptions.replace(`value="${line.account_code}"`, `value="${line.account_code}" selected`)}
                    </select>
                  </td>
                  <td style="padding:6px">
                    <input type="number" data-jv-line-debit="${i}" value="${line.debit || ''}" min="0" step="0.01" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;text-align:right" />
                  </td>
                  <td style="padding:6px">
                    <input type="number" data-jv-line-credit="${i}" value="${line.credit || ''}" min="0" step="0.01" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;text-align:right" />
                  </td>
                  <td style="padding:6px">
                    <input type="text" data-jv-line-desc="${i}" value="${escAttr(line.description || '')}" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px" />
                  </td>
                  <td style="padding:6px;text-align:center">
                    ${_lines.length > 1 ? `<button data-jv-line-del="${i}" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px" title="ลบบรรทัด">×</button>` : ''}
                  </td>
                </tr>
              `).join("")}
            </tbody>
            <tfoot>
              <tr style="background:#f1f5f9;font-weight:700">
                <td colspan="2" style="padding:8px;text-align:right">รวม:</td>
                <td style="padding:8px;text-align:right;color:#0284c7">${money(totalDebit)}</td>
                <td style="padding:8px;text-align:right;color:#dc2626">${money(totalCredit)}</td>
                <td colspan="2" style="padding:8px;text-align:center;font-size:12px">
                  ${balanced ? `<span style="color:#10b981">✅ เดบิต = เครดิต</span>` :
                    totalDebit === 0 ? `<span style="color:#94a3b8">รอใส่จำนวนเงิน</span>` :
                    `<span style="color:#ef4444">⚠️ ต่างกัน ${money(Math.abs(totalDebit - totalCredit))}</span>`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Save buttons -->
      <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end">
        <button id="jvCancelBtn" class="btn light">ยกเลิก</button>
        <button id="jvSaveDraftBtn" class="btn light" ${!balanced ? 'disabled' : ''} style="opacity:${balanced ? 1 : 0.5}">💾 บันทึกเป็นร่าง</button>
        <button id="jvSaveApprovedBtn" class="btn primary" ${!balanced ? 'disabled' : ''} style="opacity:${balanced ? 1 : 0.5}">✅ บันทึก + อนุมัติ</button>
      </div>
    </div>`;

  // ─── Bind events ─────────────────────────────────────────
  document.getElementById("jvBackBtn")?.addEventListener("click", () => { location.hash = "accounting_journals"; });
  document.getElementById("jvCancelBtn")?.addEventListener("click", () => {
    _lines = [{ account_code: "", debit: 0, credit: 0, description: "" }];
    location.hash = "accounting_journals";
  });

  document.getElementById("jvAddLineBtn")?.addEventListener("click", () => {
    _lines.push({ account_code: "", debit: 0, credit: 0, description: "" });
    renderJournalFormPage(ctx);
  });

  // Line edits
  container.querySelectorAll("[data-jv-line-acct]").forEach(el => el.addEventListener("change", (ev) => {
    const i = Number(ev.target.dataset.jvLineAcct);
    _lines[i].account_code = ev.target.value;
  }));
  container.querySelectorAll("[data-jv-line-debit]").forEach(el => el.addEventListener("input", (ev) => {
    const i = Number(ev.target.dataset.jvLineDebit);
    const v = Number(ev.target.value || 0);
    _lines[i].debit = v;
    if (v > 0) _lines[i].credit = 0;
    renderJournalFormPage(ctx);
  }));
  container.querySelectorAll("[data-jv-line-credit]").forEach(el => el.addEventListener("input", (ev) => {
    const i = Number(ev.target.dataset.jvLineCredit);
    const v = Number(ev.target.value || 0);
    _lines[i].credit = v;
    if (v > 0) _lines[i].debit = 0;
    renderJournalFormPage(ctx);
  }));
  container.querySelectorAll("[data-jv-line-desc]").forEach(el => el.addEventListener("input", (ev) => {
    const i = Number(ev.target.dataset.jvLineDesc);
    _lines[i].description = ev.target.value;
  }));
  container.querySelectorAll("[data-jv-line-del]").forEach(el => el.addEventListener("click", (ev) => {
    const i = Number(ev.target.dataset.jvLineDel);
    _lines.splice(i, 1);
    renderJournalFormPage(ctx);
  }));

  document.getElementById("jvSaveDraftBtn")?.addEventListener("click", () => _save(ctx, "draft"));
  document.getElementById("jvSaveApprovedBtn")?.addEventListener("click", () => _save(ctx, "approved"));
}


// ─── Save ────────────────────────────────────────────────
async function _save(ctx, status) {
  const { showToast } = ctx;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;

  const docDate = document.getElementById("jvDocDate")?.value;
  const docType = document.getElementById("jvDocType")?.value || "JV";
  const desc    = document.getElementById("jvDesc")?.value?.trim() || "";

  if (!docDate) return showToast("กรุณาเลือกวันที่");

  // Validate lines
  const validLines = _lines.filter(l => l.account_code && (l.debit > 0 || l.credit > 0));
  if (validLines.length < 2) return showToast("ต้องมีอย่างน้อย 2 บรรทัด (debit + credit)");

  const totalDebit  = validLines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = validLines.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return showToast(`เดบิต (${totalDebit}) ≠ เครดิต (${totalCredit}) — กรุณาตรวจสอบ`);
  }

  // Generate doc_no: JV2026MM####
  const yyyy = docDate.slice(0, 4);
  const mm   = docDate.slice(5, 7);
  const docNoPrefix = `${docType}${yyyy}${mm}`;
  let nextSeq = 1;
  try {
    const r = await fetch(`${cfg.url}/rest/v1/journal_entries?select=doc_no&doc_no=like.${docNoPrefix}*&order=doc_no.desc&limit=1`, {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token }
    });
    const arr = await r.json();
    if (arr[0]?.doc_no) {
      const tail = arr[0].doc_no.slice(docNoPrefix.length);
      nextSeq = (Number(tail) || 0) + 1;
    }
  } catch(e) { console.warn("[jv] seq lookup failed", e); }

  const docNo = `${docNoPrefix}${String(nextSeq).padStart(4, "0")}`;

  // POST entry
  let entryId = null;
  try {
    const r = await fetch(`${cfg.url}/rest/v1/journal_entries`, {
      method: "POST",
      headers: { "Content-Type":"application/json", "apikey": cfg.anonKey, "Authorization": "Bearer " + token, "Prefer":"return=representation" },
      body: JSON.stringify({
        doc_no: docNo,
        doc_type: docType,
        doc_date: docDate,
        description: desc,
        status,
        total_debit: totalDebit,
        total_credit: totalCredit,
        approved_at: status === "approved" ? new Date().toISOString() : null
      })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    const arr = await r.json();
    entryId = arr[0]?.id;
    if (!entryId) throw new Error("no id returned");
  } catch(err) {
    console.error("[jv save entry]", err);
    return showToast("บันทึก JV ไม่สำเร็จ: " + err.message);
  }

  // POST lines
  try {
    const lines = validLines.map((l, idx) => ({
      entry_id: entryId,
      line_no: idx + 1,
      account_code: l.account_code,
      debit:  Number(l.debit || 0),
      credit: Number(l.credit || 0),
      description: l.description || ""
    }));
    const r = await fetch(`${cfg.url}/rest/v1/journal_lines`, {
      method: "POST",
      headers: { "Content-Type":"application/json", "apikey": cfg.anonKey, "Authorization": "Bearer " + token, "Prefer":"return=minimal" },
      body: JSON.stringify(lines)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  } catch(err) {
    console.error("[jv save lines]", err);
    return showToast("บันทึก lines ไม่สำเร็จ: " + err.message + " (entry " + docNo + " ถูกสร้างแล้ว แต่ไม่มี lines)");
  }

  showToast(`✅ บันทึก ${docNo} สำเร็จ (${status === "approved" ? "อนุมัติ" : "ฉบับร่าง"})`);
  // Reset form
  _lines = [{ account_code: "", debit: 0, credit: 0, description: "" }];
  location.hash = "accounting_journals";
}
