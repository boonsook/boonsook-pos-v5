// ═══════════════════════════════════════════════════════════
//  balance_sheet.js — งบดุล (Phase 88.4)
//
//  Balance Sheet — สมการบัญชีหลัก: Assets = Liabilities + Equity
//
//  ⚠️ ความซับซ้อน: BS ใช้ closing balance (cumulative) ไม่ใช่ movement
//  → query JV ตั้งแต่ effective date (2026-01-01) จนถึง "as of date"
//
//  Logic:
//    Asset (1xxx)     = Dr - Cr  (normal Dr balance)
//    Liability (2xxx) = Cr - Dr  (normal Cr balance)
//    Equity (3xxx)    = Cr - Dr  (normal Cr balance)
//    Retained Earnings = Σ(income) - Σ(expense) since effective
//        → automatic ใน equity section (ใช้แทน 3900)
// ═══════════════════════════════════════════════════════════

import { exportToExcel, todaySuffix, todayBkk } from "../utils.js";

// ★ Phase 88.18b: production เริ่ม 1 พ.ค. 2026 (ก่อนหน้านี้เป็น test data)
const ACCOUNTING_EFFECTIVE_DATE = "2026-05-01";

let _ctx = null;
let _asOfDate = null;
let _result = null;
let _loading = false;

function money(n) { return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0)); }
function escHtml(s) { const d = document.createElement("div"); d.textContent = String(s ?? ""); return d.innerHTML; }
function _pad2(n) { return String(n).padStart(2, "0"); }
function fmtMoney(n) {
  const v = Number(n || 0);
  if (v < 0) return `(${money(-v)})`;
  return money(v);
}

function defaultAsOf() {
  return todayBkk();  // Phase 89.1: Bangkok time
}

async function fetchData(asOfDate) {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };

  // ★ BS = cumulative ตั้งแต่ effective date → asOfDate
  const entriesUrl = `${cfg.url}/rest/v1/journal_entries?select=id&doc_date=gte.${ACCOUNTING_EFFECTIVE_DATE}&doc_date=lte.${asOfDate}&status=eq.approved`;
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

  const agg = {};
  lines.forEach(l => {
    const code = l.account_code;
    if (!agg[code]) {
      agg[code] = {
        code,
        name: coaMap[code]?.name || "(ไม่พบชื่อ)",
        type: coaMap[code]?.type || "expense",
        debit: 0, credit: 0
      };
    }
    agg[code].debit  += Number(l.debit  || 0);
    agg[code].credit += Number(l.credit || 0);
  });

  // Calculate balance per account
  const assets = [], liabilities = [], equityList = [];
  let totalIncome = 0, totalExpense = 0;
  Object.values(agg).forEach(a => {
    if (a.type === "asset") {
      a.balance = a.debit - a.credit;
      if (Math.abs(a.balance) > 0.005) assets.push(a);
    } else if (a.type === "liability") {
      a.balance = a.credit - a.debit;
      if (Math.abs(a.balance) > 0.005) liabilities.push(a);
    } else if (a.type === "equity") {
      a.balance = a.credit - a.debit;
      if (Math.abs(a.balance) > 0.005) equityList.push(a);
    } else if (a.type === "income") {
      totalIncome += (a.credit - a.debit);
    } else if (a.type === "expense") {
      totalExpense += (a.debit - a.credit);
    }
  });
  const sortByCode = (a, b) => a.code.localeCompare(b.code);
  assets.sort(sortByCode);
  liabilities.sort(sortByCode);
  equityList.sort(sortByCode);

  // Retained Earnings (กำไรสะสม) — เพิ่มใน equity section
  const retainedEarnings = totalIncome - totalExpense;

  const totalAssets       = assets.reduce((s, a) => s + a.balance, 0);
  const totalLiabilities  = liabilities.reduce((s, a) => s + a.balance, 0);
  const totalEquity       = equityList.reduce((s, a) => s + a.balance, 0) + retainedEarnings;

  return { assets, liabilities, equityList, retainedEarnings, totalAssets, totalLiabilities, totalEquity };
}

export function renderBalanceSheetPage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-accounting_balance_sheet");
  if (!container) return;

  if (!_asOfDate) _asOfDate = defaultAsOf();

  container.innerHTML = `
    <div class="panel" style="max-width:900px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <span style="font-size:30px">🏦</span>
        <div style="flex:1;min-width:200px">
          <h2 style="margin:0;font-size:20px;color:#0f172a">งบดุล (Balance Sheet)</h2>
          <div style="font-size:12px;color:#64748b">สมการบัญชี: สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ · รวมจาก ${ACCOUNTING_EFFECTIVE_DATE} ถึง as-of date</div>
        </div>
        <div style="display:flex;gap:6px">
          <button id="bsExportBtn" class="btn light" style="font-size:13px">📤 Excel</button>
          <button id="bsPrintBtn" class="btn light" style="font-size:13px">🖨 พิมพ์</button>
        </div>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <label style="font-weight:600;color:#1f2937">📅 ณ วันที่:</label>
        <input type="date" id="bsAsOf" value="${_asOfDate}" min="${ACCOUNTING_EFFECTIVE_DATE}" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
        <button id="bsReloadBtn" class="btn primary" style="font-size:13px">🏦 ดูรายงาน</button>
        <div style="flex:1;min-width:100px"></div>
        <span style="font-size:11px;color:#94a3b8">💡 ค่ายอมรับ: ${ACCOUNTING_EFFECTIVE_DATE} ↔ ปัจจุบัน</span>
      </div>

      <div id="bsResultPanel"></div>
    </div>
  `;

  document.getElementById("bsReloadBtn")?.addEventListener("click", () => {
    _asOfDate = document.getElementById("bsAsOf")?.value || defaultAsOf();
    _loadAndRender();
  });
  document.getElementById("bsExportBtn")?.addEventListener("click", _onExport);
  document.getElementById("bsPrintBtn")?.addEventListener("click", _onPrint);

  _loadAndRender();
}

async function _loadAndRender() {
  const panel = document.getElementById("bsResultPanel");
  if (!panel) return;
  if (_loading) return;
  _loading = true;

  panel.innerHTML = `<div style="padding:30px;text-align:center;color:#64748b">⏳ กำลังโหลดรายงาน...</div>`;

  try {
    const { lines, coa } = await fetchData(_asOfDate);
    const agg = aggregate(lines, coa);
    _result = { asOfDate: _asOfDate, ...agg };
    _renderTable(panel);
  } catch (e) {
    console.error("[balance_sheet] load failed:", e);
    panel.innerHTML = `<div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b">❌ ${escHtml(e.message || String(e))}</div>`;
  } finally {
    _loading = false;
  }
}

function _renderTable(panel) {
  const { asOfDate, assets, liabilities, equityList, retainedEarnings, totalAssets, totalLiabilities, totalEquity } = _result;
  const totalLE = totalLiabilities + totalEquity;
  const balanced = Math.abs(totalAssets - totalLE) < 0.01;

  if (assets.length === 0 && liabilities.length === 0 && equityList.length === 0 && Math.abs(retainedEarnings) < 0.01) {
    panel.innerHTML = `
      <div style="padding:30px;text-align:center;color:#64748b;background:#f8fafc;border-radius:10px">
        <div style="font-size:48px;margin-bottom:8px">📭</div>
        <div style="font-weight:700;font-size:16px;color:#0f172a;margin-bottom:4px">ไม่พบรายการ</div>
        <div style="font-size:13px">ตั้งแต่ ${ACCOUNTING_EFFECTIVE_DATE} ถึง ${asOfDate}</div>
      </div>
    `;
    return;
  }

  const renderSection = (title, items, color, total, totalLabel, footer = "") => `
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
              <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-family:monospace;width:160px;color:${a.balance < 0 ? '#dc2626' : '#0f172a'}">${fmtMoney(a.balance)}</td>
            </tr>
          `).join("")}
          ${footer}
          <tr style="background:#f8fafc;font-weight:700">
            <td colspan="2" style="padding:10px 14px;text-align:right;color:${color}">${escHtml(totalLabel)}</td>
            <td style="padding:10px 14px;text-align:right;font-family:monospace;color:${color}">${fmtMoney(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  // Retained Earnings row (added inside equity section)
  const retEarnRow = `
    <tr>
      <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9;font-family:monospace;color:#475569;width:80px">3900</td>
      <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9">
        ${retainedEarnings >= 0 ? "กำไรสะสม" : "ขาดทุนสะสม"}
        <span style="font-size:11px;color:#94a3b8;margin-left:6px">(จาก รายได้ - ค่าใช้จ่าย ในงวด)</span>
      </td>
      <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-family:monospace;color:${retainedEarnings < 0 ? '#dc2626' : '#0f172a'}">${fmtMoney(retainedEarnings)}</td>
    </tr>
  `;

  panel.innerHTML = `
    <div id="bsPrintArea">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px">
        <div style="font-weight:700;font-size:16px;color:#0f172a">ณ วันที่ ${escHtml(asOfDate)}</div>
        <div style="font-size:12px;color:#64748b">รวมตั้งแต่ ${ACCOUNTING_EFFECTIVE_DATE} → ${asOfDate}</div>
      </div>

      ${renderSection("🟦 สินทรัพย์ (Assets)", assets, "#0284c7", totalAssets, "รวมสินทรัพย์")}
      ${renderSection("🟥 หนี้สิน (Liabilities)", liabilities, "#dc2626", totalLiabilities, "รวมหนี้สิน")}
      ${renderSection("🟪 ส่วนของเจ้าของ (Equity)", equityList, "#7c3aed", totalEquity, "รวมส่วนของเจ้าของ", retEarnRow)}

      <!-- Equation card -->
      <div style="background:${balanced ? '#f0fdf4' : '#fef2f2'};border:3px solid ${balanced ? '#16a34a' : '#dc2626'};border-radius:12px;padding:18px;margin-top:18px">
        <div style="text-align:center;margin-bottom:10px">
          <div style="font-size:13px;color:#64748b;margin-bottom:4px">${balanced ? '✅ สมการบัญชี balance' : '⚠️ สมการบัญชีไม่ balance'}</div>
          <div style="font-size:14px;font-weight:700;color:#0f172a">สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ</div>
        </div>
        <div style="display:flex;justify-content:space-around;align-items:center;flex-wrap:wrap;gap:14px;font-family:monospace;text-align:center">
          <div>
            <div style="font-size:11px;color:#64748b">สินทรัพย์</div>
            <div style="font-size:20px;font-weight:800;color:${totalAssets < 0 ? '#dc2626' : '#0f172a'}">${fmtMoney(totalAssets)}</div>
          </div>
          <div style="font-size:24px;color:${balanced ? '#15803d' : '#dc2626'};font-weight:900">=</div>
          <div>
            <div style="font-size:11px;color:#64748b">หนี้สิน + ส่วนของเจ้าของ</div>
            <div style="font-size:20px;font-weight:800;color:${totalLE < 0 ? '#dc2626' : '#0f172a'}">${fmtMoney(totalLE)}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px">(${fmtMoney(totalLiabilities)} + ${fmtMoney(totalEquity)})</div>
          </div>
        </div>
        ${!balanced ? `<div style="font-size:12px;color:#991b1b;margin-top:10px;text-align:center">ผลต่าง: ${fmtMoney(totalAssets - totalLE)}</div>` : ''}
      </div>

      ${(totalAssets < 0 || totalEquity < 0) ? `
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px;margin-top:14px;font-size:12px;color:#7c2d12;line-height:1.7">
          💡 <b>ตัวเลขลบ?</b> ตอนนี้ระบบยังไม่มี <b>ยอดยกมา (Opening Balance)</b> — เช่น ทุนเริ่มต้น, เงินสดเดิม, ลูกหนี้คงค้าง
          <br>→ admin ควรลง JV ประเภท <code>OB</code> (Opening Balance) ใน "บันทึกรายการบัญชี" เพื่อให้ตัวเลขสะท้อนความจริง
          <br>→ Phase 88.5 จะมี UI ช่วยลง opening balance สะดวก
        </div>
      ` : ''}
    </div>
  `;
}

function _onExport() {
  if (!_result) {
    _ctx?.showToast?.("ยังไม่มีข้อมูล — กดดูรายงานก่อน", "error");
    return;
  }
  const { asOfDate, assets, liabilities, equityList, retainedEarnings, totalAssets, totalLiabilities, totalEquity } = _result;
  const rows = [];

  rows.push({ "หมวด": "สินทรัพย์", "รหัส": "", "ชื่อบัญชี": "", "ยอด": "" });
  assets.forEach(a => rows.push({ "หมวด": "สินทรัพย์", "รหัส": a.code, "ชื่อบัญชี": a.name, "ยอด": Number(a.balance || 0) }));
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "รวมสินทรัพย์", "ยอด": totalAssets });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "", "ยอด": "" });

  rows.push({ "หมวด": "หนี้สิน", "รหัส": "", "ชื่อบัญชี": "", "ยอด": "" });
  liabilities.forEach(a => rows.push({ "หมวด": "หนี้สิน", "รหัส": a.code, "ชื่อบัญชี": a.name, "ยอด": Number(a.balance || 0) }));
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "รวมหนี้สิน", "ยอด": totalLiabilities });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "", "ยอด": "" });

  rows.push({ "หมวด": "ส่วนของเจ้าของ", "รหัส": "", "ชื่อบัญชี": "", "ยอด": "" });
  equityList.forEach(a => rows.push({ "หมวด": "ส่วนของเจ้าของ", "รหัส": a.code, "ชื่อบัญชี": a.name, "ยอด": Number(a.balance || 0) }));
  rows.push({ "หมวด": "ส่วนของเจ้าของ", "รหัส": "3900", "ชื่อบัญชี": retainedEarnings >= 0 ? "กำไรสะสม" : "ขาดทุนสะสม", "ยอด": Number(retainedEarnings || 0) });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "รวมส่วนของเจ้าของ", "ยอด": totalEquity });
  rows.push({ "หมวด": "", "รหัส": "", "ชื่อบัญชี": "", "ยอด": "" });

  rows.push({ "หมวด": "Total Assets", "รหัส": "", "ชื่อบัญชี": "", "ยอด": totalAssets });
  rows.push({ "หมวด": "Total L+E",    "รหัส": "", "ชื่อบัญชี": "", "ยอด": totalLiabilities + totalEquity });

  const sheet = `BS_${asOfDate}`;
  const filename = `balance_sheet_${asOfDate}_${todaySuffix()}.xlsx`;
  exportToExcel(filename, sheet, rows);
  _ctx?.showToast?.("ดาวน์โหลด Excel แล้ว ✅");
}

function _onPrint() {
  if (!_result) {
    _ctx?.showToast?.("ยังไม่มีข้อมูล — กดดูรายงานก่อน", "error");
    return;
  }
  const printable = document.getElementById("bsPrintArea");
  if (!printable) return;

  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { _ctx?.showToast?.("Browser blocked popup", "error"); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>BS ${_result.asOfDate}</title>
    <style>
      body { font-family: 'Sarabun', sans-serif; padding: 20px; color: #0f172a; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; }
      th, td { padding: 5px 8px; border: 1px solid #ddd; }
      .right { text-align: right; font-family: 'Roboto Mono', monospace; }
      @media print { body { padding: 10mm; } button { display: none; } }
    </style></head><body>
    <h1>🏦 งบดุล (Balance Sheet) — ณ ${escHtml(_result.asOfDate)}</h1>
    <div style="font-size:11px;color:#64748b">รวมตั้งแต่ ${ACCOUNTING_EFFECTIVE_DATE} → ${_result.asOfDate} · พิมพ์เมื่อ ${new Date().toLocaleString("th-TH")}</div>
    ${printable.innerHTML.replace(/<button[\s\S]*?<\/button>/g, "")}
    <script>setTimeout(() => window.print(), 250)<\/script>
    </body></html>`);
  w.document.close();
}
