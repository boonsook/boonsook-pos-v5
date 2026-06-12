// ═══════════════════════════════════════════════════════════
//  backfill.js — Backfill JV ย้อนหลัง (Phase 88.1b)
//
//  ปัญหา: rows ที่บันทึกก่อน Phase 88.1a deploy → ไม่มี JV ใน journal_entries
//         → trial balance ไม่ครบ
//  วิธีแก้: ติ๊ก source + date range → loop call postJournalForX ทุก row
//          (idempotent — call ซ้ำได้ ผ่าน partial unique index)
//
//  Sources supported:
//    - sales         → SV (postJournalForSale)
//    - expenses      → PV (postJournalForExpense)
//    - receipts      → RV (เฉพาะ status=paid) (postJournalForReceipt)
//    - service_jobs  → SV (เฉพาะ status in done/delivered/closed) (postJournalForServiceJob)
// ═══════════════════════════════════════════════════════════

import {
  postJournalForSale,
  postJournalForExpense,
  postJournalForReceipt,
  postJournalForServiceJob,
  // Phase 408 cash-basis: ไม่ import postJournalForDeliveryInvoice แล้ว (delivery_invoices skip — ไม่ post revenue)
  _isAfterEffective
} from "./auto_post.js";
import { todayBkk, dateBkk } from "../utils.js";
// ★ Phase 413: cutoff = single source of truth (เริ่มบัญชีจริง 1 ก.ค. 2569)
import { ACCOUNTING_EFFECTIVE_DATE } from "./effective_date.js";
// Phase 390: รวม service_jobs missing-JV เข้า integrity panel (RPC summary ไม่ครอบ service_jobs)
import { fetchServiceJVStatus } from "../service_reconcile.js";

let _ctx = null;
let _running = false;

const SOURCES = [
  { key: "sales",              label: "🛒 การขาย POS",            table: "sales",              dateField: "created_at",   docType: "SV" },
  { key: "expenses",           label: "💸 รายจ่าย",               table: "expenses",           dateField: "expense_date", docType: "PV" },
  { key: "delivery_invoices",  label: "🧾 ใบส่งสินค้า (B2B)",     table: "delivery_invoices",  dateField: "created_at",   docType: "SV" },
  { key: "receipts",           label: "💰 ใบเสร็จ (paid)",        table: "receipts",           dateField: "receipt_date", docType: "RV" },
  { key: "service_jobs",       label: "🔧 งานช่าง (closed)",      table: "service_jobs",       dateField: "created_at",   docType: "SV" }
];

// ★ Phase 92.48: Accounting Integrity — classify orphans (no JE) into actionable vs intentionally-skipped.
//   Mirrors auto_post "should post" rule EXACTLY (imports _isAfterEffective) → zero drift.
//   docDate/amount field extraction matches postJournalForSale/Expense/Payroll.
export const INTEGRITY_CATS = [
  { key: "sales",    label: "🛒 การขาย",    table: "sales",         view: "vw_sales_without_journal",    countKey: "sales_without_journal",
    sel: "*", docDate: r => r.created_at,                     amount: r => (r.total_amount ?? r.grand_total) },
  { key: "expenses", label: "💸 รายจ่าย",   table: "expenses",      view: "vw_expenses_without_journal", countKey: "expenses_without_journal",
    sel: "*",      docDate: r => (r.expense_date || r.created_at), amount: r => r.amount },
  { key: "payroll",  label: "👷 เงินเดือน", table: "staff_payroll", view: "vw_payroll_without_journal",   countKey: "payroll_without_journal",
    sel: "*",     docDate: r => (r.paid_at || r.created_at),      amount: r => r.total_amount },
];

function escHtml(s) { const d = document.createElement("div"); d.textContent = String(s ?? ""); return d.innerHTML; }
// Phase 89.1: ใช้ Bangkok time (todayBkk) — กัน default ผิดวันตอนใกล้เที่ยงคืน
function todayStr() { return todayBkk(); }
function defaultFrom() {
  // 30 วันย้อนหลัง — สมเหตุสมผลสำหรับ "ตามให้ทัน"
  const d = new Date(); d.setDate(d.getDate() - 30);
  return dateBkk(d);
}

export function renderBackfillPage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-accounting_backfill");
  if (!container) return;

  container.innerHTML = `
    <div class="panel" style="max-width:880px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <span style="font-size:28px">⏪</span>
        <div>
          <h2 style="margin:0;font-size:20px;color:#0f172a">Backfill รายการบัญชีย้อนหลัง</h2>
          <div style="font-size:12px;color:#64748b">สร้าง JV จาก ขาย/รายจ่าย/ใบเสร็จ/งานช่าง ที่บันทึกก่อน Phase 88.1a deploy — ทำให้ trial balance ครบจริง</div>
        </div>
      </div>

      <!-- ★ Phase 92.48: Integrity status (actionable vs intentionally-skipped) -->
      <div id="bfIntegrityCard" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">
          <div style="font-weight:700;color:#0f172a">🩺 สถานะความครบของบัญชี (Integrity)</div>
          <button id="bfIntegrityRefresh" class="btn light" style="font-size:12px;padding:4px 10px">🔄 ตรวจใหม่</button>
        </div>
        <div id="bfIntegrityPanel"><div style="color:#64748b;font-size:13px">⏳ กำลังตรวจ...</div></div>
      </div>

      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;color:#78350f;line-height:1.7">
        <b>⚠️ ก่อนรัน:</b> ระบบ idempotent (call ซ้ำไม่สร้างซ้ำ) — แต่ <b>ทดสอบ range เล็กก่อน</b> (สัก 1 วัน) เพื่อยืนยัน mapping ถูกต้องทุกหมวด<br>
        Effective date: <b>${ACCOUNTING_EFFECTIVE_DATE}</b> — rows ก่อนหน้านี้จะถูก skip อัตโนมัติ (Phase 413: เริ่มบัญชีจริง 1 ก.ค. 2569)
      </div>

      <!-- Source picker -->
      <div style="margin-bottom:14px">
        <label style="display:block;font-weight:600;margin-bottom:6px;color:#1f2937">1) เลือก source</label>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">
          ${SOURCES.map(s => `
            <label style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f8fafc;border:2px solid #e2e8f0;border-radius:10px;cursor:pointer;font-size:13px;color:#334155" data-bf-src="${s.key}">
              <input type="checkbox" name="bfSource" value="${s.key}" style="cursor:pointer" />
              ${s.label} <small style="color:#94a3b8">(${s.docType})</small>
            </label>
          `).join("")}
        </div>
      </div>

      <!-- Date range -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
        <div>
          <label style="display:block;font-weight:600;margin-bottom:6px;color:#1f2937">2) จากวันที่</label>
          <input type="date" id="bfFrom" value="${defaultFrom()}" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px" />
        </div>
        <div>
          <label style="display:block;font-weight:600;margin-bottom:6px;color:#1f2937">ถึงวันที่</label>
          <input type="date" id="bfTo" value="${todayStr()}" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px" />
        </div>
      </div>

      <!-- Action buttons -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <button id="bfPreviewBtn" class="btn light">👁 ดูรายการที่จะ process</button>
        <button id="bfRunBtn" class="btn primary">⚡ เริ่ม Backfill</button>
      </div>

      <!-- Preview / Result panel -->
      <div id="bfResultPanel" style="margin-top:14px"></div>
    </div>
  `;

  // Wire checkbox visual feedback
  document.querySelectorAll("[data-bf-src]").forEach(label => {
    const cb = label.querySelector("input[type=checkbox]");
    cb?.addEventListener("change", () => {
      label.style.borderColor = cb.checked ? "#3b82f6" : "#e2e8f0";
      label.style.background  = cb.checked ? "#eff6ff" : "#f8fafc";
    });
  });

  document.getElementById("bfPreviewBtn")?.addEventListener("click", _onPreview);
  document.getElementById("bfRunBtn")?.addEventListener("click", _onRun);

  // Phase 92.48: integrity status panel — auto-load + refresh button
  document.getElementById("bfIntegrityRefresh")?.addEventListener("click", _loadIntegrityStatus);
  _loadIntegrityStatus();
}

function _selectedSources() {
  return Array.from(document.querySelectorAll('input[name="bfSource"]:checked')).map(c => c.value);
}

function _getRange() {
  const from = document.getElementById("bfFrom")?.value || "";
  const to   = document.getElementById("bfTo")?.value   || "";
  return { from, to };
}

async function _fetchSourceRows(srcKey, from, to) {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };
  const meta = SOURCES.find(s => s.key === srcKey);
  if (!meta) return [];

  const cutoff = ACCOUNTING_EFFECTIVE_DATE;  // Phase 413: single source of truth (effective_date.js) — เริ่มบัญชีจริง 1 ก.ค. 2569
  const fromEff = (from < cutoff) ? cutoff : from;

  // ★ Fix: 'created_at' เป็น timestamptz → 'lte.YYYY-MM-DD' = midnight ของวันนั้น
  //   → row ที่ created_at = 12:56:24 UTC จะถูก exclude ทั้งที่อยู่ในวันเดียวกัน
  //   วิธีแก้: ใช้ 'lt' กับ next day (exclusive) สำหรับ timestamp fields
  const nextDay = new Date(to + "T00:00:00Z");
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const toExclusive = nextDay.toISOString().slice(0, 10);

  // Filter pieces ตาม source
  let extraFilter = "";
  if (srcKey === "receipts") {
    extraFilter = "&status=eq.paid";
  } else if (srcKey === "service_jobs") {
    extraFilter = "&status=in.(done,delivered,closed)";
  }

  // expense_date / receipt_date = DATE (no time) → lte ปกติ; created_at = TIMESTAMPTZ → lt exclusive
  const isTimestampField = (meta.dateField === "created_at");
  const upperBound = isTimestampField
    ? `${meta.dateField}=lt.${toExclusive}`
    : `${meta.dateField}=lte.${to}`;

  const url = `${cfg.url}/rest/v1/${meta.table}?select=*&${meta.dateField}=gte.${fromEff}&${upperBound}${extraFilter}&order=${meta.dateField}.asc`;
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } catch(e) {
    console.error(`[backfill] fetch ${srcKey} failed:`, e.message);
    return [];
  }
}

async function _fetchExistingJVMap() {
  // Map ของ existing JV: source_table+source_id → 1
  // ใช้ตอน preview เพื่อแยก "จะ create ใหม่" vs "มีอยู่แล้ว"
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  try {
    const r = await fetch(`${cfg.url}/rest/v1/journal_entries?select=source_table,source_id&source_table=not.is.null`, {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token }
    });
    if (!r.ok) return new Set();
    const arr = await r.json();
    return new Set(arr.map(j => `${j.source_table}#${j.source_id}`));
  } catch(_) { return new Set(); }
}

async function _onPreview() {
  const sources = _selectedSources();
  const { from, to } = _getRange();
  const panel = document.getElementById("bfResultPanel");

  if (sources.length === 0) {
    panel.innerHTML = `<div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b">เลือก source อย่างน้อย 1 อัน</div>`;
    return;
  }
  if (!from || !to) {
    panel.innerHTML = `<div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b">กรอกวันที่ from/to ให้ครบ</div>`;
    return;
  }

  panel.innerHTML = `<div style="padding:14px;color:#64748b">⏳ กำลังนับรายการ...</div>`;

  const existingJV = await _fetchExistingJVMap();
  const rows = [];
  for (const srcKey of sources) {
    const items = await _fetchSourceRows(srcKey, from, to);
    rows.push({
      source: srcKey,
      label: SOURCES.find(s => s.key === srcKey)?.label || srcKey,
      total: items.length,
      newCount: items.filter(it => !existingJV.has(`${SOURCES.find(s => s.key === srcKey).table}#${it.id}`)).length
    });
  }

  panel.innerHTML = `
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:14px">
      <div style="font-weight:700;color:#0c4a6e;margin-bottom:10px">📋 Preview — รายการที่จะ process</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#fff;color:#475569">
            <th style="text-align:left;padding:8px;border-bottom:1px solid #e2e8f0">Source</th>
            <th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0">รวม</th>
            <th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0">มี JV แล้ว</th>
            <th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#0284c7">จะสร้างใหม่</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td style="padding:8px;border-bottom:1px solid #f1f5f9">${escHtml(r.label)}</td>
              <td style="padding:8px;text-align:right;border-bottom:1px solid #f1f5f9">${r.total.toLocaleString()}</td>
              <td style="padding:8px;text-align:right;border-bottom:1px solid #f1f5f9;color:#94a3b8">${(r.total - r.newCount).toLocaleString()}</td>
              <td style="padding:8px;text-align:right;border-bottom:1px solid #f1f5f9;font-weight:700;color:#0284c7">${r.newCount.toLocaleString()}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div style="margin-top:10px;font-size:12px;color:#64748b">💡 ระบบ idempotent — call ซ้ำไม่สร้าง JV ซ้ำ (ผ่าน partial unique index)</div>
    </div>
  `;
}

async function _onRun() {
  if (_running) return;
  const sources = _selectedSources();
  const { from, to } = _getRange();
  const panel = document.getElementById("bfResultPanel");
  const btnRun = document.getElementById("bfRunBtn");

  if (sources.length === 0) {
    panel.innerHTML = `<div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b">เลือก source อย่างน้อย 1 อัน</div>`;
    return;
  }
  if (!from || !to) {
    panel.innerHTML = `<div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b">กรอกวันที่ from/to ให้ครบ</div>`;
    return;
  }

  if (!(await window.App?.confirm?.(`ยืนยัน Backfill ${sources.length} source ระหว่าง ${from} → ${to}?`))) return;

  // eslint-disable-next-line require-atomic-updates -- G: _running entry-guard at backfill.js:238 + admin-only idempotent (JV unique by source_id)
  _running = true;
  if (btnRun) { btnRun.disabled = true; btnRun.textContent = "⏳ กำลังรัน..."; }

  const stats = { total: 0, created: 0, exists: 0, skipped: 0, failed: 0 };
  const errors = [];

  panel.innerHTML = `
    <div id="bfProgPanel" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px">
      <div id="bfProgText" style="font-weight:700;color:#0f172a;margin-bottom:8px">⏳ กำลังเริ่ม...</div>
      <div style="background:#e2e8f0;height:10px;border-radius:5px;overflow:hidden">
        <div id="bfProgBar" style="background:linear-gradient(90deg,#3b82f6,#0284c7);height:100%;width:0%;transition:width .2s"></div>
      </div>
      <div id="bfProgDetail" style="font-size:12px;color:#64748b;margin-top:6px">0 / 0</div>
    </div>
  `;

  // 1. Fetch all rows first (per source)
  const buckets = [];
  for (const srcKey of sources) {
    const items = await _fetchSourceRows(srcKey, from, to);
    buckets.push({ srcKey, items });
    stats.total += items.length;
  }

  if (stats.total === 0) {
    document.getElementById("bfProgPanel").innerHTML = `<div style="padding:8px;color:#64748b">ไม่พบรายการในช่วงที่เลือก</div>`;
    // eslint-disable-next-line require-atomic-updates -- G: _running lock release (early exit, entry guard at backfill.js:238)
    _running = false;
    if (btnRun) { btnRun.disabled = false; btnRun.textContent = "⚡ เริ่ม Backfill"; }
    return;
  }

  // 2. Loop + call auto-post
  let processed = 0;
  for (const bucket of buckets) {
    for (const row of bucket.items) {
      try {
        let result = null;
        switch (bucket.srcKey) {
          case "sales":              result = await postJournalForSale(row, { detailed: true });        break;
          case "expenses":           result = await postJournalForExpense(row, { detailed: true });     break;
          // Phase 408 cash-basis: ใบส่งของไม่ลง revenue แล้ว (ย้ายไปที่ใบเสร็จ paid) — skip กัน backfill สร้างรายได้ซ้ำ
          case "delivery_invoices":  result = { status: "skipped", reason: "cash-basis-noop" }; break;
          case "receipts":           result = await postJournalForReceipt(row, { detailed: true });     break;
          case "service_jobs":       result = await postJournalForServiceJob(row, { detailed: true });  break;
        }
        if (result?.status === "posted") stats.created++;
        else if (result?.status === "failed") {
          stats.failed++;
          errors.push({ src: bucket.srcKey, id: row.id, msg: `${result.reason || "failed"}: ${result.error || ""}`.slice(0, 200) });
        } else {
          stats.skipped++;
        }
      } catch (e) {
        stats.failed++;
        errors.push({ src: bucket.srcKey, id: row.id, msg: (e?.message || String(e)).slice(0, 200) });
      }
      processed++;
      const pct = Math.floor((processed / stats.total) * 100);
      const progBar = document.getElementById("bfProgBar");
      const progDetail = document.getElementById("bfProgDetail");
      const progText = document.getElementById("bfProgText");
      if (progBar) progBar.style.width = pct + "%";
      if (progDetail) progDetail.textContent = `${processed} / ${stats.total} — ✅ ${stats.created} · ⏭ ${stats.skipped} · ❌ ${stats.failed}`;
      if (progText) progText.textContent = `⏳ กำลังประมวลผล... (${pct}%)`;
    }
  }

  // 3. Result summary
  panel.innerHTML = `
    <div style="background:${stats.failed === 0 ? '#f0fdf4' : '#fef3c7'};border:1px solid ${stats.failed === 0 ? '#bbf7d0' : '#fde68a'};border-radius:10px;padding:14px">
      <div style="font-weight:700;color:${stats.failed === 0 ? '#166534' : '#78350f'};margin-bottom:10px;font-size:15px">
        ${stats.failed === 0 ? '✅ Backfill เสร็จเรียบร้อย' : '⚠️ Backfill เสร็จ — มี error บางส่วน'}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:10px">
        <div style="background:#fff;padding:10px;border-radius:8px">
          <div style="font-size:11px;color:#64748b">รายการทั้งหมด</div>
          <div style="font-size:20px;font-weight:800;color:#0f172a">${stats.total.toLocaleString()}</div>
        </div>
        <div style="background:#fff;padding:10px;border-radius:8px">
          <div style="font-size:11px;color:#64748b">สร้าง JV ใหม่</div>
          <div style="font-size:20px;font-weight:800;color:#0284c7">${stats.created.toLocaleString()}</div>
        </div>
        <div style="background:#fff;padding:10px;border-radius:8px">
          <div style="font-size:11px;color:#64748b">ข้าม (มี/ก่อน eff date/no map)</div>
          <div style="font-size:20px;font-weight:800;color:#94a3b8">${stats.skipped.toLocaleString()}</div>
        </div>
        <div style="background:#fff;padding:10px;border-radius:8px">
          <div style="font-size:11px;color:#64748b">ล้มเหลว</div>
          <div style="font-size:20px;font-weight:800;color:#dc2626">${stats.failed.toLocaleString()}</div>
        </div>
      </div>
      ${errors.length > 0 ? `
        <details style="margin-top:10px">
          <summary style="cursor:pointer;font-weight:700;color:#dc2626">▼ ดู error ${errors.length} รายการ</summary>
          <div style="margin-top:8px;max-height:200px;overflow-y:auto;background:#fff;border-radius:8px;padding:10px;font-size:12px;font-family:monospace">
            ${errors.map(e => `<div>[${escHtml(e.src)}] #${e.id}: ${escHtml(e.msg)}</div>`).join("")}
          </div>
        </details>
      ` : ''}
      <div style="margin-top:10px;font-size:12px;color:#64748b">→ ไป <a href="#" id="bf-go-journals" style="color:#0284c7;font-weight:700">📒 สมุดรายวัน</a> เพื่อตรวจ JV ที่สร้างใหม่</div>
    </div>
  `;

  // Phase 89.23: bind nav link ผ่าน addEventListener
  document.getElementById("bf-go-journals")?.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelector('[data-route=accounting_journals]')?.click();
  });

  // eslint-disable-next-line require-atomic-updates -- G: _running lock release (final, entry guard at backfill.js:238)
  _running = false;
  if (btnRun) { btnRun.disabled = false; btnRun.textContent = "⚡ เริ่ม Backfill"; }
}

// ═══════════════════════════════════════════════════════════
//  Phase 92.48: Accounting Integrity status panel
//  Reuses accounting_integrity_summary() RPC + vw_*_without_journal views.
//  Buckets each orphan via _classifyOrphan (mirrors auto_post) so the raw
//  count (which includes pre-effective test data + ฿0 rows) isn't alarming.
// ═══════════════════════════════════════════════════════════

function _fmtAmt(n) { return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

// Classify one orphan source row. Mirrors postJournalForSale/Expense/Payroll skip rules:
//   - pre-effective docDate (Bangkok) → auto_post skips      → "skipped"
//   - amount <= 0 / falsy             → auto_post returns null → "skipped"
//   - else                            → auto_post would post   → "actionable"
export function _classifyOrphan(cat, row) {
  // ★ Phase 411 (§4.3): เอกสาร soft-delete (note มี "[ลบแล้ว]") = ข้าม ไม่ใช่ "ต้องแก้"
  //   (JV ถูก void ตอนลบแล้ว — post ใหม่ = รายได้ผี; expenses/payroll ไม่มี marker นี้ = ไม่กระทบ)
  if (String(row.note || "").includes("[ลบแล้ว]")) return { bucket: "skipped", reason: "deleted" };
  const amt = Number(cat.amount(row)) || 0;
  const dRaw = cat.docDate(row);
  const docDate = dRaw ? dateBkk(dRaw) : todayBkk();
  if (!_isAfterEffective(docDate)) return { bucket: "skipped", reason: "pre-effective" };
  if (amt <= 0) return { bucket: "skipped", reason: "zero-amount" };
  return { bucket: "actionable", amount: amt };
}

async function _fetchRowsByIds(cat, ids, headers, cfg) {
  const out = [];
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    try {
      const r = await fetch(`${cfg.url}/rest/v1/${cat.table}?id=in.(${chunk.join(",")})&select=${cat.sel}`, { headers });
      if (r.ok) out.push(...(await r.json()));
    } catch (_) { /* skip chunk on error — counted as unknown below */ }
  }
  return out;
}

async function _loadIntegrityStatus() {
  const panel = document.getElementById("bfIntegrityPanel");
  if (!panel) return;
  panel.innerHTML = `<div style="color:#64748b;font-size:13px">⏳ กำลังตรวจ...</div>`;

  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { apikey: cfg.anonKey, Authorization: "Bearer " + token };

  // 1) RPC summary (admin-only) — raw counts
  let summary;
  try {
    const r = await fetch(`${cfg.url}/rest/v1/rpc/accounting_integrity_summary`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}"
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    summary = await r.json();
  } catch (e) {
    panel.innerHTML = `<div style="padding:10px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;color:#78350f;font-size:12px">ตรวจสถานะไม่ได้: ${escHtml(e.message)} — ต้องเป็น admin/accountant</div>`;
    return;
  }

  // 2) classify orphans per category
  const cats = [];
  for (const cat of INTEGRITY_CATS) {
    const raw = Number(summary[cat.countKey]) || 0;
    const actionable = [];
    let skipped = 0, skippedDeleted = 0, unknown = 0;
    if (raw > 0) {
      let ids = [];
      try {
        const idsRes = await fetch(`${cfg.url}/rest/v1/${cat.view}?select=id`, { headers });
        if (idsRes.ok) ids = (await idsRes.json()).map(x => x.id);
      } catch (_) { /* ids empty */ }
      const rows = ids.length ? await _fetchRowsByIds(cat, ids, headers, cfg) : [];
      for (const row of rows) {
        const c = _classifyOrphan(cat, row);
        if (c.bucket === "actionable") actionable.push({ id: row.id, amount: c.amount });
        else {
          skipped++;
          // ★ Phase 411: แยกนับบิลลบแล้ว ให้ owner เห็นว่า "ข้าม" มาจากอะไร
          if (c.reason === "deleted") skippedDeleted++;
        }
      }
      unknown = Math.max(0, ids.length - rows.length);
    }
    cats.push({ key: cat.key, label: cat.label, raw, actionable, skipped, skippedDeleted, unknown });
  }

  // 2.5) Phase 390: service_jobs missing-JV — RPC summary/INTEGRITY_CATS ไม่ครอบ service_jobs.
  //   ตรวจผ่าน detector เดียวกับ Service Reconcile (source_id match) เพื่อไม่ให้ภาพรวมเขียวลวง.
  //   fetch fail → svcUnknown (นับเป็น unknown ไม่เขียว) ตรงกับ readiness ใน periods.js
  let svcMissing = 0, svcUnknown = false;
  try {
    const svc = await fetchServiceJVStatus({});
    if (svc.ok) svcMissing = (svc.orphans || []).length;
    else svcUnknown = true;
  } catch (_) { svcUnknown = true; }

  // 3) render
  const totalActionable = cats.reduce((s, c) => s + c.actionable.length, 0) + svcMissing;
  const totalUnknown = cats.reduce((s, c) => s + c.unknown, 0) + (svcUnknown ? 1 : 0);
  const checked = summary.checked_at ? String(summary.checked_at).slice(0, 16).replace("T", " ") : "";

  const chips = cats.map(c => `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:12px">
      <div style="color:#475569;font-weight:600">${escHtml(c.label)}</div>
      <div style="color:#94a3b8">ไม่มี JE: <b style="color:#0f172a">${c.raw.toLocaleString()}</b></div>
      <div style="color:${c.actionable.length ? "#dc2626" : "#16a34a"}">ต้องแก้: <b>${c.actionable.length.toLocaleString()}</b> · ข้าม: ${c.skipped.toLocaleString()}${c.skippedDeleted ? ` (ลบแล้ว: ${c.skippedDeleted.toLocaleString()})` : ""}${c.unknown ? ` · ?: ${c.unknown}` : ""}</div>
    </div>`).join("")
    // Phase 390: service_jobs chip (แยก เพราะมาคนละแหล่ง — ดู Service Reconcile สำหรับรายการ + ปุ่ม re-post)
    + `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:12px">
      <div style="color:#475569;font-weight:600">🔧 งานช่าง (รายได้)</div>
      <div style="color:#94a3b8">ตรวจด้วย source_id (Service Reconcile)</div>
      <div style="color:${svcUnknown ? '#b45309' : (svcMissing ? '#dc2626' : '#16a34a')}">${svcUnknown ? 'ตรวจไม่ได้: ?' : `ยังไม่เข้าบัญชี: <b>${svcMissing.toLocaleString()}</b>`}</div>
    </div>`;

  // Phase 390: บรรทัดบอกว่า service_jobs ตรวจแยกจาก RPC summary — ดู Service Reconcile สำหรับรายการ + ปุ่ม re-post
  const svcNote = `<div style="font-size:12px;color:#64748b;margin-top:6px">🔧 งานช่าง (รายได้บริการ) ตรวจแยกด้วย source_id — ${svcUnknown ? 'รอบนี้ <b>ตรวจไม่ได้</b> (unknown)' : (svcMissing ? `พบ <b style="color:#dc2626">${svcMissing.toLocaleString()}</b> งานยังไม่เข้าบัญชี` : 'ครบ')} · ดู/แก้ที่หน้า <b>“ตรวจรายได้งานบริการเข้าบัญชี”</b> (Service Reconcile)</div>`;

  let head;
  if (totalActionable === 0 && totalUnknown === 0) {
    head = `<div style="padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;color:#166534;font-weight:700">🟢 ธุรกรรมจริงมี JE ครบ — ไม่มีรายการค้างที่ต้อง backfill (รวมงานบริการ)</div>
            <div style="font-size:12px;color:#64748b;margin-top:6px">รายการที่ "ไม่มี JE" ที่เหลือเป็น test/ก่อน go-live (ก่อน ${ACCOUNTING_EFFECTIVE_DATE}) หรือยอด ฿0 — ระบบข้ามถูกต้อง</div>
            ${svcNote}`;
  } else if (totalActionable > 0) {
    const list = cats.filter(c => c.actionable.length).map(c =>
      `<div style="margin-top:4px"><b>${escHtml(c.label)}</b>: ${c.actionable.slice(0, 30).map(a => `#${escHtml(a.id)} (฿${_fmtAmt(a.amount)})`).join(", ")}${c.actionable.length > 30 ? ` … +${c.actionable.length - 30}` : ""}</div>`
    ).join("");
    head = `<div style="padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-weight:700">🔴 พบ ${totalActionable.toLocaleString()} รายการจริงที่ควรมี JE แต่ยังไม่มี${svcMissing ? ` (รวมงานบริการ ${svcMissing.toLocaleString()})` : ''}</div>
            <div style="font-size:12px;color:#7f1d1d;margin-top:6px">${list}</div>
            <div style="font-size:12px;color:#64748b;margin-top:6px">→ ใช้เครื่องมือ Backfill ด้านล่าง: เลือก source ที่เกี่ยว + ครอบช่วงวันที่ของรายการ แล้วกด "เริ่ม Backfill"</div>
            ${svcNote}`;
  } else {
    head = `<div style="padding:10px 12px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;color:#78350f;font-weight:700">🟡 ตรวจได้บางส่วน — มี ${totalUnknown.toLocaleString()} รายการที่ classify ไม่ได้ (ลองกด "ตรวจใหม่")</div>
            ${svcNote}`;
  }

  panel.innerHTML = `${head}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px">${chips}</div>
    ${checked ? `<div style="font-size:11px;color:#94a3b8;margin-top:8px">ตรวจเมื่อ ${escHtml(checked)} (เวลา DB · UTC)</div>` : ""}`;
}
