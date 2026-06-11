// Phase 418 (Part C) — payroll history + print-all-slips guard (build 418)
// Run: node --test tests/payroll_partc_guard.test.js
//
// Why this exists:
//   Part C ปิดชุดเงินเดือน: (1) ประวัติเงินเดือนย้อนหลังรายคน (read-only modal + เปิดสลิปเก่า)
//   (2) ปุ่ม "พิมพ์สลิปทุกคน" ของรอบปัจจุบัน. guard นี้ล็อก:
//   (1) buildPayslipHtml/buildPayslipStyleCss (extract จาก _printPayslip) — unit จริง:
//       ชื่อ/ยอด escape แล้ว, 2 copy (ต้นฉบับ/สำเนา), fallback label จาก period_month
//   (2) ประวัติ: fetch ครั้งเดียว employee_id=eq + order period_start.desc.nullslast + limit 24
//       + fallback period_month label + ปุ่มสลิปส่ง row ตรงให้ _printPayslip
//   (3) print-all: loop จาก _payrolls ของรอบ + page-break + reuse builders
//   (4) code ใหม่ทั้งหมด read-only + print — ❌ ไม่มี POST/PATCH/PUT/DELETE ใหม่
//   (5) _printPayslip ประกอบจาก builders (byte-preserving) + รับ rowOverride
//   (6) ไม่มี native alert()

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { buildPayslipHtml, buildPayslipStyleCss } = await import("../modules/payroll.js");

const src = fs.readFileSync(path.resolve("modules/payroll.js"), "utf8");

// helper: extract block ระหว่าง marker เปิด → marker ถัดไป (กัน false positive จากส่วนอื่น)
function extractBetween(startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `source must contain "${startMarker}"`);
  const e = src.indexOf(endMarker, s + startMarker.length);
  assert.ok(e > s, `source must contain "${endMarker}" after "${startMarker}"`);
  return src.slice(s, e);
}

// ═══════════════════════════════════════════════════════════
//  1. buildPayslipHtml / buildPayslipStyleCss — unit จริง (pure, no DOM/network)
// ═══════════════════════════════════════════════════════════

const ROW = {
  id: 7,
  employee_id: "e1",
  period_start: "2026-06-11",
  period_end: "2026-06-25",
  period_month: "2026-06-01",
  base_salary: 5200, overtime: 300, welfare: 0, bonus: 0, commission: 0, deductions: 100,
  total_amount: 5400,
  paid_at: null,
};
const EMP = { full_name: "สมชาย <b>x</b>", role: "staff" };
const STORE = { name: "ร้านทดสอบ" };

test("buildPayslipHtml: มีชื่อ (escape แล้ว) + ยอดสุทธิ + 2 copy ต้นฉบับ/สำเนา + label รอบจริง", () => {
  const html = buildPayslipHtml(ROW, { emp: EMP, dept: { name: "ช่าง" }, store: STORE });
  assert.ok(html.includes("สมชาย &lt;b&gt;x&lt;/b&gt;"), "employee name must be HTML-escaped");
  assert.ok(!html.includes("<b>x</b>"), "raw HTML from name must not leak");
  assert.ok(html.includes("5,400.00"), "net total from DB total_amount must render");
  assert.ok(html.includes("ต้นฉบับ · สำหรับพนักงาน"), "copy 1 label");
  assert.ok(html.includes("สำเนา · สำหรับร้าน"), "copy 2 label");
  assert.equal(html.split('class="page"').length - 1, 2, "exactly 2 pages per slip");
  assert.ok(html.includes("11–25 มิ.ย. 69"), "period label from period_start/period_end");
  assert.ok(html.includes("PS202606-0007"), "slip number from period_month + id");
});

test("buildPayslipHtml: แถวเก่าไม่มี period_start/end → fallback label เดือนจาก period_month", () => {
  const legacy = { ...ROW, id: 3, period_start: null, period_end: null, period_month: "2025-11-01" };
  const html = buildPayslipHtml(legacy, { emp: EMP, store: STORE });
  assert.ok(html.includes("พฤศจิกายน 2568"), "month label fallback from period_month (Thai Buddhist year)");
  assert.ok(!html.includes("11–25 มิ.ย."), "must not show period-range label when columns missing");
});

test("buildPayslipHtml: จ่ายรายวัน → label rate × days; note/XSS ถูก escape", () => {
  const daily = { ...ROW, days_worked: 13, daily_rate: 400, note: "<script>alert(1)</script>" };
  const html = buildPayslipHtml(daily, { emp: EMP, store: STORE });
  assert.ok(html.includes("× 13 วัน"), "daily-rate label must show rate × days");
  assert.ok(!html.includes("<script>alert(1)"), "raw script tag from note must not leak");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "note must be escaped");
});

test("buildPayslipStyleCss: สี pay-section ตาม paid_at + .page มี page-break-after: always", () => {
  const paidCss = buildPayslipStyleCss({ paid_at: "2026-06-10T08:00:00Z" });
  const pendingCss = buildPayslipStyleCss({ paid_at: null });
  assert.ok(paidCss.includes("#f0fdf4"), "paid slip pay-section background");
  assert.ok(pendingCss.includes("#fff7ed"), "pending slip pay-section background");
  assert.ok(paidCss.includes("page-break-after: always"), "page-break CSS must stay (print-all relies on it)");
  assert.ok(paidCss.includes("size: A4"), "A4 page size must stay");
});

// ═══════════════════════════════════════════════════════════
//  2. source-regex guards (extract block ก่อน assert)
// ═══════════════════════════════════════════════════════════

test("ประวัติ: fetch ครั้งเดียว employee_id=eq + order=period_start.desc.nullslast + limit=24", () => {
  const body = extractBetween("async function _openPayrollHistoryModal", "//  Phase 417 (Part B): ⚡");
  assert.match(body, /employee_id=eq\./, "history fetch must filter by employee_id");
  assert.match(body, /order=period_start\.desc\.nullslast/, "rows without period_start must sort last");
  assert.match(body, /period_month\.desc/, "null period_start rows must then sort by period_month");
  assert.match(body, /limit=24/, "history fetch must cap at 24 periods");
  assert.equal((body.match(/fetch\(/g) || []).length, 1, "history modal must fetch exactly once (on open)");
});

test("ประวัติ: fallback label จาก period_month + สรุปรวมเฉพาะแถว paid_at + แถวสรุปท้าย", () => {
  const body = extractBetween("async function _openPayrollHistoryModal", "//  Phase 417 (Part B): ⚡");
  assert.match(body, /formatPayPeriodLabel\(r\.period_start, r\.period_end\)/, "period label from real period columns");
  assert.match(body, /r\.period_month/, "must fall back to period_month for legacy rows");
  assert.match(body, /rows\.filter\(r => r\.paid_at\)\.reduce/, "paid sum must only count rows with paid_at");
  assert.match(body, /รวมจ่ายแล้ว/, "summary footer row must exist");
});

test("ประวัติ: ปุ่มสลิปส่ง row ตรงให้ _printPayslip (สลิปเก่าออกได้แม้รอบเปลี่ยน)", () => {
  const body = extractBetween("async function _openPayrollHistoryModal", "//  Phase 417 (Part B): ⚡");
  assert.match(body, /pr-hist-slip-btn/, "history rows must have slip buttons");
  assert.match(body, /_printPayslip\(ctx, r\.id, r\)/, "slip button must pass the history row itself (not lookup _payrolls)");
});

test("_printPayslip: รับ rowOverride + ประกอบจาก builders (byte-preserving composition)", () => {
  const body = extractBetween("function _printPayslip(ctx, payrollId, rowOverride)", "function _printAllPayslips");
  assert.match(body, /const p = rowOverride \|\| _payrolls\.find/, "rowOverride must take precedence over current-period lookup");
  assert.ok(body.includes("${buildPayslipStyleCss(p)}"), "single-slip print must compose CSS from the shared builder");
  assert.ok(body.includes("${buildPayslipHtml(p, { emp, dept, store, logo })}"), "single-slip print must compose pages from the shared builder");
});

test("print-all: loop จาก _payrolls ของรอบ + page-break + reuse builders + ปิดเมื่อรอบว่าง", () => {
  const body = extractBetween("function _printAllPayslips", "function _exportPayroll");
  assert.match(body, /_payrolls\.map\(/, "must build slips from the current period rows (_payrolls)");
  assert.match(body, /buildPayslipHtml\(p, \{ emp, dept, store, logo \}\)/, "must reuse the slip HTML builder per row");
  assert.match(body, /buildPayslipStyleCss\(/, "must reuse the slip CSS builder");
  assert.match(body, /page-break-after: always/, "combined document must force page break between slips");
  assert.match(body, /slip-paid|slip-pending/, "per-slip paid/pending wrapper must exist (CSS override per slip)");
  assert.match(body, /if \(!_payrolls\.length\)/, "must bail out with toast when period has no rows");
  assert.ok(!/fetch\(/.test(body), "print-all must not fetch (uses already-loaded rows)");
});

test("renderPayrollPage: ปุ่ม print-all แสดงเฉพาะมีรายการ + ปุ่มประวัติต่อแถว + wiring ครบ", () => {
  const body = extractBetween("export async function renderPayrollPage", "function _openPayrollModal");
  assert.match(body, /\$\{_payrolls\.length > 0 \? `<button id="prPrintAllBtn"/, "print-all button only when period has rows");
  assert.match(body, /_printAllPayslips\(ctx\)/, "print-all button must be wired");
  assert.match(body, /pr-hist-btn/, "per-row history button must exist");
  assert.match(body, /_openPayrollHistoryModal\(ctx, btn\.dataset\.emp\)/, "history button must be wired");
});

test("code ใหม่ทั้งหมด read-only + print — ❌ ไม่มี POST/PATCH/PUT/DELETE ใหม่", () => {
  const newBlocks = [
    extractBetween("export function buildPayslipStyleCss", "function _printPayslip"),
    extractBetween("function _printPayslip(ctx, payrollId, rowOverride)", "function _exportPayroll"),
    extractBetween("async function _openPayrollHistoryModal", "//  Phase 417 (Part B): ⚡"),
  ].join("\n");
  assert.ok(!/method\s*:\s*["'](POST|PATCH|PUT|DELETE)["']/i.test(newBlocks),
    "new code must not introduce any write request");
  assert.ok(!/xhrPost|xhrPatch|xhrPut|xhrDelete/.test(newBlocks), "new code must not use write helpers");
  // builders ต้อง pure: ห้ามแตะ network/DOM
  const builders = extractBetween("export function buildPayslipStyleCss", "function _printPayslip");
  assert.ok(!/fetch\(|document\.|window\.open/.test(builders), "payslip builders must stay pure (no network/DOM)");
});

test("ไม่มี native alert() ใน payroll.js", () => {
  assert.ok(!/\balert\s*\(/.test(src), "alert() must not be used (use showToast)");
});
