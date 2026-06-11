// Phase 417 (Part B) — payroll bulk draft + attendance columns + timesheet guard (build 417)
// Run: node --test tests/payroll_partb_guard.test.js
//
// Why this exists:
//   Part B ต่อยอดหน้าเงินเดือนรอบตัด (416-A): ปุ่ม "⚡ สร้างเงินเดือนทั้งรอบ" (bulk DRAFT),
//   คอลัมน์ วัน/OT ชม./สาย/ลา ต่อแถว, การ์ดสรุป OT รวม + มาสายรวม, timesheet modal.
//   guard นี้ล็อก:
//   (1) buildPeriodAttendanceMap (pure aggregation) — หลายคน/distinct days/late/leave clip/ว่าง
//   (2) bulk payload ❌ ห้ามมี total_amount (DB GENERATED — Postgres 400 428C9 ปฏิเสธทั้งคำสั่ง)
//   (3) bulk มี inflight guard + App.confirm ก่อน insert + ❌ ไม่มีการจ่าย/JV/expense
//   (4) batch fetch ครั้งเดียวต่อรอบ (ห้ามยิงต่อคน) + timesheet ใช้ rows ที่โหลดแล้ว (ไม่ fetch ซ้ำ)
//   (5) ไม่มี native alert()/confirm()

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { buildPeriodAttendanceMap } = await import("../modules/payroll.js");

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
//  1. buildPeriodAttendanceMap — unit จริง (pure, no DOM/network)
// ═══════════════════════════════════════════════════════════

const SHIFT = { startHour: 8, endHour: 17 };
const RULES = { lateGraceMinutes: 15, earlyLeaveGraceMinutes: 15 };
const OPTS = { shift: SHIFT, rules: RULES, periodStart: "2026-06-11", periodEnd: "2026-06-25" };

test("หลายคน: aggregate แยกต่อ user — days/otHours/lateCount ถูกต้อง", () => {
  const att = [
    // user A วัน 1: 08:00–18:00 BKK (01:00Z–11:00Z) → ตรงเวลา + OT 1 ชม.
    { user_id: "ua", work_date: "2026-06-11", clock_in_at: "2026-06-11T01:00:00Z", clock_out_at: "2026-06-11T11:00:00Z" },
    // user A วัน 2: 08:30–17:00 BKK → สาย 30 นาที (เกิน grace 15)
    { user_id: "ua", work_date: "2026-06-12", clock_in_at: "2026-06-12T01:30:00Z", clock_out_at: "2026-06-12T10:00:00Z" },
    // user B วันเดียว: 08:05–17:00 BKK → ใน grace = ตรงเวลา ไม่มี OT
    { user_id: "ub", work_date: "2026-06-11", clock_in_at: "2026-06-11T01:05:00Z", clock_out_at: "2026-06-11T10:00:00Z" },
  ];
  const map = buildPeriodAttendanceMap(att, [], OPTS);
  assert.equal(map.size, 2);
  const a = map.get("ua");
  assert.equal(a.days, 2);
  assert.equal(a.otHours, 1, "OT หลัง 17:00 ถึง 18:00 = 1 ชม.");
  assert.equal(a.lateCount, 1, "เข้า 08:30 เกิน grace 15 นาที = สาย 1 ครั้ง");
  assert.equal(a.leaveDays, 0);
  const b = map.get("ub");
  assert.equal(b.days, 1);
  assert.equal(b.otHours, 0);
  assert.equal(b.lateCount, 0, "เข้า 08:05 ใน grace = ไม่สาย");
});

test("distinct days: 2 sessions วันเดียวกัน → days=1, OT รวมทุก session", () => {
  const att = [
    // 08:00–12:00 BKK
    { user_id: "u1", work_date: "2026-06-15", clock_in_at: "2026-06-15T01:00:00Z", clock_out_at: "2026-06-15T05:00:00Z" },
    // 13:00–19:00 BKK → OT 2 ชม. (17:00–19:00); session บ่ายนับ late ตาม per-row rule
    { user_id: "u1", work_date: "2026-06-15", clock_in_at: "2026-06-15T06:00:00Z", clock_out_at: "2026-06-15T12:00:00Z" },
  ];
  const map = buildPeriodAttendanceMap(att, [], OPTS);
  const u = map.get("u1");
  assert.equal(u.days, 1, "วันเดียวกัน 2 sessions = distinct 1 วัน");
  assert.equal(u.otHours, 2);
  // นับ late ต่อ row (pattern เดียวกับ summarizePunctuality ใน HR overview)
  assert.equal(u.lateCount, 1, "session บ่าย (13:00) นับ late ตาม per-row classification");
});

test("session ที่ยังไม่ clock out: นับวันแต่ไม่นับ OT (เหมือน fetchUserAttendanceSummary)", () => {
  const att = [
    { user_id: "u2", work_date: "2026-06-16", clock_in_at: "2026-06-16T01:00:00Z", clock_out_at: null },
  ];
  const map = buildPeriodAttendanceMap(att, [], OPTS);
  assert.equal(map.get("u2").days, 1);
  assert.equal(map.get("u2").otHours, 0, "open session ไม่นับชั่วโมง");
  assert.equal(map.get("u2").lateCount, 0, "missing_clock_out ไม่ใช่ late");
});

test("leave clip ขอบรอบ: ลา 8–12 มิ.ย. ทับรอบ 11–25 → นับเฉพาะ 11,12 = 2 วัน", () => {
  const leaves = [
    { user_id: "u1", status: "approved", start_date: "2026-06-08", end_date: "2026-06-12" },
  ];
  const map = buildPeriodAttendanceMap([], leaves, OPTS);
  assert.equal(map.get("u1").leaveDays, 2);
});

test("leave คร่อมทั้งรอบ → clip = ความยาวรอบเต็ม (11–25 มิ.ย. = 15 วัน)", () => {
  const leaves = [{ user_id: "u9", status: "approved", start_date: "2026-06-01", end_date: "2026-07-15" }];
  const map = buildPeriodAttendanceMap([], leaves, OPTS);
  assert.equal(map.get("u9").leaveDays, 15);
});

test("leave นอกรอบ / ไม่ approved → ไม่นับ ไม่สร้าง entry", () => {
  const leaves = [
    { user_id: "u1", status: "approved", start_date: "2026-06-01", end_date: "2026-06-05" }, // จบก่อนรอบ
    { user_id: "u1", status: "pending",  start_date: "2026-06-15", end_date: "2026-06-16" }, // ไม่ approved
    { user_id: "u1", status: "rejected", start_date: "2026-06-15", end_date: "2026-06-16" },
  ];
  const map = buildPeriodAttendanceMap([], leaves, OPTS);
  assert.equal(map.has("u1"), false, "ไม่มีรายการที่นับได้ = ไม่มี entry");
});

test("input ว่าง/ไม่ valid → Map ว่าง (ไม่ throw)", () => {
  assert.equal(buildPeriodAttendanceMap([], [], OPTS).size, 0);
  assert.equal(buildPeriodAttendanceMap(null, null, OPTS).size, 0);
  assert.equal(buildPeriodAttendanceMap(undefined, undefined, OPTS).size, 0);
  // ไม่มี period ที่ valid → ว่างเสมอ (กันคำนวณบนช่วงที่ไม่รู้ขอบ)
  assert.equal(buildPeriodAttendanceMap(
    [{ user_id: "u", work_date: "2026-06-11", clock_in_at: "2026-06-11T01:00:00Z" }], [], {}).size, 0);
  assert.equal(buildPeriodAttendanceMap([], [], { ...OPTS, periodStart: "" }).size, 0);
  // row ไม่มี clock_in / ไม่มี user_id → ข้าม
  assert.equal(buildPeriodAttendanceMap(
    [{ user_id: "u", work_date: "2026-06-11", clock_in_at: null }, { work_date: "2026-06-11", clock_in_at: "2026-06-11T01:00:00Z" }],
    [], OPTS).size, 0);
});

// ═══════════════════════════════════════════════════════════
//  2. source-regex guards (extract block ก่อน assert)
// ═══════════════════════════════════════════════════════════

test("bulk payload ❌ ไม่มี total_amount (DB GENERATED, 428C9) + ❌ ไม่มีการจ่าย/JV/expense", () => {
  const body = extractBetween("async function _bulkGeneratePayroll", "function _openTimesheetModal");
  assert.ok(!/total_amount\s*:/.test(body), "bulk payload must NOT include total_amount (DB generated column)");
  assert.ok(!/paid_at\s*:/.test(body), "bulk must not set paid_at (draft only — no auto-pay)");
  assert.ok(!/postJournalForPayroll/.test(body), "bulk must not post JV");
  assert.ok(!/_createSalaryExpense/.test(body), "bulk must not create expense");
  assert.ok(!/_markPaid/.test(body), "bulk must not call mark-paid");
  // ของที่ต้องมีใน payload
  assert.match(body, /period_start:\s*_periodStart/, "payload must persist period_start");
  assert.match(body, /period_end:\s*_periodEnd/, "payload must persist period_end");
  assert.match(body, /period_month:\s*_periodMonth \+ "-01"/, "period_month derived from period end month");
  assert.match(body, /schema:\s*1/, "details must declare schema: 1");
  assert.match(body, /ot_hours_autofill/, "details.attendance must capture ot_hours_autofill");
  assert.match(body, /late_count/, "details.attendance must capture late_count");
  assert.match(body, /leave_days/, "details.attendance must capture leave_days");
  assert.match(body, /สร้างอัตโนมัติทั้งรอบ — ตรวจก่อนจ่าย/, "draft note must warn owner to review");
});

test("bulk มี inflight guard เช็คก่อน + reset ใน finally + App.confirm ก่อน insert", () => {
  const body = extractBetween("async function _bulkGeneratePayroll", "function _openTimesheetModal");
  // inflight guard ต้องเป็นเช็คแรกสุด (ก่อน confirm/fetch)
  const guardIdx = body.indexOf("if (_prBulkInflight)");
  const confirmIdx = body.indexOf("window.App.confirm(");
  const postIdx = body.indexOf('method: "POST"');
  assert.ok(guardIdx >= 0, "must check _prBulkInflight first");
  assert.ok(confirmIdx >= 0, "must use App.confirm modal");
  assert.ok(postIdx >= 0, "must POST staff_payroll");
  assert.ok(guardIdx < confirmIdx, "inflight check must come before confirm");
  assert.ok(confirmIdx < postIdx, "App.confirm must come before POST insert");
  assert.match(body, /_prBulkInflight = true/, "must set inflight before loop");
  assert.match(body, /finally\s*\{[\s\S]*?_prBulkInflight = false/, "must reset inflight in finally");
  // สร้างเฉพาะคนที่ยังไม่มีรายการรอบนี้
  assert.match(body, /!existing\.has\(String\(p\.id\)\)/, "must skip employees who already have a row this period");
  // ห้าม native confirm
  assert.ok(!/window\.confirm\(/.test(body), "native confirm() must not be used");
});

test("renderPayrollPage: batch fetch ครั้งเดียวต่อรอบ + คอลัมน์ใหม่ + การ์ดสรุป + ปุ่ม bulk", () => {
  const body = extractBetween("export async function renderPayrollPage", "function _openPayrollModal");
  // batch ครั้งเดียว (ทุกคน) — ไม่ยิงต่อคน
  assert.match(body, /staff_attendance\?select=\*&work_date=gte\.\$\{_periodStart\}&work_date=lte\.\$\{_periodEnd\}/,
    "must batch-fetch attendance for the whole period once");
  assert.match(body, /staff_leaves\?select=\*&status=eq\.approved&start_date=lte\.\$\{_periodEnd\}&end_date=gte\.\$\{_periodStart\}/,
    "must batch-fetch approved leaves overlapping the period once");
  assert.match(body, /buildPeriodAttendanceMap\(/, "must aggregate via the pure helper");
  // คอลัมน์ใหม่ 4 ตัว (ก่อนคอลัมน์เงิน)
  assert.match(body, />วัน<\/th>/);
  assert.match(body, />OT ชม\.<\/th>/);
  assert.match(body, />สาย<\/th>/);
  assert.match(body, />ลา<\/th>/);
  // คอลัมน์เงินเดิมคงอยู่
  for (const col of [">เงินเดือน<", ">OT<", ">สวัสดิการ<", ">โบนัส<", ">คอม<", ">หัก<", ">รวมสุทธิ<", ">สถานะ<"]) {
    assert.ok(body.includes(col), `existing money column ${col} must stay`);
  }
  // การ์ดสรุป 2 ใบใหม่ + ปุ่ม bulk + ชื่อพนักงานกดได้
  assert.match(body, /OT รวม \(ชม\.\)/, "period OT summary card");
  assert.match(body, /มาสายรวม \(ครั้ง\)/, "period late summary card");
  assert.match(body, /id="prBulkBtn"/, "bulk button must exist");
  assert.match(body, /_bulkGeneratePayroll\(ctx\)/, "bulk button must be wired");
  assert.match(body, /pr-name-btn/, "employee name must open timesheet");
  assert.match(body, /_openTimesheetModal\(ctx, btn\.dataset\.emp\)/, "name click must be wired");
});

test("timesheet modal: ใช้ rows ที่ batch แล้ว — ❌ ไม่ fetch ซ้ำ + reuse buildEmployeeTimesheet", () => {
  const idx = src.indexOf("function _openTimesheetModal");
  assert.ok(idx >= 0, "must define _openTimesheetModal");
  const body = src.slice(idx);
  assert.match(body, /_periodAttRows\.filter/, "must reuse batched attendance rows");
  assert.ok(!/fetch\(/.test(body), "timesheet modal must not fetch (read from batch)");
  assert.match(body, /buildEmployeeTimesheet\(/, "must reuse hr_overview pure helper");
});

test("import จาก hr_overview/time_clock/leave_management เป็น import-only (ไม่แก้ไฟล์ต้นทาง)", () => {
  assert.match(src, /import \{ buildEmployeeTimesheet \} from "\.\/hr_overview\.js"/);
  assert.match(src, /attendanceRulesFromState/, "must reuse attendance rules helper");
  assert.match(src, /calcLeaveDays/, "must reuse leave-day calculator");
});

test("ไม่มี native alert() ใน payroll.js", () => {
  assert.ok(!/\balert\s*\(/.test(src), "alert() must not be used (use showToast)");
});
