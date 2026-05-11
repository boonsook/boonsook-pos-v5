// ═══════════════════════════════════════════════════════════
//  profit_loss.js — งบกำไรขาดทุน (Phase 88.3)
//
//  P&L statement — รายได้ - ค่าใช้จ่าย = กำไร/ขาดทุนสุทธิ
//  ใช้สำหรับส่งสำนักงานบัญชี + ดูผลประกอบการรายเดือน
//
//  Period support: month / quarter / year / custom range
//  Output: ตาราง 2 sections (รายได้ / ค่าใช้จ่าย) + กำไรสุทธิ
//          + Comparative mode (เทียบกับงวดก่อน) — Phase ต่อ
// ═══════════════════════════════════════════════════════════

import { exportToExcel, todaySuffix, todayBkk, dateBkk } from "../utils.js";

let _ctx = null;
let _periodType = "month";
let _periodValue = null;
let _customFrom = "";
let _customTo = "";
let _result = null;
let _loading = false;
// ★ Phase 88.9: comparative mode
let _compareMode = false;
let _resultPrev = null;

function money(n) { return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0)); }
function moneyColor(n) {
  const v = Number(n || 0);
  if (v > 0) return "#15803d";
  if (v < 0) return "#dc2626";
  return "#64748b";
}
function escHtml(s) { const d = document.createElement("div"); d.textContent = String(s ?? ""); return d.innerHTML; }
function pad2(n) { return String(n).padStart(2, "0"); }

// ─── Date range helpers (เหมือน trial_balance.js) ───
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
    return { from: `${y}-${pad2(startMonth)}-01`, to: `${y}-${pad2(endMonth)}-${pad2(lastDay)}`, label: `ไตรมาส ${q}/${y}` };
  }
  if (_periodType === "year") {
    const y = Number(_periodValue || defaultYear());
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `ปี ${y}` };
  }
  const from = _customFrom || defaultMonth() + "-01";
  // Phase 89.1: Bangkok time default
  const to   = _customTo   || todayBkk();
  return { from, to, label: `${from} → ${to}` };
}

// ★ Phase 88.9: คำนวณงวดก่อน (สำหรับ comparative mode)
function getPreviousRange() {
  if (_periodType === "month") {
    const v = _periodValue || defaultMonth();
    const [y, m] = v.split("-").map(Number);
    const prevDate = new Date(y, m - 2, 1);  // m-2 เพราะ Date month = 0-based
    const prevY = prevDate.getFullYear();
    const prevM = prevDate.getMonth() + 1;
    const lastDay = new Date(prevY, prevM, 0).getDate();
    return { from: `${prevY}-${pad2(prevM)}-01`, to: `${prevY}-${pad2(prevM)}-${pad2(lastDay)}`, label: `เดือน ${pad2(prevM)}/${prevY}` };
  }
  if (_periodType === "quarter") {
    const v = _periodValue || defaultQuarter();
    const [yStr, qStr] = v.split("-Q");
    let prevY = Number(yStr), prevQ = Number(qStr) - 1;
    if (prevQ < 1) { prevQ = 4; prevY -= 1; }
    const startMonth = (prevQ - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const lastDay = new Date(prevY, endMonth, 0).getDate();
    return { from: `${prevY}-${pad2(startMonth)}-01`, to: `${prevY}-${pad2(endMonth)}-${pad2(lastDay)}`, label: `ไตรมาส ${prevQ}/${prevY}` };
  }
  if (_periodType === "year") {
    const y = Number(_periodValue || defaultYear()) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `ปี ${y}` };
  }
  // custom — ขนาดเท่ากันก่อนช่วงนี้
  const cur = getDateRange();
  const fromDate = new Date(cur.from);
  const toDate = new Date(cur.to);
  const days = Math.round((toDate - fromDate) / 86400000);
  const prevTo = new Date(fromDate);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - days);
  // Phase 89.1: Bangkok time
  const pf = dateBkk(prevFrom), pt = dateBkk(prevTo);
  return { from: pf, to: pt, label: `${pf} → ${pt}` };
}

// ─── Data fetch (เหมือน trial_balance.js) ───
async function fetchData(from, to) {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };

  const entriesUrl = `${cfg.url}/rest/v1/journal_entries?select=id&doc_date=gte.${from}&doc_date=lte.${to}&status=eq.approved`;
  const entriesRes = await fetch(entriesUrl, { headers });
  if (!entriesRes.ok) throw new Error("ไม่สามารถดึง JV: HTTP " + entriesRes.status);
  const entries = await entriesRes.json();
  if (entries.length === 0) return { lines: [], coa: [] };

  const ids = entries.map(e => e.id);
  const linesAll = [];
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK).join(",");
    const r = await fetch(`${cfg.url}/rest/v1/journal_lines?select=account_code,debit,credit&entry_id=in.(${chunk})`, { headers });
    if (!r.ok) throw new Error("ไม่สามารถดึง lines: HTTP " + r.status);
    linesAll.push(...await r.json());
  }

  const coaRes = await fetch(`${cfg.url}/rest/v1/chart_of_accounts?select=code,name,type&order=code.asc`, { headers });
  if (!coaRes.ok) throw new Error("ไม่สามารถดึง COA: HTTP " + coaRes.status);
  const coa = await coaRes.json();

  return { lines: linesAll, coa };
}

function aggregate(lines, coa) {
  const coaMap = {};
  coa.forEach(a => { coaMap[a.code] = a; });

  // Aggregate lines per account_code
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

  // For income (4xxx): normal balance = Cr → amount = credit - debit
  // For expense (5xxx): normal balance = Dr → amount = debit - credit
  const revenues = [], expenses = [];
  Object.values(agg).forEach(a => {
    if (a.type === "income") {
      a.amount = a.credit - a.debit;
      revenues.push(a);
    } else if (a.type === "expense") {
      a.amount = a.debit - a.credit;
      expenses.push(a);
    }
  });
  revenues.sort((a, b) => a.code.localeCompare(b.code));
  expenses.sort((a, b) => a.code.localeCompare(b.code));

  const totalRevenue = revenues.reduce((s, a) => s + a.amount, 0);
  const totalExpense = expenses.reduce((s, a) => s + a.amount, 0);
  const netIncome    = totalRevenue - totalExpense;

  return { revenues, expenses, totalRevenue, totalExpense, netIncome };
}

// ─── Render ───
export function renderProfitLossPage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-accounting_profit_loss");
  if (!container) return;

  if (!_periodValue) _periodValue = defaultMonth();

  container.innerHTML = `
    <div class="panel" style="max-width:900px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <span style="font-size:30px">📈</span>
        <div style="flex:1;min-width:200px">
          <h2 style="margin:0;font-size:20px;color:#0f172a">งบกำไรขาดทุน (Profit &amp; Loss)</h2>
          <div style="font-size:12px;color:#64748b">รายได้ - ค่าใช้จ่าย = กำไร/ขาดทุนสุทธิ · ส่งสำนักงานบัญชีได้</div>
        </div>
        <div style="display:flex;gap:6px">
          <button id="plExportBtn" class="btn light" style="font-size:13px">📤 Excel</button>
          <button id="plPrintBtn" class="btn light" style="font-size:13px">🖨 พิมพ์</button>
        </div>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:14px">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
          ${["month", "quarter", "year", "custom"].map(t => `
            <button class="pl-tab" data-period="${t}"
              style="padding:8px 14px;border-radius:8px;border:2px solid ${_periodType === t ? "#3b82f6" : "#e2e8f0"};background:${_periodType === t ? "#eff6ff" : "#fff"};color:${_periodType === t ? "#1d4ed8" : "#475569"};font-weight:${_periodType === t ? 700 : 500};cursor:pointer;font-size:13px">
              ${t === "month" ? "📅 เดือน" : t === "quarter" ? "📆 ไตรมาส" : t === "year" ? "🗓️ ปี" : "✏️ กำหนดเอง"}
            </button>
          `).join("")}
        </div>
        <div id="plPeriodInputs" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"></div>
        <!-- Phase 88.9: Compare toggle -->
        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #e2e8f0;display:flex;align-items:center;gap:8px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:#475569;font-weight:600">
            <input type="checkbox" id="plCompareToggle" ${_compareMode ? "checked" : ""} style="width:16px;height:16px;cursor:pointer" />
            📊 เทียบกับงวดก่อน
          </label>
          <span style="font-size:11px;color:#94a3b8">— ดูเทรนด์รายได้/ค่าใช้จ่ายเทียบกับเดือน/ไตรมาส/ปีก่อน</span>
        </div>
      </div>

      <div id="plResultPanel"></div>
    </div>
  `;

  document.querySelectorAll(".pl-tab").forEach(b => {
    b.addEventListener("click", () => {
      _periodType = b.dataset.period;
      _periodValue = _periodType === "month"   ? defaultMonth()
                   : _periodType === "quarter" ? defaultQuarter()
                   : _periodType === "year"    ? defaultYear()
                   : null;
      renderProfitLossPage(_ctx);
    });
  });

  document.getElementById("plExportBtn")?.addEventListener("click", _onExport);
  document.getElementById("plPrintBtn")?.addEventListener("click", _onPrint);

  // ★ Phase 88.9: Compare toggle
  document.getElementById("plCompareToggle")?.addEventListener("change", (ev) => {
    _compareMode = ev.target.checked;
    _loadAndRender();
  });

  _renderPeriodInputs();
  _loadAndRender();
}

function _renderPeriodInputs() {
  const c = document.getElementById("plPeriodInputs");
  if (!c) return;
  if (_periodType === "month") {
    c.innerHTML = `
      <input type="month" id="plMonth" value="${_periodValue}" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
      <button id="plReloadBtn" class="btn primary" style="font-size:13px">📈 ดูรายงาน</button>
    `;
  } else if (_periodType === "quarter") {
    const [yr, qstr] = _periodValue.split("-Q");
    c.innerHTML = `
      <select id="plQuarter" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px">
        ${[1,2,3,4].map(q => `<option value="${q}" ${q === Number(qstr) ? "selected" : ""}>ไตรมาส ${q}</option>`).join("")}
      </select>
      <input type="number" id="plQYear" value="${yr}" min="2025" max="2030" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;width:100px" />
      <button id="plReloadBtn" class="btn primary" style="font-size:13px">📈 ดูรายงาน</button>
    `;
  } else if (_periodType === "year") {
    c.innerHTML = `
      <input type="number" id="plYear" value="${_periodValue}" min="2025" max="2030" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;width:120px" />
      <button id="plReloadBtn" class="btn primary" style="font-size:13px">📈 ดูรายงาน</button>
    `;
  } else {
    if (!_customFrom) _customFrom = `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}-01`;
    if (!_customTo)   _customTo   = todayBkk();  // Phase 89.1
    c.innerHTML = `
      <input type="date" id="plCustomFrom" value="${_customFrom}" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
      <span>→</span>
      <input type="date" id="plCustomTo" value="${_customTo}" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
      <button id="plReloadBtn" class="btn primary" style="font-size:13px">📈 ดูรายงาน</button>
    `;
  }
  document.getElementById("plReloadBtn")?.addEventListener("click", () => {
    if (_periodType === "month")    _periodValue = document.getElementById("plMonth")?.value || defaultMonth();
    if (_periodType === "quarter")  _periodValue = `${document.getElementById("plQYear")?.value}-Q${document.getElementById("plQuarter")?.value}`;
    if (_periodType === "year")     _periodValue = document.getElementById("plYear")?.value || defaultYear();
    if (_periodType === "custom") {
      _customFrom = document.getElementById("plCustomFrom")?.value || "";
      _customTo   = document.getElementById("plCustomTo")?.value   || "";
    }
    _loadAndRender();
  });
}

async function _loadAndRender() {
  const panel = document.getElementById("plResultPanel");
  if (!panel) return;
  if (_loading) return;
  _loading = true;

  const { from, to, label } = getDateRange();
  panel.innerHTML = `<div style="padding:30px;text-align:center;color:#64748b">⏳ กำลังโหลดรายงาน${_compareMode ? " (2 งวด)" : ""}...</div>`;

  try {
    if (_compareMode) {
      // ★ Phase 88.9: fetch ทั้ง 2 งวดพร้อมกัน
      const prev = getPreviousRange();
      const [curData, prevData] = await Promise.all([
        fetchData(from, to),
        fetchData(prev.from, prev.to)
      ]);
      const curAgg = aggregate(curData.lines, curData.coa);
      const prevAgg = aggregate(prevData.lines, prevData.coa);
      _result = { range: { from, to, label }, ...curAgg };
      _resultPrev = { range: prev, ...prevAgg };
      _renderTableCompare(panel);
    } else {
      const { lines, coa } = await fetchData(from, to);
      const agg = aggregate(lines, coa);
      _result = { range: { from, to, label }, ...agg };
      _resultPrev = null;
      _renderTable(panel);
    }
  } catch (e) {
    console.error("[profit_loss] load failed:", e);
    panel.innerHTML = `<div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b">❌ ${escHtml(e.message || String(e))}</div>`;
  } finally {
    _loading = false;
  }
}

// ★ Phase 88.9: Comparative render — 4 columns (รายการ | งวดนี้ | งวดก่อน | Δ % )
function _renderTableCompare(panel) {
  const cur = _result;
  const prev = _resultPrev;

  // Build merged account list (union ของ revenue + expense ทั้ง 2 งวด)
  const merge = (curList, prevList) => {
    const map = {};
    curList.forEach(a => { map[a.code] = { code: a.code, name: a.name, cur: a.amount, prev: 0 }; });
    prevList.forEach(a => {
      if (!map[a.code]) map[a.code] = { code: a.code, name: a.name, cur: 0, prev: a.amount };
      else map[a.code].prev = a.amount;
    });
    return Object.values(map).sort((a, b) => a.code.localeCompare(b.code));
  };

  const revenues = merge(cur.revenues, prev.revenues);
  const expenses = merge(cur.expenses, prev.expenses);

  const totalRevCur = cur.totalRevenue,  totalRevPrev = prev.totalRevenue;
  const totalExpCur = cur.totalExpense,  totalExpPrev = prev.totalExpense;
  const netCur      = cur.netIncome,      netPrev = prev.netIncome;

  const fmtChange = (curVal, prevVal) => {
    const diff = curVal - prevVal;
    const sign = diff > 0 ? "+" : (diff < 0 ? "−" : "");
    const absV = Math.abs(diff);
    const pct = prevVal !== 0 ? (diff / Math.abs(prevVal) * 100) : null;
    const color = diff > 0 ? "#15803d" : (diff < 0 ? "#dc2626" : "#94a3b8");
    return `<div style="color:${color};font-weight:700">${sign}${money(absV)}</div>${pct !== null ? `<div style="font-size:10px;color:${color}">(${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)</div>` : '<div style="font-size:10px;color:#cbd5e1">—</div>'}`;
  };

  const renderSection = (title, items, color, totalCurVal, totalPrevVal) => `
    <div style="margin-bottom:14px">
      <div style="background:${color};color:#fff;padding:8px 12px;border-radius:8px 8px 0 0;font-weight:700;font-size:13px">${title}</div>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;overflow:hidden;font-size:12px">
        <thead>
          <tr style="background:#f8fafc;color:#64748b">
            <th style="padding:6px 10px;text-align:left;width:60px">รหัส</th>
            <th style="padding:6px 10px;text-align:left">ชื่อบัญชี</th>
            <th style="padding:6px 10px;text-align:right;width:120px">งวดนี้</th>
            <th style="padding:6px 10px;text-align:right;width:120px">งวดก่อน</th>
            <th style="padding:6px 10px;text-align:right;width:120px">Δ</th>
          </tr>
        </thead>
        <tbody>
          ${items.length === 0 ? `<tr><td colspan="5" style="padding:14px;text-align:center;color:#94a3b8;font-style:italic">ไม่มีรายการ</td></tr>`
            : items.map(a => `
              <tr style="border-top:1px solid #f1f5f9">
                <td style="padding:6px 10px;font-family:monospace;color:#475569">${escHtml(a.code)}</td>
                <td style="padding:6px 10px">${escHtml(a.name)}</td>
                <td style="padding:6px 10px;text-align:right;font-family:monospace">${money(a.cur)}</td>
                <td style="padding:6px 10px;text-align:right;font-family:monospace;color:#94a3b8">${money(a.prev)}</td>
                <td style="padding:6px 10px;text-align:right;font-family:monospace">${fmtChange(a.cur, a.prev)}</td>
              </tr>
            `).join("")}
          <tr style="background:#f8fafc;font-weight:800">
            <td colspan="2" style="padding:8px 10px;text-align:right;color:${color}">รวม</td>
            <td style="padding:8px 10px;text-align:right;font-family:monospace;color:${color}">${money(totalCurVal)}</td>
            <td style="padding:8px 10px;text-align:right;font-family:monospace;color:#94a3b8">${money(totalPrevVal)}</td>
            <td style="padding:8px 10px;text-align:right;font-family:monospace">${fmtChange(totalCurVal, totalPrevVal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  const isProfit = netCur >= 0;

  panel.innerHTML = `
    <div id="plPrintArea">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:14px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">
        <div>
          <div style="font-size:11px;color:#64748b">งวดนี้</div>
          <div style="font-weight:700;color:#0284c7">${escHtml(cur.range.label)}</div>
          <div style="font-size:11px;color:#94a3b8">${cur.range.from} → ${cur.range.to}</div>
        </div>
        <div style="font-size:18px;color:#94a3b8">vs</div>
        <div>
          <div style="font-size:11px;color:#64748b">งวดก่อน</div>
          <div style="font-weight:700;color:#94a3b8">${escHtml(prev.range.label)}</div>
          <div style="font-size:11px;color:#94a3b8">${prev.range.from} → ${prev.range.to}</div>
        </div>
      </div>

      ${renderSection("🟢 รายได้ (Revenue)", revenues, "#059669", totalRevCur, totalRevPrev)}
      <div style="text-align:center;color:#94a3b8;margin:6px 0;font-size:13px;font-weight:700">— หัก —</div>
      ${renderSection("🟠 ค่าใช้จ่าย (Expenses)", expenses, "#ea580c", totalExpCur, totalExpPrev)}

      <!-- Net Income compare card -->
      <div style="background:${isProfit ? '#f0fdf4' : '#fef2f2'};border:3px solid ${isProfit ? '#16a34a' : '#dc2626'};border-radius:12px;padding:14px;margin-top:14px">
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-around">
          <div style="text-align:center">
            <div style="font-size:11px;color:#64748b">${isProfit ? '✅ กำไร' : '⚠️ ขาดทุน'} งวดนี้</div>
            <div style="font-size:22px;font-weight:900;font-family:monospace;color:${isProfit ? '#15803d' : '#dc2626'}">${isProfit ? '' : '('}${money(Math.abs(netCur))}${isProfit ? '' : ')'}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:11px;color:#64748b">งวดก่อน</div>
            <div style="font-size:18px;font-weight:700;font-family:monospace;color:#94a3b8">${netPrev >= 0 ? '' : '('}${money(Math.abs(netPrev))}${netPrev >= 0 ? '' : ')'}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:11px;color:#64748b">เปลี่ยน</div>
            <div style="font-size:14px;font-family:monospace">${fmtChange(netCur, netPrev)}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function _renderTable(panel) {
  const { range, revenues, expenses, totalRevenue, totalExpense, netIncome } = _result;
  const isProfit = netIncome >= 0;

  if (revenues.length === 0 && expenses.length === 0) {
    panel.innerHTML = `
      <div style="padding:30px;text-align:center;color:#64748b;background:#f8fafc;border-radius:10px">
        <div style="font-size:48px;margin-bottom:8px">📭</div>
        <div style="font-weight:700;font-size:16px;color:#0f172a;margin-bottom:4px">ไม่พบรายการในงวด</div>
        <div style="font-size:13px">${escHtml(range.label)} · ${range.from} → ${range.to}</div>
      </div>
    `;
    return;
  }

  const renderSection = (title, items, color, total, totalLabel) => `
    <div style="margin-bottom:18px">
      <div style="background:${color};color:#fff;padding:10px 14px;border-radius:8px 8px 0 0;font-weight:700;font-size:14px">${title}</div>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
        <tbody>
          ${items.length === 0 ? `
            <tr><td colspan="3" style="padding:14px;text-align:center;color:#94a3b8;font-style:italic">ไม่มีรายการ</td></tr>
          ` : items.map(a => `
            <tr>
              <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9;font-family:monospace;color:#475569;width:80px">${escHtml(a.code)}</td>
              <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9">${escHtml(a.name)}</td>
              <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-family:monospace;width:160px">${money(a.amount)}</td>
            </tr>
          `).join("")}
          <tr style="background:#f8fafc;font-weight:700">
            <td colspan="2" style="padding:10px 14px;text-align:right;color:${color}">${escHtml(totalLabel)}</td>
            <td style="padding:10px 14px;text-align:right;font-family:monospace;color:${color}">${money(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  const grossMargin = totalRevenue > 0 ? (netIncome / totalRevenue * 100) : 0;

  panel.innerHTML = `
    <div id="plPrintArea">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-weight:700;font-size:16px;color:#0f172a">${escHtml(range.label)}</div>
            <div style="font-size:12px;color:#64748b">${range.from} → ${range.to}</div>
          </div>
        </div>
      </div>

      ${renderSection("🟢 รายได้ (Revenue)", revenues, "#059669", totalRevenue, "รวมรายได้")}

      <div style="text-align:center;color:#94a3b8;margin:8px 0;font-size:14px;font-weight:700">— หัก —</div>

      ${renderSection("🟠 ค่าใช้จ่าย (Expenses)", expenses, "#ea580c", totalExpense, "รวมค่าใช้จ่าย")}

      <!-- Net Income card -->
      <div style="background:${isProfit ? '#f0fdf4' : '#fef2f2'};border:3px solid ${isProfit ? '#16a34a' : '#dc2626'};border-radius:12px;padding:18px;margin-top:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px">
          <div>
            <div style="font-size:13px;color:#64748b;margin-bottom:2px">${isProfit ? '✅ กำไรสุทธิ' : '⚠️ ขาดทุนสุทธิ'} (Net ${isProfit ? 'Profit' : 'Loss'})</div>
            <div style="font-size:11px;color:#94a3b8">รายได้ ${money(totalRevenue)} − ค่าใช้จ่าย ${money(totalExpense)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:28px;font-weight:900;font-family:monospace;color:${isProfit ? '#15803d' : '#dc2626'}">
              ${isProfit ? '' : '('}${money(Math.abs(netIncome))}${isProfit ? '' : ')'}
            </div>
            ${totalRevenue > 0 ? `
              <div style="font-size:11px;color:#64748b">
                Margin: <b style="color:${moneyColor(grossMargin)}">${grossMargin.toFixed(2)}%</b>
              </div>
            ` : ''}
          </div>
        </div>
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
  const { range, revenues, expenses, totalRevenue, totalExpense, netIncome } = _result;
  const rows = [];

  rows.push({ "หมวด": "รายได้", "รหัส": "", "ชื่อบัญชี": "", "จำนวนเงิน": "" });
  revenues.forEach(a => rows.push({ "หมวด": "รายได้", "รหัส": a.code, "ชื่อบัญชี": a.name, "จำนวนเงิน": Number(a.amount || 0) }));
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "รวมรายได้", "จำนวนเงิน": totalRevenue });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "", "จำนวนเงิน": "" });

  rows.push({ "หมวด": "ค่าใช้จ่าย", "รหัส": "", "ชื่อบัญชี": "", "จำนวนเงิน": "" });
  expenses.forEach(a => rows.push({ "หมวด": "ค่าใช้จ่าย", "รหัส": a.code, "ชื่อบัญชี": a.name, "จำนวนเงิน": Number(a.amount || 0) }));
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "รวมค่าใช้จ่าย", "จำนวนเงิน": totalExpense });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "", "จำนวนเงิน": "" });

  rows.push({ "หมวด": netIncome >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ", "รหัส": "", "ชื่อบัญชี": "", "จำนวนเงิน": netIncome });

  const sheet = `PL_${range.from}_${range.to}`;
  const filename = `profit_loss_${range.from}_${range.to}_${todaySuffix()}.xlsx`;
  exportToExcel(filename, sheet, rows);
  _ctx?.showToast?.("ดาวน์โหลด Excel แล้ว ✅");
}

// ─── Print ───
function _onPrint() {
  if (!_result) {
    _ctx?.showToast?.("ยังไม่มีข้อมูล — กดดูรายงานก่อน", "error");
    return;
  }
  const printable = document.getElementById("plPrintArea");
  if (!printable) return;

  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { _ctx?.showToast?.("Browser blocked popup", "error"); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>P&L ${_result.range.label}</title>
    <style>
      body { font-family: 'Sarabun', sans-serif; padding: 20px; color: #0f172a; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; }
      th, td { padding: 5px 8px; border: 1px solid #ddd; }
      .right { text-align: right; font-family: 'Roboto Mono', monospace; }
      @media print { body { padding: 10mm; } button { display: none; } }
    </style></head><body>
    <h1>📈 งบกำไรขาดทุน — ${escHtml(_result.range.label)}</h1>
    <div style="font-size:11px;color:#64748b">${_result.range.from} → ${_result.range.to} · พิมพ์เมื่อ ${new Date().toLocaleString("th-TH")}</div>
    ${printable.innerHTML.replace(/<button[\s\S]*?<\/button>/g, "")}
    <script>setTimeout(() => window.print(), 250)<\/script>
    </body></html>`);
  w.document.close();
}
