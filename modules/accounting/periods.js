// ═══════════════════════════════════════════════════════════
//  periods.js — Period Close (Lock งวดบัญชี) — Phase 88.19
//
//  ปิดงวดเดือน → กัน user แก้/สร้าง JV ในงวดนั้น
//  Trigger ระดับ DB กันอีกชั้น (defense in depth)
//
//  Phase 92.53: + close-readiness gate (มาตรฐาน month-end close: ตรวจครบก่อนล็อก)
//    Dr=Cr · completeness (บิลมี JE ครบ) · orphan JV (JE ที่ source ถูกลบ)
// ═══════════════════════════════════════════════════════════

import { _classifyOrphan, INTEGRITY_CATS } from "./backfill.js";
// Phase 390: รวม "งานบริการที่ปิดแล้วแต่ยังไม่มี JE" เข้า close-readiness (กันงวดเขียวทั้งที่รายได้บริการหาย)
import { fetchServiceJVStatus } from "../service_reconcile.js";
import { fetchApprovedJournalLines } from "./je_fetch.js";
import { fetchAllRowsRaw } from "../fetch_paginated.js";  // Phase 579: paginate readiness fetch (เกิน 1000 ต้องได้ครบ, throw บน error → fail-closed)

// non-HR source tables ที่ auto_post สร้าง JE (ไม่รวม staff_payroll = HR domain)
const READINESS_JV_SOURCES = ["sales", "expenses", "receipts", "delivery_invoices", "service_jobs", "credit_payments", "refunds"];

let _ctx = null;
let _periods = [];        // cache จาก fetchPeriods()
let _summaryCache = {};   // { "yyyy-mm": { revenue, expense, net, jvCount } }
let _activeYear = new Date().getFullYear() + 543 - 543;  // ค.ศ.

const MONTHS_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

function escHtml(s) { const d = document.createElement("div"); d.textContent = String(s ?? ""); return d.innerHTML; }
function money(n) { return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0)); }

// Phase 390 (Codex): เดือนนี้ "ต้องตรวจ/ยังไม่พร้อม" หรือไม่ — true ถ้ามีบิล/orphan JV ค้าง
// หรือ "งานบริการยังไม่เข้าบัญชี" หรือ "ตรวจงานบริการไม่ได้ (unknown)". ใช้ตัดสินว่าการ์ดเดือน
// (แม้ jvCount=0) ต้องโชว์ warning ไม่ใช่ "ไม่มีรายการในเดือนนี้".
export function _monthNeedsAttention(rd) {
  return !!(rd && (rd.serviceMissing > 0 || rd.serviceUnknown || rd.orphanSrc > 0 || rd.orphanJV > 0 || rd.srcUnknown || rd.jvUnknown));
}

// Phase 390: readiness label แยกชัด — บิลครบ / orphan JV / งานบริการ missing / unknown.
// แสดง "ครบ ✅" เฉพาะเมื่อทุกชั้นเขียว (รวม service + ไม่มี unknown) — กันงวดเขียวลวง.
export function _readinessLinesHtml(rd) {
  if (!rd) return "";
  const lines = [];
  if (rd.orphanSrc > 0) lines.push(`<div style="margin-top:2px;font-weight:600;color:#b91c1c">📋 ค้าง ${rd.orphanSrc} บิลไม่มี JE ⚠️</div>`);
  if (rd.orphanJV > 0) lines.push(`<div style="margin-top:2px;font-weight:600;color:#b91c1c">🧹 orphan JV ${rd.orphanJV} (source ถูกลบ) ⚠️</div>`);
  if (rd.serviceMissing > 0) lines.push(`<div style="margin-top:2px;font-weight:600;color:#b91c1c">🔧 งานบริการ ${rd.serviceMissing} งานยังไม่เข้าบัญชี ⚠️</div>`);
  if (rd.serviceUnknown) lines.push(`<div style="margin-top:2px;font-weight:600;color:#b45309">🔧 ตรวจงานบริการไม่ได้ (unknown) — ยังไม่ยืนยันว่าครบ ⚠️</div>`);
  // ★ Phase 579: บิล/orphan-JV ตรวจไม่ได้ (network สะดุด/เกิน cap) → เตือน unknown (สีเหลือง) ไม่โชว์ "ครบ ✅" หลอก
  if (rd.srcUnknown) lines.push(`<div style="margin-top:2px;font-weight:600;color:#b45309">📋 ตรวจบิลไม่ได้ (unknown) — ยังไม่ยืนยันว่าครบ ⚠️</div>`);
  if (rd.jvUnknown) lines.push(`<div style="margin-top:2px;font-weight:600;color:#b45309">🧹 ตรวจ orphan JV ไม่ได้ (unknown) — ยังไม่ยืนยันว่าครบ ⚠️</div>`);
  if (rd.orphanSrc === 0 && rd.orphanJV === 0 && rd.serviceMissing === 0 && !rd.serviceUnknown && !rd.srcUnknown && !rd.jvUnknown) {
    lines.push(`<div style="margin-top:2px;font-weight:600;color:#166534">📋 บิล + งานบริการมี JE ครบ ✅</div>`);
  }
  return lines.join("");
}

// ───────────────────────────────────────────────────────────
// API helpers
// ───────────────────────────────────────────────────────────
async function fetchPeriods() {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const r = await fetch(`${cfg.url}/rest/v1/accounting_periods?select=*&order=year.desc,month.desc`, {
    headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token }
  });
  if (!r.ok) throw new Error("fetch periods failed: HTTP " + r.status);
  return await r.json();
}

async function fetchPeriodSummary(year, month) {
  const cacheKey = `${year}-${String(month).padStart(2,"0")}`;
  if (_summaryCache[cacheKey]) return _summaryCache[cacheKey];

  const fromDate = `${year}-${String(month).padStart(2,"0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const toDate = `${year}-${String(month).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`;

  // ดึง entries + lines เพื่อคำนวณ revenue/expense
  // ★ Phase 496 (audit #2): paginate (เดิม fetch ตรง + join ids ทั้งหมด → 1000-cap + URL ยาวเมื่อ entries เยอะ)
  //   +entry_id เพื่อ count JV distinct (เดิมใช้ entries.length)
  const lines = await fetchApprovedJournalLines(fromDate, toDate, "account_code,debit,credit,entry_id");

  let revenue = 0, expense = 0, totalDr = 0, totalCr = 0;
  lines.forEach(l => {
    const code = String(l.account_code || "");
    const dr = Number(l.debit || 0), cr = Number(l.credit || 0);
    totalDr += dr; totalCr += cr;
    // Revenue: 4xxx (Cr - Dr)
    if (code.startsWith("4")) revenue += cr - dr;
    // Expense: 5xxx (Dr - Cr)
    if (code.startsWith("5")) expense += dr - cr;
  });

  // ★ Phase 92.53: Dr=Cr balance check (accounting close-readiness) — reuses the lines already fetched, no extra request
  const drCrDiff = totalDr - totalCr;
  const summary = {
    revenue,
    expense,
    net: revenue - expense,
    jvCount: new Set(lines.map(l => l.entry_id)).size,
    totalDr, totalCr, drCrDiff,
    balanced: Math.abs(drCrDiff) < 0.01
  };
  // eslint-disable-next-line require-atomic-updates -- F: idempotent cache populate (concurrent fetch overwrites with same data)
  _summaryCache[cacheKey] = summary;
  return summary;
}

// ★ Phase 92.53: close-readiness — completeness (source ในเดือนที่ยังไม่มี JE) + orphan JV (JE ที่ source ถูกลบ).
//   Read-only · reuse _classifyOrphan (กฎ actionable เดียวกับ auto_post — ไม่ drift) · fail-safe (query พลาด → ไม่ false-alarm)
async function fetchCloseReadiness(year, month, fromDate, toDate) {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };
  // exclusive next-day สำหรับ filter created_at (timestamptz)
  const nd = new Date(fromDate + "T00:00:00Z");
  nd.setUTCMonth(nd.getUTCMonth() + 1);
  const toNext = nd.toISOString().slice(0, 10);

  let orphanSrc = 0, orphanJV = 0;
  let srcUnknown = false, jvUnknown = false;   // ★ Phase 579: ตรวจไม่ได้/เกิน cap = unknown = ไม่เขียว (fail-CLOSED)
  const ID_CHUNK = 120;   // batch id=in.(...) กัน URL ยาว fail (mirror je_fetch chunk-by-URL-length)

  // (a) completeness: ขาย/รายจ่ายในเดือนที่ยังไม่มี JE (actionable)
  //   ★ Phase 579: paginate source ids (เกิน 1000 ต้องได้ครบ) + batch id-in + fetch fail → srcUnknown
  //     (เลิก catch{ข้ามเงียบ}→orphanSrc คง 0 = เขียวหลอก). "0 orphan ที่ตรวจครบจริง"=เขียว; "ตรวจไม่ได้"=unknown.
  for (const key of ["sales", "expenses"]) {
    const cat = INTEGRITY_CATS.find(c => c.key === key);
    try {
      const idRows = await fetchAllRowsRaw(
        (off, lim) => `${cfg.url}/rest/v1/${cat.view}?select=id&created_at=gte.${fromDate}&created_at=lt.${toNext}&order=id.asc&limit=${lim}&offset=${off}`,
        headers
      );
      const ids = idRows.map(x => x.id);
      if (!ids.length) continue;   // ไม่มี source ในเดือน = เขียวจริง (ไม่ใช่ fail)
      for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const chunk = ids.slice(i, i + ID_CHUNK).join(",");
        const rows = await fetchAllRowsRaw(
          (off, lim) => `${cfg.url}/rest/v1/${cat.table}?id=in.(${chunk})&select=${cat.sel}&order=id.asc&limit=${lim}&offset=${off}`,
          headers
        );
        for (const row of rows) {
          if (_classifyOrphan(cat, row).bucket === "actionable") orphanSrc++;
        }
      }
    } catch (_e) { srcUnknown = true; }   // ★ fail-CLOSED: ตรวจไม่ได้ → unknown (ไม่เขียว)
  }

  // (b) orphan JV: JE (approved) ในเดือน ที่ source row ถูกลบไปแล้ว (เฉพาะ non-HR sources)
  //   ★ Phase 579: paginate journal_entries (เกิน 1000 ต้องได้ครบ) + batch existence check + fetch fail → jvUnknown
  //     (เลิก er.ok? Set : Set(uniq) ที่ "ถือว่ามีครบ" = เขียวหลอก). existence จริงตรวจไม่ได้ = unknown.
  try {
    const jes = await fetchAllRowsRaw(
      (off, lim) => `${cfg.url}/rest/v1/journal_entries?select=source_table,source_id&doc_date=gte.${fromDate}&doc_date=lte.${toDate}&status=eq.approved&source_table=in.(${READINESS_JV_SOURCES.join(",")})&source_id=not.is.null&order=id.asc&limit=${lim}&offset=${off}`,
      headers
    );
    const byTable = {};
    for (const j of jes) {
      if (!byTable[j.source_table]) byTable[j.source_table] = [];
      byTable[j.source_table].push(String(j.source_id));
    }
    for (const table of Object.keys(byTable)) {
      const uniq = [...new Set(byTable[table])];
      const exist = new Set();
      for (let i = 0; i < uniq.length; i += ID_CHUNK) {
        const chunk = uniq.slice(i, i + ID_CHUNK).join(",");
        const rows = await fetchAllRowsRaw(
          (off, lim) => `${cfg.url}/rest/v1/${table}?id=in.(${chunk})&select=id&order=id.asc&limit=${lim}&offset=${off}`,
          headers
        );
        for (const r of rows) exist.add(String(r.id));
      }
      for (const sid of uniq) if (!exist.has(sid)) orphanJV++;
    }
  } catch (_e) { jvUnknown = true; }   // ★ fail-CLOSED: existence ตรวจไม่ได้ → unknown (ไม่เขียว)

  // (c) Phase 390: service revenue completeness — งานบริการที่ปิดแล้วในเดือนนี้ ที่ยังไม่มี JE (จับด้วย source_id).
  //     ★ ต่างจาก (a)/(b): fetch fail → serviceUnknown=true (ไม่เขียว) ไม่ใช่ fail-safe-green —
  //       เพราะรายได้บริการที่หายคือบั๊กที่หน้านี้ต้องไม่ปิดเงียบ.
  let serviceMissing = 0, serviceUnknown = false;
  try {
    const svc = await fetchServiceJVStatus({ fromDate, toDate });
    if (svc.ok) serviceMissing = (svc.orphans || []).length;
    else serviceUnknown = true;
  } catch (_e) { serviceUnknown = true; }

  return {
    orphanSrc, orphanJV, serviceMissing, serviceUnknown, srcUnknown, jvUnknown,
    // ★ Phase 579: unknown ใด ๆ (ตรวจไม่ได้) = ไม่เขียว — กัน "ปิดงวดได้ ✅" หลอกตอน network สะดุด/เกิน cap
    ready: orphanSrc === 0 && orphanJV === 0 && serviceMissing === 0 && !serviceUnknown && !srcUnknown && !jvUnknown,
  };
}

async function lockPeriod(year, month) {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const userEmail = window._appCurrentUserEmail || "admin";

  const summary = await fetchPeriodSummary(year, month);

  // upsert (insert if not exists, update if exists)
  const existing = _periods.find(p => p.year === year && p.month === month);
  const payload = {
    year, month,
    status: "locked",
    locked_at: new Date().toISOString(),
    locked_by: userEmail,
    total_revenue: summary.revenue,
    total_expense: summary.expense,
    net_income: summary.net,
    jv_count: summary.jvCount,
    updated_at: new Date().toISOString()
  };

  let url = `${cfg.url}/rest/v1/accounting_periods`;
  let method = "POST";
  const headers = {
    "Content-Type": "application/json",
    "apikey": cfg.anonKey,
    "Authorization": "Bearer " + token,
    "Prefer": "return=representation"
  };
  if (existing) {
    url = `${cfg.url}/rest/v1/accounting_periods?id=eq.${existing.id}`;
    method = "PATCH";
  }

  const r = await fetch(url, { method, headers, body: JSON.stringify(payload) });
  if (!r.ok) {
    const err = await r.text();
    throw new Error("Lock failed: " + err.slice(0, 200));
  }
  return await r.json();
}

async function unlockPeriod(year, month, reason) {
  if (!reason || reason.trim().length < 5) {
    throw new Error("ต้องกรอกเหตุผลปลดล็อกอย่างน้อย 5 ตัวอักษร");
  }
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const userEmail = window._appCurrentUserEmail || "admin";

  const existing = _periods.find(p => p.year === year && p.month === month);
  if (!existing) throw new Error("ไม่พบ period นี้ในระบบ");

  const payload = {
    status: "open",
    unlock_reason: reason.trim(),
    unlock_at: new Date().toISOString(),
    unlock_by: userEmail,
    updated_at: new Date().toISOString()
  };

  const r = await fetch(`${cfg.url}/rest/v1/accounting_periods?id=eq.${existing.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "apikey": cfg.anonKey,
      "Authorization": "Bearer " + token,
      "Prefer": "return=representation"
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error("Unlock failed: " + err.slice(0, 200));
  }
  return await r.json();
}

// ───────────────────────────────────────────────────────────
// MAIN render
// ───────────────────────────────────────────────────────────
export async function renderPeriodsPage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-accounting_periods");
  if (!container) return;

  container.innerHTML = `<div class="panel"><div style="text-align:center;padding:40px;color:#64748b">⏳ กำลังโหลดข้อมูล...</div></div>`;

  try {
    _periods = await fetchPeriods();
  } catch (e) {
    container.innerHTML = `
      <div class="panel">
        <div style="background:#fef2f2;border:1px solid #fecaca;padding:14px;border-radius:10px;color:#991b1b">
          ❌ โหลดข้อมูลไม่สำเร็จ — กรุณา run SQL <code>supabase-phase88-19-period-close.sql</code> ก่อน<br>
          <small style="color:#7f1d1d">${escHtml(e.message)}</small>
        </div>
      </div>`;
    return;
  }

  // Active year — เริ่มจากปีล่าสุดที่มี data หรือปีปัจจุบัน
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;  // 1-12
  const years = [...new Set(_periods.map(p => p.year))];
  if (!years.includes(currentYear)) years.unshift(currentYear);
  if (!_activeYear || !years.includes(_activeYear)) _activeYear = currentYear;

  // คำนวณ summary + readiness ทุกเดือนของ active year (parallel)
  const summaries = {};
  const readiness = {};
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => i + 1).map(async (m) => {
      try {
        summaries[m] = await fetchPeriodSummary(_activeYear, m);
      } catch (e) {
        // eslint-disable-next-line require-atomic-updates -- fallback write (distinct key summaries[m]) in catch; no cross-iteration race
        summaries[m] = { revenue: 0, expense: 0, net: 0, jvCount: 0 };
      }
      // ★ Phase 390 (Codex): ตรวจ readiness ทุกเดือนที่ไม่ใช่อนาคต — ไม่ใช่เฉพาะ jvCount>0.
      //   เดือนที่มี service job ปิดแล้วแต่ยังไม่มี JE และไม่มี JV อื่นเลย (jvCount=0)
      //   ต้องถูกตรวจด้วย ไม่งั้นการ์ดขึ้น "ไม่มีรายการในเดือนนี้" ลวงทั้งที่ควร not-ready.
      const isFuture = _activeYear > currentYear || (_activeYear === currentYear && m > currentMonth);
      if (!isFuture) {
        const fromDate = `${_activeYear}-${String(m).padStart(2, "0")}-01`;
        const lastDay = new Date(_activeYear, m, 0).getDate();
        const toDate = `${_activeYear}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        try {
          readiness[m] = await fetchCloseReadiness(_activeYear, m, fromDate, toDate);
        } catch (_e) { /* readiness optional — การ์ดยังแสดง summary ได้ */ }
      }
    })
  );

  container.innerHTML = `
    <div class="panel" style="max-width:1100px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <span style="font-size:28px">🔒</span>
        <div>
          <h2 style="margin:0;font-size:20px;color:#0f172a">ปิดงวดบัญชี (Period Close)</h2>
          <div style="font-size:12px;color:#64748b">ล็อกงวดเดือน → กันแก้ JV ย้อนหลัง · Defense in depth (UI + DB trigger)</div>
        </div>
      </div>

      <!-- Year selector -->
      <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center">
        <span style="font-size:13px;color:#475569;font-weight:600">ปี:</span>
        ${years.map(y => `
          <button class="period-year-btn" data-year="${y}" style="padding:6px 14px;border-radius:14px;border:1px solid ${_activeYear===y?'#0284c7':'#cbd5e1'};background:${_activeYear===y?'#0284c7':'#fff'};color:${_activeYear===y?'#fff':'#475569'};cursor:pointer;font-size:13px;font-weight:600">${y}</button>
        `).join("")}
      </div>

      <!-- 12-month grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
        ${Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
          const period = _periods.find(p => p.year === _activeYear && p.month === m);
          const isLocked = period?.status === "locked";
          const summary = summaries[m] || { revenue: 0, expense: 0, net: 0, jvCount: 0 };
          const rd = readiness[m] || null;
          const hasJv = summary.jvCount > 0;
          // ★ Phase 390 (Codex): เดือนที่ jvCount=0 แต่มี service job ค้าง/unknown ต้องไม่ดูเหมือนเดือนว่าง
          const needsAttention = _monthNeedsAttention(rd);
          const monthLabel = MONTHS_TH[m - 1];

          const bg = isLocked ? "#fef2f2" : (needsAttention ? "#fffbeb" : (hasJv ? "#f0fdf4" : "#f8fafc"));
          const border = isLocked ? "#fecaca" : (needsAttention ? "#fde68a" : (hasJv ? "#bbf7d0" : "#e2e8f0"));
          const accent = isLocked ? "#991b1b" : (needsAttention ? "#92400e" : (hasJv ? "#166534" : "#64748b"));
          const statusPill = isLocked ? "🔒 ล็อก" : (needsAttention ? "⚠️ ต้องตรวจ" : (hasJv ? "🟢 เปิด" : "—"));

          return `
            <div data-period-card="${_activeYear}-${m}" style="background:${bg};border:1px solid ${border};border-radius:10px;padding:12px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div style="font-size:14px;font-weight:700;color:${accent}">${monthLabel} ${_activeYear}</div>
                <div style="font-size:11px;font-weight:600;color:${accent}">${statusPill}</div>
              </div>
              ${hasJv ? `
                <div style="font-size:11px;color:#475569;line-height:1.6">
                  <div>รายได้: <b style="color:#10b981">${money(summary.revenue)}</b></div>
                  <div>ค่าใช้จ่าย: <b style="color:#ef4444">${money(summary.expense)}</b></div>
                  <div>${summary.net >= 0 ? '✅ กำไร' : '⚠️ ขาดทุน'}: <b style="color:${summary.net >= 0 ? '#10b981' : '#ef4444'}">${money(Math.abs(summary.net))}</b></div>
                  <div style="color:#64748b;margin-top:4px">JV ${summary.jvCount} รายการ</div>
                  <div style="margin-top:4px;font-weight:600;color:${summary.balanced ? '#166534' : '#b91c1c'}">${summary.balanced ? '⚖️ Dr=Cr บาลานซ์ ✅' : `⚖️ Dr≠Cr ⚠️ ต่าง ฿${money(Math.abs(summary.drCrDiff))}`}</div>
                  ${_readinessLinesHtml(rd)}
                </div>
              ` : needsAttention ? `
                <div style="font-size:11px;color:#92400e;line-height:1.6">
                  <div style="font-weight:700">ยังไม่มี JV ในเดือนนี้ แต่มีรายการที่ควรเข้าบัญชี:</div>
                  ${_readinessLinesHtml(rd)}
                  <div style="color:#64748b;margin-top:4px">→ ไปที่ "ตรวจรายได้งานบริการเข้าบัญชี" เพื่อส่งเข้าบัญชี</div>
                </div>
              ` : `
                <div style="font-size:11px;color:#94a3b8;font-style:italic">ไม่มีรายการในเดือนนี้</div>
              `}
              <div style="margin-top:10px;display:flex;gap:6px">
                ${isLocked ? `
                  <button class="period-unlock-btn" data-y="${_activeYear}" data-m="${m}" style="flex:1;padding:6px 10px;background:#fff;border:1px solid #f59e0b;color:#92400e;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600">🔓 ปลดล็อก</button>
                ` : hasJv ? `
                  <button class="period-lock-btn" data-y="${_activeYear}" data-m="${m}" style="flex:1;padding:6px 10px;background:#0284c7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600">🔒 ปิดงวด</button>
                ` : ''}
              </div>
              ${isLocked && period?.locked_at ? `
                <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #fecaca;font-size:10px;color:#7f1d1d">
                  ปิดเมื่อ ${new Date(period.locked_at).toLocaleString("th-TH")}<br>
                  โดย ${escHtml(period.locked_by || "?")}
                  ${period.unlock_reason ? `<br>↩️ เคยปลดล็อก: ${escHtml(period.unlock_reason)}` : ''}
                </div>
              ` : ''}
            </div>
          `;
        }).join("")}
      </div>

      <!-- Info note -->
      <div style="margin-top:18px;padding:12px;background:#fef3c7;border:1px solid #fde68a;border-radius:10px;font-size:12px;color:#78350f;line-height:1.7">
        <b>💡 วิธีใช้งาน:</b><br>
        1. <b>ปิดงวด</b> → ตอนสิ้นเดือนหลังตรวจสอบรายการครบแล้ว<br>
        2. <b>ปลดล็อก</b> → ทำได้ถ้าจำเป็น (กรอกเหตุผล) — ระบบ log audit trail<br>
        3. <b>เมื่อล็อก</b> → ห้าม insert/update JV ในงวดนั้น (ยกเว้น void อนุญาตเพราะเป็น soft delete)<br>
        4. <b>Defense in depth</b> — ทั้ง front-end (auto_post.js) + back-end (DB trigger) check
      </div>
    </div>
  `;

  // Wire events
  container.querySelectorAll("[data-year]").forEach(btn => {
    btn.addEventListener("click", () => {
      _activeYear = parseInt(btn.dataset.year, 10);
      _summaryCache = {};  // reset cache เพราะเปลี่ยนปี
      renderPeriodsPage(_ctx);
    });
  });

  container.querySelectorAll(".period-lock-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const y = parseInt(btn.dataset.y, 10);
      const m = parseInt(btn.dataset.m, 10);
      const summary = summaries[m];
      // ★ Phase 92.53: close-readiness gate — warn (soft-close) ถ้ายังไม่พร้อมก่อนล็อก
      const rd = readiness[m] || null;
      const issues = [];
      if (!summary.balanced) issues.push(`Dr≠Cr ต่าง ฿${money(Math.abs(summary.drCrDiff))}`);
      if (rd && rd.orphanSrc > 0) issues.push(`${rd.orphanSrc} บิลยังไม่มี JE`);
      if (rd && rd.orphanJV > 0) issues.push(`orphan JV ${rd.orphanJV} รายการ`);
      if (rd && rd.serviceMissing > 0) issues.push(`งานบริการ ${rd.serviceMissing} งานยังไม่เข้าบัญชี`);
      if (rd && rd.serviceUnknown) issues.push(`ตรวจงานบริการไม่ได้ (unknown)`);
      // ★ Phase 579: บิล/orphan-JV ตรวจไม่ได้ = ยังไม่พร้อมปิด (confirm dialog ต้องไม่บอก "✅ พร้อมปิด" หลอก)
      if (rd && rd.srcUnknown) issues.push(`ตรวจบิลไม่ได้ (unknown)`);
      if (rd && rd.jvUnknown) issues.push(`ตรวจ orphan JV ไม่ได้ (unknown)`);
      const warn = issues.length ? `\n🔴 เตือน: งวดนี้ยังไม่พร้อม — ${issues.join(" · ")} (ควรแก้ก่อนปิด)\n` : '';
      const msg = `ยืนยันปิดงวด ${MONTHS_TH[m-1]} ${y}?\n\n` +
        `📊 Summary:\n` +
        `  รายได้: ${money(summary.revenue)}\n` +
        `  ค่าใช้จ่าย: ${money(summary.expense)}\n` +
        `  ${summary.net >= 0 ? 'กำไร' : 'ขาดทุน'}: ${money(Math.abs(summary.net))}\n` +
        `  JV ${summary.jvCount} รายการ\n` +
        `  ${issues.length === 0 ? '✅ พร้อมปิด (Dr=Cr · บิล + งานบริการครบ)' : '⚠️ มีข้อค้าง'}\n` +
        warn +
        `\n⚠️ หลังปิดงวด — ห้ามแก้/สร้าง JV ในงวดนี้ (เว้นแต่ปลดล็อก)`;
      if (typeof window.App?.confirm !== "function") {
        _ctx.showToast?.("ระบบยืนยันยังไม่พร้อม กรุณาลองใหม่");
        return;
      }
      if (!(await window.App.confirm(msg))) return;

      btn.disabled = true;
      btn.textContent = "🔄 กำลังปิด...";
      try {
        await lockPeriod(y, m);
        _ctx.showToast?.("ปิดงวดสำเร็จ ✅");
        await renderPeriodsPage(_ctx);
      } catch (e) {
        _ctx.showToast?.("ปิดงวดไม่สำเร็จ: " + e.message);
        /* eslint-disable require-atomic-updates -- A: UI rollback in catch (sequential error path, single admin click) */
        btn.disabled = false;
        btn.textContent = "🔒 ปิดงวด";
        /* eslint-enable require-atomic-updates */
      }
    });
  });

  container.querySelectorAll(".period-unlock-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const y = parseInt(btn.dataset.y, 10);
      const m = parseInt(btn.dataset.m, 10);
      const reason = prompt(`ปลดล็อกงวด ${MONTHS_TH[m-1]} ${y}\n\nกรุณากรอกเหตุผล (บันทึก audit log):`, "");
      if (!reason || reason.trim().length < 5) {
        _ctx.showToast?.("ต้องกรอกเหตุผลอย่างน้อย 5 ตัวอักษร");
        return;
      }

      btn.disabled = true;
      btn.textContent = "🔄 กำลังปลดล็อก...";
      try {
        await unlockPeriod(y, m, reason);
        _ctx.showToast?.("ปลดล็อกงวดสำเร็จ ✅");
        await renderPeriodsPage(_ctx);
      } catch (e) {
        _ctx.showToast?.("ปลดล็อกไม่สำเร็จ: " + e.message);
        /* eslint-disable require-atomic-updates -- A: UI rollback in catch (sequential error path, single admin click) */
        btn.disabled = false;
        btn.textContent = "🔓 ปลดล็อก";
        /* eslint-enable require-atomic-updates */
      }
    });
  });
}
