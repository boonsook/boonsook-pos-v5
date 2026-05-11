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
  postJournalForDeliveryInvoice
} from "./auto_post.js";
import { todayBkk, dateBkk } from "../utils.js";

let _ctx = null;
let _running = false;

const SOURCES = [
  { key: "sales",              label: "🛒 การขาย POS",            table: "sales",              dateField: "created_at",   docType: "SV" },
  { key: "expenses",           label: "💸 รายจ่าย",               table: "expenses",           dateField: "expense_date", docType: "PV" },
  { key: "delivery_invoices",  label: "🧾 ใบส่งสินค้า (B2B)",     table: "delivery_invoices",  dateField: "created_at",   docType: "SV" },
  { key: "receipts",           label: "💰 ใบเสร็จ (paid)",        table: "receipts",           dateField: "receipt_date", docType: "RV" },
  { key: "service_jobs",       label: "🔧 งานช่าง (closed)",      table: "service_jobs",       dateField: "created_at",   docType: "SV" }
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

      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;color:#78350f;line-height:1.7">
        <b>⚠️ ก่อนรัน:</b> ระบบ idempotent (call ซ้ำไม่สร้างซ้ำ) — แต่ <b>ทดสอบ range เล็กก่อน</b> (สัก 1 วัน) เพื่อยืนยัน mapping ถูกต้องทุกหมวด<br>
        Effective date: <b>2026-05-01</b> — rows ก่อนหน้านี้จะถูก skip อัตโนมัติ (Phase 88.18b)
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

  const cutoff = "2026-05-01";  // Phase 88.18b: production start date (เลื่อนจาก 2026-01-01)
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
          case "sales":              result = await postJournalForSale(row);             break;
          case "expenses":           result = await postJournalForExpense(row);          break;
          case "delivery_invoices":  result = await postJournalForDeliveryInvoice(row);  break;
          case "receipts":           result = await postJournalForReceipt(row);          break;
          case "service_jobs":       result = await postJournalForServiceJob(row);       break;
        }
        if (result) stats.created++;
        else        stats.skipped++;  // null = duplicate / before effective / no mapping
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
      <div style="margin-top:10px;font-size:12px;color:#64748b">→ ไป <a href="#" onclick="event.preventDefault();document.querySelector('[data-route=accounting_journals]')?.click()" style="color:#0284c7;font-weight:700">📒 สมุดรายวัน</a> เพื่อตรวจ JV ที่สร้างใหม่</div>
    </div>
  `;

  _running = false;
  if (btnRun) { btnRun.disabled = false; btnRun.textContent = "⚡ เริ่ม Backfill"; }
}
