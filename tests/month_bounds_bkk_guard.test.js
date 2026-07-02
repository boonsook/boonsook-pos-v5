// Audit fix — guard: ขอบเดือน TZ-safe (monthBoundsBkk / monthsAgoStartBkk)
// บั๊กเดิม: หลายที่ทำ `new Date(start+"T00:00:00+07:00")`.setMonth().toISOString()
//   หรือ `new Date(y,m-n,1).toISOString()` → ปน offset+07:00 กับ UTC → คืนวันผิด
//   → วันสิ้นเดือนหลุดจาก filter (HR/leave) หรือ rolling window เกิน 1 วัน (expense).
// Test นี้ตรึงค่าที่ถูก + fail ถ้าใครกลับไปใช้ Date/toISOString ในสูตรขอบเดือน.
// Run: node --test tests/month_bounds_bkk_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { monthBoundsBkk, monthsAgoStartBkk } from "../modules/utils.js";

test("monthBoundsBkk: endExclusive = วันที่ 1 ของเดือนถัดไป (ไม่หายวันสิ้นเดือน)", () => {
  assert.deepEqual(monthBoundsBkk("2026-06"), { start: "2026-06-01", endExclusive: "2026-07-01" });
  // ก.พ. เคยเพี้ยนสุด (28 วัน) → เดิมได้ 2026-03-03
  assert.deepEqual(monthBoundsBkk("2026-02"), { start: "2026-02-01", endExclusive: "2026-03-01" });
  // ข้ามปี
  assert.deepEqual(monthBoundsBkk("2026-12"), { start: "2026-12-01", endExclusive: "2027-01-01" });
  // รับ YYYY-MM-DD (ตัด 7 ตัวแรก)
  assert.equal(monthBoundsBkk("2026-11-15").endExclusive, "2026-12-01");
});

test("monthBoundsBkk: วันสุดท้ายของเดือนต้อง < endExclusive (ไม่ถูกตัดออก)", () => {
  const { start, endExclusive } = monthBoundsBkk("2026-02");
  const lastDay = "2026-02-28";
  assert.ok(lastDay >= start && lastDay < endExclusive, "28 ก.พ. ต้องอยู่ในช่วง [start, endExclusive)");
});

test("monthsAgoStartBkk: n=0 → วันที่ 1 เดือนปัจจุบัน; ย้อนข้ามปีถูก", () => {
  assert.match(monthsAgoStartBkk(0), /^\d{4}-\d{2}-01$/);
  // ย้อน 13 เดือน = ปีก่อน เดือนเดียวกัน (โดยประมาณ) — เช็ครูปแบบ + ว่าน้อยกว่าเดือนนี้
  const now0 = monthsAgoStartBkk(0);
  const back13 = monthsAgoStartBkk(13);
  assert.match(back13, /^\d{4}-\d{2}-01$/);
  assert.ok(back13 < now0, "ย้อน 13 เดือนต้องก่อนเดือนปัจจุบัน");
});

// ── source guard: สูตรขอบเดือนต้องไม่กลับไปใช้ Date/toISOString ──
const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(__dirname, "..", f), "utf8");

test("hr_overview/leave/expense/payroll ใช้ helper ไม่ใช่ Date+toISOString ในสูตรเดือน", () => {
  assert.match(read("modules/hr_overview.js"), /monthBoundsBkk\(/);
  assert.match(read("modules/leave_management.js"), /monthBoundsBkk\(/);
  assert.match(read("modules/expense_overview.js"), /monthsAgoStartBkk\(/);
  assert.match(read("modules/payroll_overview.js"), /monthsAgoStartBkk\(/);
  // สูตรเดิมที่พังต้องไม่เหลือ
  assert.doesNotMatch(read("modules/leave_management.js"), /setMonth\(d\.getMonth\(\) \+ 1\)/);
  assert.doesNotMatch(read("modules/expense_overview.js"), /startDate\.toISOString/);
});
