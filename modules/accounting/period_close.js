// ═══════════════════════════════════════════════════════════
//  period_close.js — เช็คก่อนปิดงวด (Period Close Checklist) — Phase 92.51 (HR took 92.49/92.50)
//
//  Read-only checklist: ก่อน admin ปิดงวดบัญชี ดูว่าเดือนนั้น "พร้อมปิด" ไหม
//    1. เดบิต = เครดิต (Dr=Cr)        — reuse trial_balance (no logic drift)
//    2. ขาย/รายจ่าย ทุกบิลในเดือนมี JE — reuse _classifyOrphan (Phase 92.48)
//    3. สถานะงวด (เปิด/ปิด)            — accounting_periods
//
//  ★ READ-ONLY ทั้งหมด — ไม่ post/แก้/ลบข้อมูลใด ๆ (ถ้าต้องสร้าง JE ใช้หน้า Backfill)
//  🚧 ส่วน payroll/leave (HR) — defer ให้ทีม HR (โมดูลนี้ไม่แตะไฟล์ HR)
// ═══════════════════════════════════════════════════════════

import { fetchTrialBalanceData, aggregate } from "./trial_balance.js";
import { _classifyOrphan, INTEGRITY_CATS } from "./backfill.js";
import { todayBkk } from "../utils.js";

let _ctx = null;
let _month = null;     // "YYYY-MM"
let _loading = false;

function escHtml(s) { const d = document.createElement("div"); d.textContent = String(s ?? ""); return d.innerHTML; }
function money(n) { return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0)); }
function pad2(n) { return String(n).padStart(2, "0"); }
function defaultMonth() { return todayBkk().slice(0, 7); }  // Bangkok YYYY-MM

// Pure (exported for test): "YYYY-MM" → { from, to, toNext, y, m }
//   from/to = first/last calendar day; toNext = exclusive upper bound for timestamptz filters
export function monthRange(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const next = new Date(Date.UTC(y, m - 1, lastDay));
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    from: `${y}-${pad2(m)}-01`,
    to: `${y}-${pad2(m)}-${pad2(lastDay)}`,
    toNext: next.toISOString().slice(0, 10),
    y, m
  };
}

export function renderPeriodClosePage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-accounting_period_close");
  if (!container) return;
  if (!_month) _month = defaultMonth();

  container.innerHTML = `
    <div class="panel" style="max-width:900px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <span style="font-size:28px">🧾</span>
        <div style="flex:1;min-width:200px">
          <h2 style="margin:0;font-size:20px;color:#0f172a">เช็คก่อนปิดงวด (Period Close)</h2>
          <div style="font-size:12px;color:#64748b">ดูความพร้อมก่อนปิดงวดบัญชี — read-only ไม่แก้ข้อมูล</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="month" id="pcMonth" value="${_month}" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px" />
          <button id="pcReload" class="btn primary" style="font-size:13px">🔍 ตรวจ</button>
        </div>
      </div>
      <div id="pcResult"></div>
    </div>
  `;

  document.getElementById("pcReload")?.addEventListener("click", () => {
    _month = document.getElementById("pcMonth")?.value || defaultMonth();
    _loadAndRender();
  });
  _loadAndRender();
}

async function _periodStatus(y, m) {
  // mirrors auto_post.js period-lock query (accounting_periods columns confirmed: year/month/status)
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const r = await fetch(`${cfg.url}/rest/v1/accounting_periods?select=status&year=eq.${y}&month=eq.${m}`, {
    headers: { apikey: cfg.anonKey, Authorization: "Bearer " + token }
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const arr = await r.json();
  return arr[0]?.status || "open";
}

// Count actionable orphans (source row in month without JE) — reuses _classifyOrphan (no drift)
async function _monthOrphanActionable(catKey, from, toNext) {
  const cat = INTEGRITY_CATS.find(c => c.key === catKey);
  if (!cat) return 0;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { apikey: cfg.anonKey, Authorization: "Bearer " + token };

  // view exposes created_at — filter to the month server-side (timestamptz: gte from, lt next-day)
  const vr = await fetch(`${cfg.url}/rest/v1/${cat.view}?select=id&created_at=gte.${from}&created_at=lt.${toNext}`, { headers });
  if (!vr.ok) throw new Error(`${cat.view} HTTP ${vr.status}`);
  const ids = (await vr.json()).map(x => x.id);
  if (!ids.length) return 0;

  let actionable = 0;
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const rr = await fetch(`${cfg.url}/rest/v1/${cat.table}?id=in.(${chunk.join(",")})&select=${cat.sel}`, { headers });
    if (!rr.ok) throw new Error(`${cat.table} HTTP ${rr.status}`);
    for (const row of await rr.json()) {
      if (_classifyOrphan(cat, row).bucket === "actionable") actionable++;
    }
  }
  return actionable;
}

async function _loadAndRender() {
  const panel = document.getElementById("pcResult");
  if (!panel || _loading) return;
  _loading = true;
  panel.innerHTML = `<div style="padding:24px;text-align:center;color:#64748b">⏳ กำลังตรวจ...</div>`;

  const { from, to, toNext, y, m } = monthRange(_month);
  const checks = [];

  // 1) Dr = Cr
  try {
    const { lines, coa } = await fetchTrialBalanceData(from, to);
    const { total } = aggregate(lines, coa);
    const diff = total.debit - total.credit;
    checks.push({
      label: "เดบิต = เครดิต (Dr=Cr)",
      status: lines.length === 0 ? "info" : (Math.abs(diff) < 0.01 ? "ok" : "bad"),
      detail: lines.length === 0 ? "ยังไม่มี JE ในเดือนนี้"
        : (Math.abs(diff) < 0.01 ? `บาลานซ์ — Dr รวม ฿${money(total.debit)}` : `ไม่บาลานซ์ — ผลต่าง ฿${money(diff)}`)
    });
  } catch (e) { checks.push({ label: "เดบิต = เครดิต (Dr=Cr)", status: "err", detail: e.message }); }

  // 2) sales / expenses ทุกบิลมี JE
  for (const catKey of ["sales", "expenses"]) {
    const label = catKey === "sales" ? "ขาย — ทุกบิลมี JE" : "รายจ่าย — ทุกรายการมี JE";
    try {
      const n = await _monthOrphanActionable(catKey, from, toNext);
      checks.push({ label, status: n === 0 ? "ok" : "bad", detail: n === 0 ? "ครบทุกรายการ" : `ค้าง ${n.toLocaleString()} รายการ — สร้าง JE ที่หน้า Backfill` });
    } catch (e) { checks.push({ label, status: "err", detail: e.message }); }
  }

  // 3) สถานะงวด
  let closed = false;
  try {
    const st = await _periodStatus(y, m);
    closed = (st === "closed");
    checks.push({ label: "สถานะงวด", status: closed ? "closed" : "open", detail: closed ? "ปิดงวดแล้ว — ห้ามโพสต์ย้อน" : "ยังเปิดอยู่" });
  } catch (e) { checks.push({ label: "สถานะงวด", status: "err", detail: e.message }); }

  _render(panel, checks, { from, to, closed });
  // eslint-disable-next-line require-atomic-updates -- _loading lock release (entry guard at _loadAndRender top)
  _loading = false;
}

function _render(panel, checks, { from, to, closed }) {
  const ICON = { ok: "✅", bad: "❌", info: "ℹ️", err: "⚠️", open: "🔓", closed: "🔒" };
  const bad = checks.filter(c => c.status === "bad").length;
  const err = checks.filter(c => c.status === "err").length;

  let head;
  if (closed) {
    head = `<div style="padding:12px 14px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;color:#334155;font-weight:700">🔒 งวดนี้ปิดแล้ว</div>`;
  } else if (err) {
    head = `<div style="padding:12px 14px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;color:#78350f;font-weight:700">🟡 ตรวจไม่ครบ — มีบางเช็ค error (ดูด้านล่าง)</div>`;
  } else if (bad === 0) {
    head = `<div style="padding:12px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;color:#166534;font-weight:700">🟢 พร้อมปิดงวด — ทุกเช็คผ่าน</div>`;
  } else {
    head = `<div style="padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-weight:700">🔴 ยังไม่พร้อม — มี ${bad} เช็คที่ต้องแก้ก่อน</div>`;
  }

  const rows = checks.map(c => `
    <div style="display:flex;gap:10px;padding:11px 12px;border-bottom:1px solid #f1f5f9;align-items:center">
      <span style="font-size:18px">${ICON[c.status] || "•"}</span>
      <div style="flex:1">
        <div style="font-weight:600;color:#0f172a;font-size:14px">${escHtml(c.label)}</div>
        <div style="font-size:12px;color:#64748b">${escHtml(c.detail)}</div>
      </div>
    </div>`).join("");

  panel.innerHTML = `
    ${head}
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;margin-top:12px;overflow:hidden">${rows}</div>
    <div style="margin-top:12px;padding:10px 12px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;font-size:12px;color:#64748b">
      🚧 ส่วน <b>เงินเดือน / การลา (HR)</b> กำลังพัฒนาโดยทีม HR — ดูสรุป orphan/JE รวมได้ที่หน้า <b>Backfill ย้อนหลัง</b>
    </div>
    <div style="font-size:11px;color:#94a3b8;margin-top:8px">งวด ${escHtml(from)} → ${escHtml(to)} · read-only · ไม่แก้ข้อมูล</div>
  `;
}
