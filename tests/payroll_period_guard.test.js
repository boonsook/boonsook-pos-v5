// Phase 416 (Part A) — payroll custom pay-period guard (build 416)
// Run: node --test tests/payroll_period_guard.test.js
//
// Why this exists:
//   เงินเดือนพนักงานเปลี่ยนจาก "รอบเดือนปฏิทิน" → "รอบตัดที่ร้านกำหนด" (default ตัด 10/25
//   → รอบ 11–25 และ 26–10 ของเดือนถัดไป) — ผิดรอบ = จ่ายผิด. guard นี้ล็อก:
//   (1) คณิตของ computePayPeriods (คร่อมเดือน/คร่อมปี/ก.พ. — ห้าม invalid date)
//   (2) save payload ต้องมี period_start/period_end/details (snapshot jsonb)
//   (3) โหลดรายการต้อง filter รอบตรงตัว period_start=eq (ไม่ใช่ overlap/เดือน)
//   (4) OT autofill ต้องใช้ช่วงรอบจริง (_periodStart/_periodEnd) ไม่ใช่ขอบเดือน
//   (5) สูตร computePayrollTotal ห้ามถูกแตะ + ห้ามมี alert()

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { computePayPeriods, formatPayPeriodLabel, computePayrollTotal } =
  await import("../modules/payroll.js");

const src = fs.readFileSync(path.resolve("modules/payroll.js"), "utf8");

// helper: extract function body ระหว่าง marker เปิด → marker ของ function ถัดไป
// (source-regex บน block ที่เจาะจง — กัน false positive จากส่วนอื่นของไฟล์)
function extractBetween(startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `source must contain "${startMarker}"`);
  const e = src.indexOf(endMarker, s + startMarker.length);
  assert.ok(e > s, `source must contain "${endMarker}" after "${startMarker}"`);
  return src.slice(s, e);
}

// ═══════════════════════════════════════════════════════════
//  1. computePayPeriods — unit จริง
// ═══════════════════════════════════════════════════════════

test("computePayPeriods: refDate 2026-06-10 cutoff 10/25 → 3 รอบล่าสุด ใหม่→เก่า ถูกต้อง", () => {
  const out = computePayPeriods({ cutoff1: 10, cutoff2: 25, refDate: "2026-06-10", count: 3 });
  assert.equal(out.length, 3);
  // รอบปัจจุบัน = 26 พ.ค. → 10 มิ.ย. (refDate เป็นวันสุดท้ายของรอบ)
  assert.equal(out[0].start, "2026-05-26");
  assert.equal(out[0].end,   "2026-06-10");
  // รอบก่อนหน้า = 11–25 พ.ค.
  assert.equal(out[1].start, "2026-05-11");
  assert.equal(out[1].end,   "2026-05-25");
  // ก่อนหน้าอีก = 26 เม.ย. → 10 พ.ค.
  assert.equal(out[2].start, "2026-04-26");
  assert.equal(out[2].end,   "2026-05-10");
});

test("computePayPeriods: คร่อมปี — refDate 2026-01-05 → รอบปัจจุบัน 2025-12-26 → 2026-01-10", () => {
  const out = computePayPeriods({ cutoff1: 10, cutoff2: 25, refDate: "2026-01-05", count: 2 });
  assert.equal(out[0].start, "2025-12-26");
  assert.equal(out[0].end,   "2026-01-10");
  // รอบก่อนหน้า = 11–25 ธ.ค. 2025
  assert.equal(out[1].start, "2025-12-11");
  assert.equal(out[1].end,   "2025-12-25");
});

test("computePayPeriods: คร่อม ก.พ. — refDate 2026-03-05 → 2026-02-26 → 2026-03-10 (ก.พ. 28 วัน ไม่มี invalid date)", () => {
  const out = computePayPeriods({ cutoff1: 10, cutoff2: 25, refDate: "2026-03-05", count: 1 });
  assert.equal(out[0].start, "2026-02-26");
  assert.equal(out[0].end,   "2026-03-10");
  // ทุกค่า date string ต้อง valid (regex + parse กลับต้องตรง — กัน 2026-02-30 หลุด)
  for (const p of out) {
    for (const d of [p.start, p.end]) {
      assert.match(d, /^\d{4}-\d{2}-\d{2}$/, `${d} must be YYYY-MM-DD`);
      const [y, m, day] = d.split("-").map(Number);
      const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
      assert.ok(day >= 1 && day <= dim, `${d} must be a real calendar day`);
    }
  }
});

test("computePayPeriods: cutoff ชนปลายเดือนสั้น (10/28) — รอบหลัง ก.พ. เริ่ม 1 มี.ค. ไม่ใช่ 29 ก.พ.", () => {
  // 2026 ไม่ใช่ leap year — ก.พ. มี 28 วัน; วันถัดจากวันตัด 28 ก.พ. ต้อง clamp เป็น 1 มี.ค.
  const out = computePayPeriods({ cutoff1: 10, cutoff2: 28, refDate: "2026-03-03", count: 2 });
  assert.equal(out[0].start, "2026-03-01", "วันถัดจาก 28 ก.พ. (วันสุดท้ายเดือน) = 1 มี.ค.");
  assert.equal(out[0].end,   "2026-03-10");
  // รอบก่อนหน้า (A ของ ก.พ.) = 11 ก.พ. → 28 ก.พ. (min(28, 28))
  assert.equal(out[1].start, "2026-02-11");
  assert.equal(out[1].end,   "2026-02-28");
});

test("computePayPeriods: labels ภาษาไทยถูกต้อง (ปี พ.ศ. 2 หลัก)", () => {
  const out = computePayPeriods({ cutoff1: 10, cutoff2: 25, refDate: "2026-06-15", count: 3 });
  // รอบปัจจุบัน 11–25 มิ.ย. 2026 (พ.ศ. 2569) — เดือนเดียวกัน
  assert.equal(out[0].label, "11–25 มิ.ย. 69");
  // รอบก่อนหน้า 26 พ.ค. → 10 มิ.ย. — คร่อมเดือน ปีเดียวกัน
  assert.equal(out[1].label, "26 พ.ค. – 10 มิ.ย. 69");
  // formatPayPeriodLabel ตรง ๆ: คร่อมปี ต้องมีปีทั้งสองฝั่ง
  assert.equal(formatPayPeriodLabel("2025-12-26", "2026-01-10"), "26 ธ.ค. 68 – 10 ม.ค. 69");
});

test("computePayPeriods: count ทำงาน + รอบต่อเนื่องไม่มี gap/overlap", () => {
  const out = computePayPeriods({ cutoff1: 10, cutoff2: 25, refDate: "2026-06-10", count: 6 });
  assert.equal(out.length, 6);
  for (let i = 0; i + 1 < out.length; i++) {
    const newer = out[i];
    const older = out[i + 1];
    // วันถัดจาก end ของรอบเก่า ต้องเท่ากับ start ของรอบใหม่ (string math)
    const [y, m, d] = older.end.split("-").map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const next = d >= dim
      ? `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`
      : `${y}-${String(m).padStart(2, "0")}-${String(d + 1).padStart(2, "0")}`;
    assert.equal(next, newer.start, `period ${i + 1} → ${i} must be contiguous`);
  }
});

test("computePayPeriods: cutoff ไม่ valid (NaN/นอกช่วง/c1>=c2) → fallback 10/25", () => {
  const bad = [
    computePayPeriods({ cutoff1: 0, cutoff2: 40, refDate: "2026-06-10", count: 1 }),
    computePayPeriods({ cutoff1: 25, cutoff2: 10, refDate: "2026-06-10", count: 1 }),
    computePayPeriods({ refDate: "2026-06-10", count: 1 }),
  ];
  for (const out of bad) {
    assert.equal(out[0].start, "2026-05-26");
    assert.equal(out[0].end, "2026-06-10");
  }
});

// ═══════════════════════════════════════════════════════════
//  2. source-regex guards (extract block ก่อน assert)
// ═══════════════════════════════════════════════════════════

test("save payload มี period_start + period_end + details (snapshot jsonb)", () => {
  const body = extractBetween("async function _savePayroll", "async function _deletePayroll");
  assert.match(body, /period_start:\s*_periodStart/, "payload must persist period_start from state");
  assert.match(body, /period_end:\s*_periodEnd/, "payload must persist period_end from state");
  assert.match(body, /payload\.details\s*=\s*\{/, "payload must include details jsonb snapshot");
  assert.match(body, /schema:\s*1/, "details must declare schema: 1");
  assert.match(body, /ot_hours_autofill/, "details.attendance must capture ot_hours_autofill");
  // period_month ยังต้องเขียนต่อ (สลิป/JV/expense เดิมอ่านค่านี้)
  assert.match(body, /period_month:\s*_periodMonth \+ "-01"/, "period_month must stay (derived from period end month)");
  // unique error ครอบ index ใหม่ + 23505
  assert.match(body, /uq_staff_payroll_period/, "must recognize new unique index name");
  assert.match(body, /พนักงานนี้มีรายการรอบนี้แล้ว/, "duplicate error message must say รอบ (not เดือน)");
});

test("โหลดรายการใช้รอบตรงตัว period_start=eq + period_end=eq (ไม่ใช่ช่วงเดือน gte/lt)", () => {
  const body = extractBetween("export async function renderPayrollPage", "function _openPayrollModal");
  assert.match(body, /period_start=eq\.\$\{_periodStart\}/, "must filter period_start=eq.{_periodStart}");
  assert.match(body, /period_end=eq\.\$\{_periodEnd\}/, "must filter period_end=eq.{_periodEnd}");
  assert.ok(!/period_month=gte\./.test(body), "old month-range filter (period_month=gte.) must be gone");
  // fallback เมื่อ owner ยังไม่รัน SQL (คอลัมน์ไม่มี → 400) ต้องชี้ไฟล์ SQL ของ phase นี้
  assert.match(body, /supabase-phase416-payroll-period\.sql/, "missing-column error must point to the phase SQL file");
});

test("OT autofill เรียก fetchUserAttendanceSummary ด้วยช่วงรอบจริง (_periodStart/_periodEnd) ไม่ใช่ขอบเดือน", () => {
  const body = extractBetween("function _openPayrollModal", "async function _savePayroll");
  assert.match(body, /const fromDate = _periodStart;/, "OT fetch fromDate must be _periodStart");
  assert.match(body, /const toDate = _periodEnd;/, "OT fetch toDate must be _periodEnd");
  assert.match(body, /fetchUserAttendanceSummary\(empId, fromDate, toDate, shiftOpts\)/,
    "must call fetchUserAttendanceSummary with the period range");
});

test("ไม่มี native alert() ใน payroll.js", () => {
  assert.ok(!/\balert\s*\(/.test(src), "alert() must not be used (use showToast)");
});

test("computePayrollTotal สูตรเดิมไม่ถูกแตะ: base + ot + wel + bon + com - ded", () => {
  const body = extractBetween("export function computePayrollTotal", "export function expenseDateForPaidPayroll");
  assert.match(body, /return round2\(base \+ ot \+ wel \+ bon \+ com - ded\);/,
    "total formula must stay base + overtime + welfare + bonus + commission - deductions");
  // behavioral double-check
  assert.equal(computePayrollTotal({ base_salary: 1000, overtime: 100, welfare: 50, bonus: 25, commission: 10, deductions: 85 }), 1100);
});
