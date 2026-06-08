// ═══════════════════════════════════════════════════════════
//  trial_balance.js — รายงานยอดทดลอง (Phase 88.2)
//
//  รายงานหัวใจของบัญชี — แสดง Dr/Cr ทุก account ในงวดที่เลือก
//  ใช้สำหรับส่งสำนักงานบัญชี + ตรวจ Dr = Cr (balance check)
//
//  Period support: month / quarter / year / custom range
//  Output: ตารางจัดกลุ่มตาม account type (asset/liability/equity/income/expense)
//          + Export Excel/CSV + พิมพ์
// ═══════════════════════════════════════════════════════════

import { exportToExcel, todaySuffix, todayBkk } from "../utils.js";

let _ctx = null;
let _periodType = "month";
let _periodValue = null;
let _customFrom = "";
let _customTo = "";
let _result = null;  // { range, accounts, totals }
let _loading = false;

const ACCOUNT_TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"];
const ACCOUNT_TYPE_META = {
  asset:     { label: "🟦 สินทรัพย์",      color: "#0284c7" },
  liability: { label: "🟥 หนี้สิน",         color: "#dc2626" },
  equity:    { label: "🟪 ส่วนของเจ้าของ",  color: "#7c3aed" },
  income:    { label: "🟩 รายได้",          color: "#059669" },
  expense:   { label: "🟧 ค่าใช้จ่าย",      color: "#ea580c" }
};

function money(n) { return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0)); }
function escHtml(s) { const d = document.createElement("div"); d.textContent = String(s ?? ""); return d.innerHTML; }
function pad2(n) { return String(n).padStart(2, "0"); }

// ─── Date range helpers ───
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
    return { from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(lastDay)}`, label: `เดือน ${pad2(m)}/${y}` };
  }
  if (_periodType === "quarter") {
    const v = _periodValue || defaultQuarter();
    const [yStr, qStr] = v.split("-Q");
    const y = Number(yStr), q = Number(qStr);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const lastDay = new Date(y, endMonth, 0).getDate();
    return {
      from: `${y}-${pad2(startMonth)}-01`,
      to:   `${y}-${pad2(endMonth)}-${pad2(lastDay)}`,
      label: `ไตรมาส ${q}/${y}`
    };
  }
  if (_periodType === "year") {
    const y = Number(_periodValue || defaultYear());
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `ปี ${y}` };
  }
  // custom
  const from = _customFrom || defaultMonth() + "-01";
  const to   = _customTo   || todayBkk();  // Phase 89.1: Bangkok time
  return { from, to, label: `${from} → ${to}` };
}

// ─── Data fetch ───
// Phase 92.49: exported for reuse by period_close.js (Dr=Cr readiness check) — no logic drift
export async function fetchTrialBalanceData(from, to) {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };

  // 1. Get all approved JV entries in date range
  const entriesUrl = `${cfg.url}/rest/v1/journal_entries?select=id&doc_date=gte.${from}&doc_date=lte.${to}&status=eq.approved`;
  const entriesRes = await fetch(entriesUrl, { headers });
  if (!entriesRes.ok) throw new Error("ไม่สามารถดึง JV: HTTP " + entriesRes.status);
  const entries = await entriesRes.json();
  if (entries.length === 0) return { lines: [], coa: [] };

  // 2. Get all lines for those entries (chunk by 200 ids if needed)
  const ids = entries.map(e => e.id);
  const linesAll = [];
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK).join(",");
    const linesUrl = `${cfg.url}/rest/v1/journal_lines?select=account_code,debit,credit&entry_id=in.(${chunk})`;
    const r = await fetch(linesUrl, { headers });
    if (!r.ok) throw new Error("ไม่สามารถดึง lines: HTTP " + r.status);
    const arr = await r.json();
    linesAll.push(...arr);
  }

  // 3. Get full chart of accounts
  const coaUrl = `${cfg.url}/rest/v1/chart_of_accounts?select=code,name,type,is_active&order=code.asc`;
  const coaRes = await fetch(coaUrl, { headers });
  if (!coaRes.ok) throw new Error("ไม่สามารถดึง COA: HTTP " + coaRes.status);
  const coa = await coaRes.json();

  return { lines: linesAll, coa };
}

export function aggregate(lines, coa) {
  const coaMap = {};
  coa.forEach(a => { coaMap[a.code] = a; });

  // Aggregate by account_code
  const agg = {};
  lines.forEach(l => {
    const code = l.account_code;
    if (!agg[code]) {
      agg[code] = {
        code,
        name: coaMap[code]?.name || "(ไม่พบชื่อ)",
        type: coaMap[code]?.type || "expense",
        debit: 0,
        credit: 0
      };
    }
    agg[code].debit  += Number(l.debit  || 0);
    agg[code].credit += Number(l.credit || 0);
  });

  // Group by type
  const byType = {};
  ACCOUNT_TYPE_ORDER.forEach(t => { byType[t] = []; });
  Object.values(agg).forEach(a => {
    if (!byType[a.type]) byType[a.type] = [];
    byType[a.type].push(a);
  });
  ACCOUNT_TYPE_ORDER.forEach(t => {
    byType[t].sort((a, b) => a.code.localeCompare(b.code));
  });

  // Totals
  const total = { debit: 0, credit: 0 };
  Object.values(agg).forEach(a => {
    total.debit  += a.debit;
    total.credit += a.credit;
  });

  return { byType, total, accounts: Object.values(agg).sort((a, b) => a.code.localeCompare(b.code)) };
}

// ─── Render ───
export function renderTrialBalancePage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-accounting_trial_balance");
  if (!container) return;

  if (!_periodValue) _periodValue = defaultMonth();

  container.innerHTML = `
    <div class="panel" style="max-width:1100px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <span style="font-size:30px">📊</span>
        <div class="rep-head-main">
          <h2 style="margin:0;font-size:20px;color:#0f172a">รายงานยอดทดลอง (Trial Balance)</h2>
          <div style="font-size:12px;color:#64748b">รายงานหัวใจของบัญชี — Dr/Cr ทุกบัญชีในงวด · ตรวจ balance Dr = Cr</div>
        </div>
        <div style="display:flex;gap:6px">
          <button id="tbExportBtn" class="btn light" style="font-size:13px">📤 Excel</button>
          <button id="tbPrintBtn" class="btn light" style="font-size:13px">🖨 พิมพ์</button>
        </div>
      </div>

      <!-- Period picker -->
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:14px">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
          ${["month", "quarter", "year", "custom"].map(t => `
            <button class="tb-tab" data-period="${t}"
              style="padding:8px 14px;border-radius:8px;border:2px solid ${_periodType === t ? "#3b82f6" : "#e2e8f0"};background:${_periodType === t ? "#eff6ff" : "#fff"};color:${_periodType === t ? "#1d4ed8" : "#475569"};font-weight:${_periodType === t ? 700 : 500};cursor:pointer;font-size:13px">
              ${t === "month" ? "📅 เดือน" : t === "quarter" ? "📆 ไตรมาส" : t === "year" ? "🗓️ ปี" : "✏️ กำหนดเอง"}
            </button>
          `).join("")}
        </div>
        <div id="tbPeriodInputs" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"></div>
      </div>

      <div id="tbResultPanel"></div>
    </div>
  `;

  // Wire tabs
  document.querySelectorAll(".tb-tab").forEach(b => {
    b.addEventListener("click", () => {
      _periodType = b.dataset.period;
      _periodValue = _periodType === "month" ? defaultMonth()
                   : _periodType === "quarter" ? defaultQuarter()
                   : _periodType === "year" ? defaultYear()
                   : null;
      renderTrialBalancePage(_ctx);
    });
  });

  document.getElementById("tbExportBtn")?.addEventListener("click", _onExport);
  document.getElementById("tbPrintBtn")?.addEventListener("click", _onPrint);

  _renderPeriodInputs();
  _loadAndRender();
}

function _renderPeriodInputs() {
  const c = document.getElementById("tbPeriodInputs");
  if (!c) return;
  if (_periodType === "month") {
    c.innerHTML = `
      <input type="month" id="tbMonth" value="${_periodValue}" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
      <button id="tbReloadBtn" class="btn primary" style="font-size:13px">📊 ดูรายงาน</button>
    `;
  } else if (_periodType === "quarter") {
    const [yr, qstr] = _periodValue.split("-Q");
    c.innerHTML = `
      <select id="tbQuarter" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px">
        ${[1,2,3,4].map(q => `<option value="${q}" ${q === Number(qstr) ? "selected" : ""}>ไตรมาส ${q}</option>`).join("")}
      </select>
      <input type="number" id="tbQYear" value="${yr}" min="2025" max="2030" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;width:100px" />
      <button id="tbReloadBtn" class="btn primary" style="font-size:13px">📊 ดูรายงาน</button>
    `;
  } else if (_periodType === "year") {
    c.innerHTML = `
      <input type="number" id="tbYear" value="${_periodValue}" min="2025" max="2030" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;width:120px" />
      <button id="tbReloadBtn" class="btn primary" style="font-size:13px">📊 ดูรายงาน</button>
    `;
  } else {
    if (!_customFrom) _customFrom = `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}-01`;
    if (!_customTo)   _customTo   = todayBkk();  // Phase 89.1
    c.innerHTML = `
      <input type="date" id="tbCustomFrom" value="${_customFrom}" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
      <span>→</span>
      <input type="date" id="tbCustomTo" value="${_customTo}" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
      <button id="tbReloadBtn" class="btn primary" style="font-size:13px">📊 ดูรายงาน</button>
    `;
  }
  document.getElementById("tbReloadBtn")?.addEventListener("click", () => {
    if (_periodType === "month")    _periodValue = document.getElementById("tbMonth")?.value || defaultMonth();
    if (_periodType === "quarter")  _periodValue = `${document.getElementById("tbQYear")?.value}-Q${document.getElementById("tbQuarter")?.value}`;
    if (_periodType === "year")     _periodValue = document.getElementById("tbYear")?.value || defaultYear();
    if (_periodType === "custom")   {
      _customFrom = document.getElementById("tbCustomFrom")?.value || "";
      _customTo   = document.getElementById("tbCustomTo")?.value   || "";
    }
    _loadAndRender();
  });
}

async function _loadAndRender() {
  const panel = document.getElementById("tbResultPanel");
  if (!panel) return;
  if (_loading) return;
  _loading = true;

  const { from, to, label } = getDateRange();
  panel.innerHTML = `<div style="padding:30px;text-align:center;color:#64748b">⏳ กำลังโหลดรายงาน...</div>`;

  try {
    const { lines, coa } = await fetchTrialBalanceData(from, to);
    const { byType, total, accounts } = aggregate(lines, coa);
    _result = { range: { from, to, label }, byType, total, accounts };
    _renderTable(panel);
  } catch (e) {
    console.error("[trial_balance] load failed:", e);
    panel.innerHTML = `<div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b">❌ ${escHtml(e.message || String(e))}</div>`;
  } finally {
    // eslint-disable-next-line require-atomic-updates -- G: _loading lock release (entry guard at trial_balance.js:259)
    _loading = false;
  }
}

function _renderTable(panel) {
  const { range, byType, total, accounts } = _result;
  const balanced = Math.abs(total.debit - total.credit) < 0.01;

  if (accounts.length === 0) {
    panel.innerHTML = `
      <div style="padding:30px;text-align:center;color:#64748b;background:#f8fafc;border-radius:10px">
        <div style="font-size:48px;margin-bottom:8px">📭</div>
        <div style="font-weight:700;font-size:16px;color:#0f172a;margin-bottom:4px">ไม่พบรายการในงวด</div>
        <div style="font-size:13px">${escHtml(range.label)} · ${range.from} → ${range.to}</div>
        <div style="font-size:12px;margin-top:6px;color:#94a3b8">ลองเปลี่ยนงวด หรือใช้ Backfill UI สร้าง JV ย้อนหลัง</div>
      </div>
    `;
    return;
  }

  const sectionsHtml = ACCOUNT_TYPE_ORDER.map(t => {
    const items = byType[t] || [];
    if (items.length === 0) return "";
    const meta = ACCOUNT_TYPE_META[t];
    const subDr = items.reduce((s, a) => s + a.debit,  0);
    const subCr = items.reduce((s, a) => s + a.credit, 0);
    return `
      <div style="margin-bottom:18px">
        <div style="background:${meta.color};color:#fff;padding:8px 12px;border-radius:8px 8px 0 0;font-weight:700;font-size:14px">${meta.label}</div>
        <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
          <thead>
            <tr style="background:#f8fafc;font-size:12px;color:#64748b">
              <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e2e8f0;width:80px">รหัส</th>
              <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e2e8f0">ชื่อบัญชี</th>
              <th style="text-align:right;padding:8px 12px;border-bottom:1px solid #e2e8f0;width:130px">เดบิต (Dr)</th>
              <th style="text-align:right;padding:8px 12px;border-bottom:1px solid #e2e8f0;width:130px">เครดิต (Cr)</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(a => `
              <tr>
                <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-family:monospace;color:#475569">${escHtml(a.code)}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">${escHtml(a.name)}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-family:monospace">${a.debit  > 0 ? money(a.debit)  : '<span style="color:#cbd5e1">-</span>'}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-family:monospace">${a.credit > 0 ? money(a.credit) : '<span style="color:#cbd5e1">-</span>'}</td>
              </tr>
            `).join("")}
            <tr style="background:#f8fafc;font-weight:700">
              <td colspan="2" style="padding:8px 12px;text-align:right;color:${meta.color}">รวม${meta.label.replace(/^[^\s]+\s/, "")}</td>
              <td style="padding:8px 12px;text-align:right;font-family:monospace;color:${meta.color}">${money(subDr)}</td>
              <td style="padding:8px 12px;text-align:right;font-family:monospace;color:${meta.color}">${money(subCr)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }).join("");

  panel.innerHTML = `
    <div id="tbPrintArea">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-weight:700;font-size:16px;color:#0f172a">${escHtml(range.label)}</div>
            <div style="font-size:12px;color:#64748b">${range.from} → ${range.to}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:#64748b">บัญชีที่มีการเคลื่อนไหว</div>
            <div style="font-size:18px;font-weight:800;color:#0f172a">${accounts.length} บัญชี</div>
          </div>
        </div>
      </div>

      ${sectionsHtml}

      <!-- Grand totals -->
      <div style="background:${balanced ? '#f0fdf4' : '#fef2f2'};border:2px solid ${balanced ? '#16a34a' : '#dc2626'};border-radius:10px;padding:14px;margin-top:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div style="font-weight:700;font-size:16px;color:${balanced ? '#15803d' : '#991b1b'}">
            ${balanced ? '✅' : '⚠️'} รวมทั้งสิ้น
          </div>
          <div style="display:flex;gap:24px;font-family:monospace">
            <div>
              <div style="font-size:11px;color:#64748b;text-align:right">รวม Dr</div>
              <div style="font-size:18px;font-weight:800;color:#0f172a;text-align:right">${money(total.debit)}</div>
            </div>
            <div>
              <div style="font-size:11px;color:#64748b;text-align:right">รวม Cr</div>
              <div style="font-size:18px;font-weight:800;color:#0f172a;text-align:right">${money(total.credit)}</div>
            </div>
            <div>
              <div style="font-size:11px;color:#64748b;text-align:right">ผลต่าง</div>
              <div style="font-size:18px;font-weight:800;color:${balanced ? '#15803d' : '#dc2626'};text-align:right">${money(total.debit - total.credit)}</div>
            </div>
          </div>
        </div>
        ${balanced
          ? `<div style="font-size:12px;color:#15803d;margin-top:8px">✓ Dr = Cr — ระบบ balance ครบถ้วน</div>`
          : `<div style="font-size:12px;color:#991b1b;margin-top:8px">⚠️ Dr ≠ Cr — ตรวจ JV ที่อาจมี line ค้าง (admin manually delete entry แต่ไม่ลบ lines)</div>`
        }
      </div>
    </div>
  `;
}

// ─── Export Excel ───
function _onExport() {
  if (!_result) {
    _ctx?.showToast?.("ยังไม่มีข้อมูล — กดดูรายงานก่อน", "error");
    return;
  }
  const { range, accounts: _accounts, total } = _result;
  const rows = [];
  ACCOUNT_TYPE_ORDER.forEach(t => {
    const items = (_result.byType[t] || []);
    items.forEach(a => {
      rows.push({
        "รหัส":     a.code,
        "ชื่อบัญชี":  a.name,
        "ประเภท":    ACCOUNT_TYPE_META[t]?.label.replace(/^[^\s]+\s/, "") || t,
        "เดบิต":     Number(a.debit  || 0),
        "เครดิต":    Number(a.credit || 0)
      });
    });
  });
  // Total row
  rows.push({
    "รหัส":     "",
    "ชื่อบัญชี":  "รวมทั้งสิ้น",
    "ประเภท":    "",
    "เดบิต":     Number(total.debit  || 0),
    "เครดิต":    Number(total.credit || 0)
  });
  const sheet = `TB_${range.from}_${range.to}`;
  const filename = `trial_balance_${range.from}_${range.to}_${todaySuffix()}.xlsx`;
  exportToExcel(filename, sheet, rows);
  _ctx?.showToast?.("ดาวน์โหลด Excel แล้ว ✅");
}

// ─── Print ───
function _onPrint() {
  if (!_result) {
    _ctx?.showToast?.("ยังไม่มีข้อมูล — กดดูรายงานก่อน", "error");
    return;
  }
  const printable = document.getElementById("tbPrintArea");
  if (!printable) return;

  const w = window.open("", "_blank", "width=1000,height=700");
  if (!w) { _ctx?.showToast?.("Browser blocked popup — อนุญาต popup ก่อน", "error"); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Trial Balance ${_result.range.label}</title>
    <style>
      body { font-family: 'Sarabun', sans-serif; padding: 20px; color: #0f172a; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      h2 { font-size: 14px; margin: 14px 0 6px; padding: 6px 10px; color: #fff; border-radius: 4px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 12px; }
      th, td { padding: 5px 8px; border: 1px solid #ddd; }
      th { background: #f1f5f9; }
      .right { text-align: right; font-family: 'Roboto Mono', monospace; }
      .total-row { font-weight: 700; background: #f8fafc; }
      .grand-total { background: #dcfce7; border: 2px solid #16a34a; padding: 10px; margin-top: 14px; border-radius: 6px; }
      @media print { body { padding: 10mm; } button { display: none; } }
    </style></head><body>
    <h1>📊 รายงานยอดทดลอง — ${escHtml(_result.range.label)}</h1>
    <div style="font-size:11px;color:#64748b">${_result.range.from} → ${_result.range.to} · ${_result.accounts.length} บัญชี · พิมพ์เมื่อ ${new Date().toLocaleString("th-TH")}</div>
    ${printable.innerHTML.replace(/<button[\s\S]*?<\/button>/g, "")}
    <script>setTimeout(() => window.print(), 250)</script>
    </body></html>`);
  w.document.close();
}
