// ═══════════════════════════════════════════════════════════
//  export_bundle.js — Export bundle ส่งสำนักงานบัญชี (Phase 88.5)
//
//  ดาวน์โหลด Excel 1 ไฟล์ มี 4 sheets:
//    1. Trial Balance (รายงานยอดทดลอง)
//    2. P&L (งบกำไรขาดทุน)
//    3. Balance Sheet (งบดุล)
//    4. Journal (ทุก JV ในงวด พร้อม lines)
//
//  สำนักงานบัญชีนำไปบันทึกในระบบของเขาได้ทันที (รูปแบบ standard)
// ═══════════════════════════════════════════════════════════

import { todaySuffix, todayBkk } from "../utils.js";

// ★ Phase 413: เริ่มบัญชีจริง 1 ก.ค. 2569 — single source of truth ที่ effective_date.js
import { ACCOUNTING_EFFECTIVE_DATE } from "./effective_date.js";
import { fetchAllRowsRaw } from "../fetch_paginated.js";

let _ctx = null;
let _periodType = "month";
let _periodValue = null;
let _customFrom = "";
let _customTo = "";
let _generating = false;

function money(n) { return Number(Number(n || 0).toFixed(2)); }
function escHtml(s) { const d = document.createElement("div"); d.textContent = String(s ?? ""); return d.innerHTML; }
function pad2(n) { return String(n).padStart(2, "0"); }

function defaultMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function defaultYear() { return String(new Date().getFullYear()); }
function defaultQuarter() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

function getDateRange() {
  if (_periodType === "month") {
    const v = _periodValue || defaultMonth();
    const [y, m] = v.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return { from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(lastDay)}`, label: `${pad2(m)}_${y}` };
  }
  if (_periodType === "quarter") {
    const v = _periodValue || defaultQuarter();
    const [yStr, qStr] = v.split("-Q");
    const y = Number(yStr), q = Number(qStr);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const lastDay = new Date(y, endMonth, 0).getDate();
    return { from: `${y}-${pad2(startMonth)}-01`, to: `${y}-${pad2(endMonth)}-${pad2(lastDay)}`, label: `Q${q}_${y}` };
  }
  if (_periodType === "year") {
    const y = Number(_periodValue || defaultYear());
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Year_${y}` };
  }
  const from = _customFrom || defaultMonth() + "-01";
  const to   = _customTo   || todayBkk();  // Phase 89.1: Bangkok time
  return { from, to, label: `${from}_${to}` };
}

// ─── Fetch all data once ───
async function fetchAll(from, to) {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };

  // ★ Phase 496 (audit #2): paginate ทุก fetch (เดิมไม่ paginate → 1000-row cap → ชุดส่งสรรพากรขาดข้อมูลเงียบ ๆ เมื่อ JV>1000)
  // 1. Period entries (for TB / PL)
  const periodEntries = await fetchAllRowsRaw(
    (off, lim) => `${cfg.url}/rest/v1/journal_entries?select=*&doc_date=gte.${from}&doc_date=lte.${to}&status=eq.approved&order=doc_date.asc,id.asc&limit=${lim}&offset=${off}`,
    headers
  );

  // 2. Cumulative entries since effective (for BS)
  const cumEntries = await fetchAllRowsRaw(
    (off, lim) => `${cfg.url}/rest/v1/journal_entries?select=id&doc_date=gte.${ACCOUNTING_EFFECTIVE_DATE}&doc_date=lte.${to}&status=eq.approved&order=id.asc&limit=${lim}&offset=${off}`,
    headers
  );

  // 3. Lines for both
  const allIds = [...new Set([...periodEntries.map(e => e.id), ...cumEntries.map(e => e.id)])];
  const linesByEntry = {};
  const CHUNK = 200;
  for (let i = 0; i < allIds.length; i += CHUNK) {
    const chunk = allIds.slice(i, i + CHUNK).join(",");
    const arr = await fetchAllRowsRaw(
      (off, lim) => `${cfg.url}/rest/v1/journal_lines?select=*&entry_id=in.(${chunk})&order=entry_id.asc,line_no.asc&limit=${lim}&offset=${off}`,
      headers
    );
    arr.forEach(l => {
      if (!linesByEntry[l.entry_id]) linesByEntry[l.entry_id] = [];
      linesByEntry[l.entry_id].push(l);
    });
  }

  // 4. Chart of Accounts
  const coa = await (await fetch(`${cfg.url}/rest/v1/chart_of_accounts?select=*&order=code.asc`, { headers })).json();

  return { periodEntries, cumEntries, linesByEntry, coa };
}

// ─── Build sheet rows ───
function buildTBRows(periodEntries, linesByEntry, coa) {
  const coaMap = {};
  coa.forEach(a => { coaMap[a.code] = a; });

  const agg = {};
  periodEntries.forEach(e => {
    (linesByEntry[e.id] || []).forEach(l => {
      const c = l.account_code;
      if (!agg[c]) agg[c] = { code: c, name: coaMap[c]?.name || "?", type: coaMap[c]?.type || "?", debit: 0, credit: 0 };
      agg[c].debit  += Number(l.debit  || 0);
      agg[c].credit += Number(l.credit || 0);
    });
  });

  const TYPE_LABEL = { asset: "สินทรัพย์", liability: "หนี้สิน", equity: "ส่วนของเจ้าของ", income: "รายได้", expense: "ค่าใช้จ่าย" };
  const rows = Object.values(agg).sort((a, b) => a.code.localeCompare(b.code)).map(a => ({
    "รหัส": a.code,
    "ชื่อบัญชี": a.name,
    "ประเภท": TYPE_LABEL[a.type] || a.type,
    "เดบิต": money(a.debit),
    "เครดิต": money(a.credit)
  }));
  // Total row
  const totalDr = Object.values(agg).reduce((s, a) => s + a.debit, 0);
  const totalCr = Object.values(agg).reduce((s, a) => s + a.credit, 0);
  rows.push({ "รหัส": "", "ชื่อบัญชี": "รวมทั้งสิ้น", "ประเภท": "", "เดบิต": money(totalDr), "เครดิต": money(totalCr) });
  return rows;
}

function buildPLRows(periodEntries, linesByEntry, coa) {
  const coaMap = {};
  coa.forEach(a => { coaMap[a.code] = a; });

  const agg = {};
  periodEntries.forEach(e => {
    (linesByEntry[e.id] || []).forEach(l => {
      const c = l.account_code;
      if (!agg[c]) agg[c] = { code: c, name: coaMap[c]?.name || "?", type: coaMap[c]?.type || "?", debit: 0, credit: 0 };
      agg[c].debit  += Number(l.debit  || 0);
      agg[c].credit += Number(l.credit || 0);
    });
  });

  const rows = [];
  let totalRev = 0, totalExp = 0;

  rows.push({ "หมวด": "รายได้", "รหัส": "", "ชื่อบัญชี": "", "จำนวนเงิน": "" });
  Object.values(agg).filter(a => a.type === "income").sort((a, b) => a.code.localeCompare(b.code)).forEach(a => {
    const amt = a.credit - a.debit;
    totalRev += amt;
    rows.push({ "หมวด": "รายได้", "รหัส": a.code, "ชื่อบัญชี": a.name, "จำนวนเงิน": money(amt) });
  });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "รวมรายได้", "จำนวนเงิน": money(totalRev) });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "", "จำนวนเงิน": "" });

  rows.push({ "หมวด": "ค่าใช้จ่าย", "รหัส": "", "ชื่อบัญชี": "", "จำนวนเงิน": "" });
  Object.values(agg).filter(a => a.type === "expense").sort((a, b) => a.code.localeCompare(b.code)).forEach(a => {
    const amt = a.debit - a.credit;
    totalExp += amt;
    rows.push({ "หมวด": "ค่าใช้จ่าย", "รหัส": a.code, "ชื่อบัญชี": a.name, "จำนวนเงิน": money(amt) });
  });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "รวมค่าใช้จ่าย", "จำนวนเงิน": money(totalExp) });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "", "จำนวนเงิน": "" });

  rows.push({ "หมวด": (totalRev - totalExp) >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ", "รหัส": "", "ชื่อบัญชี": "", "จำนวนเงิน": money(totalRev - totalExp) });
  return rows;
}

function buildBSRows(cumEntries, linesByEntry, coa) {
  const coaMap = {};
  coa.forEach(a => { coaMap[a.code] = a; });

  const agg = {};
  cumEntries.forEach(e => {
    (linesByEntry[e.id] || []).forEach(l => {
      const c = l.account_code;
      if (!agg[c]) agg[c] = { code: c, name: coaMap[c]?.name || "?", type: coaMap[c]?.type || "?", debit: 0, credit: 0 };
      agg[c].debit  += Number(l.debit  || 0);
      agg[c].credit += Number(l.credit || 0);
    });
  });

  const rows = [];
  let totalIncome = 0, totalExpense = 0;
  let totalA = 0, totalL = 0, totalE = 0;

  Object.values(agg).forEach(a => {
    if      (a.type === "income")  totalIncome  += a.credit - a.debit;
    else if (a.type === "expense") totalExpense += a.debit - a.credit;
  });
  const retainedEarnings = totalIncome - totalExpense;

  rows.push({ "หมวด": "สินทรัพย์", "รหัส": "", "ชื่อบัญชี": "", "ยอด": "" });
  Object.values(agg).filter(a => a.type === "asset").sort((a, b) => a.code.localeCompare(b.code)).forEach(a => {
    const bal = a.debit - a.credit;
    if (Math.abs(bal) < 0.005) return;
    totalA += bal;
    rows.push({ "หมวด": "สินทรัพย์", "รหัส": a.code, "ชื่อบัญชี": a.name, "ยอด": money(bal) });
  });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "รวมสินทรัพย์", "ยอด": money(totalA) });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "", "ยอด": "" });

  rows.push({ "หมวด": "หนี้สิน", "รหัส": "", "ชื่อบัญชี": "", "ยอด": "" });
  Object.values(agg).filter(a => a.type === "liability").sort((a, b) => a.code.localeCompare(b.code)).forEach(a => {
    const bal = a.credit - a.debit;
    if (Math.abs(bal) < 0.005) return;
    totalL += bal;
    rows.push({ "หมวด": "หนี้สิน", "รหัส": a.code, "ชื่อบัญชี": a.name, "ยอด": money(bal) });
  });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "รวมหนี้สิน", "ยอด": money(totalL) });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "", "ยอด": "" });

  rows.push({ "หมวด": "ส่วนของเจ้าของ", "รหัส": "", "ชื่อบัญชี": "", "ยอด": "" });
  Object.values(agg).filter(a => a.type === "equity").sort((a, b) => a.code.localeCompare(b.code)).forEach(a => {
    const bal = a.credit - a.debit;
    if (Math.abs(bal) < 0.005) return;
    totalE += bal;
    rows.push({ "หมวด": "ส่วนของเจ้าของ", "รหัส": a.code, "ชื่อบัญชี": a.name, "ยอด": money(bal) });
  });
  // Retained Earnings
  rows.push({ "หมวด": "ส่วนของเจ้าของ", "รหัส": "3900", "ชื่อบัญชี": retainedEarnings >= 0 ? "กำไรสะสม" : "ขาดทุนสะสม", "ยอด": money(retainedEarnings) });
  totalE += retainedEarnings;
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "รวมส่วนของเจ้าของ", "ยอด": money(totalE) });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "", "ยอด": "" });

  rows.push({ "หมวด": "Total Assets", "รหัส": "", "ชื่อบัญชี": "", "ยอด": money(totalA) });
  rows.push({ "หมวด": "Total L+E",    "รหัส": "", "ชื่อบัญชี": "", "ยอด": money(totalL + totalE) });
  rows.push({ "หมวด": "Difference",   "รหัส": "", "ชื่อบัญชี": "Should be 0", "ยอด": money(totalA - totalL - totalE) });
  return rows;
}

function buildJournalRows(periodEntries, linesByEntry, coa) {
  const coaMap = {};
  coa.forEach(a => { coaMap[a.code] = a; });

  const rows = [];
  periodEntries.forEach(e => {
    const lines = linesByEntry[e.id] || [];
    if (lines.length === 0) {
      rows.push({
        "วันที่": e.doc_date, "เลขที่": e.doc_no, "ประเภท": e.doc_type, "คำอธิบาย": e.description || "",
        "บรรทัด": "", "รหัสบัญชี": "", "ชื่อบัญชี": "", "เดบิต": "", "เครดิต": "",
        "สถานะ": e.status, "ที่มา": e.source_table || ""
      });
      return;
    }
    lines.forEach((l, idx) => {
      rows.push({
        "วันที่": idx === 0 ? e.doc_date : "",
        "เลขที่": idx === 0 ? e.doc_no : "",
        "ประเภท": idx === 0 ? e.doc_type : "",
        "คำอธิบาย": idx === 0 ? (e.description || "") : "",
        "บรรทัด": l.line_no,
        "รหัสบัญชี": l.account_code,
        "ชื่อบัญชี": coaMap[l.account_code]?.name || "?",
        "เดบิต": money(l.debit),
        "เครดิต": money(l.credit),
        "สถานะ": idx === 0 ? e.status : "",
        "ที่มา": idx === 0 ? (e.source_table || "") : ""
      });
    });
  });
  return rows;
}

// ─── Render page ───
export function renderExportBundlePage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-accounting_export_bundle");
  if (!container) return;

  if (!_periodValue) _periodValue = defaultMonth();

  container.innerHTML = `
    <div class="panel" style="max-width:880px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <span style="font-size:30px">📦</span>
        <div class="rep-head-main">
          <h2 style="margin:0;font-size:20px;color:#0f172a">Export ชุดรายงานบัญชี</h2>
          <div style="font-size:12px;color:#64748b">Excel 1 ไฟล์ — 4 sheets (TB + P&L + BS + Journal) ส่งสำนักงานบัญชีได้ทันที</div>
        </div>
      </div>

      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;color:#1e3a8a;line-height:1.7">
        <b>📋 สิ่งที่จะอยู่ในไฟล์:</b><br>
        <b>Sheet 1 — TB:</b> รายงานยอดทดลอง (Dr/Cr ทุกบัญชีในงวด)<br>
        <b>Sheet 2 — PL:</b> งบกำไรขาดทุน (รายได้ - ค่าใช้จ่าย = กำไรสุทธิ)<br>
        <b>Sheet 3 — BS:</b> งบดุล ณ end-date (สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ)<br>
        <b>Sheet 4 — Journal:</b> ทุก JV ในงวด พร้อม lines (Dr/Cr)
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:14px">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
          ${["month", "quarter", "year", "custom"].map(t => `
            <button class="eb-tab" data-period="${t}"
              style="padding:8px 14px;border-radius:8px;border:2px solid ${_periodType === t ? "#3b82f6" : "#e2e8f0"};background:${_periodType === t ? "#eff6ff" : "#fff"};color:${_periodType === t ? "#1d4ed8" : "#475569"};font-weight:${_periodType === t ? 700 : 500};cursor:pointer;font-size:13px">
              ${t === "month" ? "📅 เดือน" : t === "quarter" ? "📆 ไตรมาส" : t === "year" ? "🗓️ ปี" : "✏️ กำหนดเอง"}
            </button>
          `).join("")}
        </div>
        <div id="ebPeriodInputs" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"></div>
      </div>

      <button id="ebDownloadBtn" class="btn primary" style="font-size:15px;padding:14px 24px;width:100%">
        📦 ดาวน์โหลด Excel ชุดรายงาน (4 sheets)
      </button>

      <div id="ebStatus" style="margin-top:14px"></div>
    </div>
  `;

  document.querySelectorAll(".eb-tab").forEach(b => {
    b.addEventListener("click", () => {
      _periodType = b.dataset.period;
      _periodValue = _periodType === "month"   ? defaultMonth()
                   : _periodType === "quarter" ? defaultQuarter()
                   : _periodType === "year"    ? defaultYear()
                   : null;
      renderExportBundlePage(_ctx);
    });
  });

  document.getElementById("ebDownloadBtn")?.addEventListener("click", _onDownload);
  _renderPeriodInputs();
}

function _renderPeriodInputs() {
  const c = document.getElementById("ebPeriodInputs");
  if (!c) return;
  if (_periodType === "month") {
    c.innerHTML = `<input type="month" id="ebMonth" value="${_periodValue}" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />`;
  } else if (_periodType === "quarter") {
    const [yr, qstr] = _periodValue.split("-Q");
    c.innerHTML = `
      <select id="ebQuarter" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px">
        ${[1,2,3,4].map(q => `<option value="${q}" ${q === Number(qstr) ? "selected" : ""}>ไตรมาส ${q}</option>`).join("")}
      </select>
      <input type="number" id="ebQYear" value="${yr}" min="2025" max="2030" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;width:100px" />
    `;
  } else if (_periodType === "year") {
    c.innerHTML = `<input type="number" id="ebYear" value="${_periodValue}" min="2025" max="2030" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;width:120px" />`;
  } else {
    if (!_customFrom) _customFrom = `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}-01`;
    if (!_customTo)   _customTo   = todayBkk();  // Phase 89.1
    c.innerHTML = `
      <input type="date" id="ebCustomFrom" value="${_customFrom}" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
      <span>→</span>
      <input type="date" id="ebCustomTo" value="${_customTo}" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
    `;
  }
}

async function _onDownload() {
  if (_generating) return;
  if (typeof window.XLSX === "undefined") {
    document.getElementById("ebStatus").innerHTML = `<div style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b">❌ XLSX library ยังโหลดไม่เสร็จ — รอสักครู่แล้วลองใหม่</div>`;
    return;
  }

  // Sync inputs
  if (_periodType === "month")    _periodValue = document.getElementById("ebMonth")?.value || defaultMonth();
  if (_periodType === "quarter")  _periodValue = `${document.getElementById("ebQYear")?.value}-Q${document.getElementById("ebQuarter")?.value}`;
  if (_periodType === "year")     _periodValue = document.getElementById("ebYear")?.value || defaultYear();
  if (_periodType === "custom") {
    _customFrom = document.getElementById("ebCustomFrom")?.value || "";
    _customTo   = document.getElementById("ebCustomTo")?.value   || "";
  }

  _generating = true;
  const btn = document.getElementById("ebDownloadBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ กำลังสร้างไฟล์..."; }
  const setStatus = (html) => { const el = document.getElementById("ebStatus"); if (el) el.innerHTML = html; };

  try {
    const { from, to, label } = getDateRange();
    setStatus(`<div style="padding:12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;color:#1e40af">📥 กำลังดึงข้อมูลจาก Supabase... (${from} → ${to})</div>`);

    const { periodEntries, cumEntries, linesByEntry, coa } = await fetchAll(from, to);

    setStatus(`<div style="padding:12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;color:#1e40af">⚙️ กำลัง aggregate (${periodEntries.length} JV ในงวด · ${cumEntries.length} JV cumulative)</div>`);

    const tbRows      = buildTBRows(periodEntries, linesByEntry, coa);
    const plRows      = buildPLRows(periodEntries, linesByEntry, coa);
    const bsRows      = buildBSRows(cumEntries, linesByEntry, coa);
    const journalRows = buildJournalRows(periodEntries, linesByEntry, coa);

    setStatus(`<div style="padding:12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;color:#1e40af">📦 กำลังสร้างไฟล์ Excel...</div>`);

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(tbRows),      "Trial Balance");
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(plRows),      "P&L");
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(bsRows),      "Balance Sheet");
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(journalRows), "Journal");

    const filename = `accounting_bundle_${label}_${todaySuffix()}.xlsx`;
    window.XLSX.writeFile(wb, filename);

    setStatus(`
      <div style="padding:14px;background:#f0fdf4;border:2px solid #16a34a;border-radius:10px;color:#166534">
        <div style="font-weight:700;font-size:15px;margin-bottom:6px">✅ ดาวน์โหลดสำเร็จ!</div>
        <div style="font-size:13px;line-height:1.7">
          ไฟล์: <code>${escHtml(filename)}</code><br>
          ${periodEntries.length} JV ในงวด · ${cumEntries.length} JV cumulative · ${journalRows.length} บรรทัดใน Journal sheet<br>
          → ส่งสำนักงานบัญชีทาง email หรือ Line ได้เลย
        </div>
      </div>
    `);
    _ctx?.showToast?.("Export สำเร็จ ✅");

  } catch(e) {
    console.error("[export_bundle] failed:", e);
    setStatus(`<div style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b">❌ ${escHtml(e.message || String(e))}</div>`);
  } finally {
    // eslint-disable-next-line require-atomic-updates -- G: _generating lock release (entry guard at export_bundle.js:352)
    _generating = false;
    if (btn) { btn.disabled = false; btn.textContent = "📦 ดาวน์โหลด Excel ชุดรายงาน (4 sheets)"; }
  }
}
