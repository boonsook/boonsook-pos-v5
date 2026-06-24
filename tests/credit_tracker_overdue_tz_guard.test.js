// Phase 525 — credit-tracker overdue timezone guard (audit TZ #2, §4.7)
// Run: node --test tests/credit_tracker_overdue_tz_guard.test.js
//
// Invariant: Credit Tracker ต้องคิด "เกินกำหนด" (overdue) บนเขตเวลาไทย (Asia/Bangkok)
// ให้ตรงกับ dashboard (508 ใช้ todayBkk). เดิม today=UTC (toISOString) → ช่วง 00:00–07:00
// เวลาไทย today(UTC) ยังเป็นเมื่อวาน → บิล due=เมื่อวาน ไม่ถูกนับ overdue (undercount).
// daysOverdue ต้อง diff บนเส้นเวลาไทยให้ตรง boundary `today` ไม่ใช่ Date.now() (UTC ms).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { todayBkk, addDaysBkk } from "../modules/utils.js";

const CT = fs.readFileSync(path.resolve("modules/credit_tracker.js"), "utf8");

// scope กลุ่ม overdue: ตั้งแต่ today boundary จนก่อน Filter (กัน false-positive จาก
// `new Date().toISOString()` ที่ default param บรรทัดอื่น ซึ่งคนละเรื่องกับ overdue)
function overdueBlock(src) {
  const i = src.indexOf("const today = todayBkk()");
  assert.ok(i > -1, "anchor `const today = todayBkk()` not found");
  const j = src.indexOf("// Filter", i);
  assert.ok(j > -1, "end anchor `// Filter` not found");
  return src.slice(i, j);
}

// ตัด single-line comment (`// ...`) ออกก่อนเช็ค negative — กัน false-positive จากคอมเมนต์
// ที่อธิบายโค้ดของเดิม (มีคำว่า Date.now()/toISOString ในเชิงอ้างอิง ไม่ใช่โค้ดจริง)
function codeOnly(block) {
  return block.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
}

// ── source guards ───────────────────────────────────────────────────────────
test("today boundary มาจาก todayBkk() (Asia/Bangkok) ไม่ใช่ toISOString().slice (UTC)", () => {
  assert.match(CT, /import \{[^}]*\btodayBkk\b[^}]*\} from "\.\/utils\.js"/,
    "must import todayBkk from utils.js");
  assert.match(CT, /const today = todayBkk\(\);/, "today must be todayBkk()");
  const block = codeOnly(overdueBlock(CT));
  assert.ok(!/new Date\(\)\.toISOString\(\)\.slice/.test(block),
    "overdue boundary must NOT derive `today` from UTC toISOString().slice");
});

test("daysOverdue diff บนเส้นเวลาไทย (anchor +07:00) ไม่ใช่ Date.now() (UTC ms)", () => {
  const block = codeOnly(overdueBlock(CT));
  assert.ok(!/Date\.now\(\)/.test(block),
    "daysOverdue must NOT use Date.now() (UTC ms — off-by-1 vs today BKK)");
  assert.match(block, /T00:00:00\+07:00/,
    "daysOverdue must anchor both dates at Bangkok midnight (+07:00)");
  assert.match(block, /s\.credit_due_date \+ "T00:00:00\+07:00"/,
    "daysOverdue must compute diff from credit_due_date at +07:00");
});

test("overdue boundary ใช้ string compare credit_due_date < today (calendar-day)", () => {
  const block = overdueBlock(CT);
  assert.match(block, /s\.credit_due_date && s\.credit_due_date < today/,
    "isOverdue must compare credit_due_date < today (both YYYY-MM-DD BKK)");
});

// ── behavioral (mirror ของสูตรในโค้ด + utils จริง) ─────────────────────────────
// จำลองสูตรเดียวกับ credit_tracker.js แล้ว assert พฤติกรรมด้วย todayBkk/addDaysBkk จริง
function compute(due_date, today, isPaid) {
  const isOverdue = !isPaid && due_date && due_date < today;
  const daysOverdue = isOverdue
    ? Math.max(0, Math.floor(
        (new Date(today + "T00:00:00+07:00").getTime()
         - new Date(due_date + "T00:00:00+07:00").getTime()) / 86400000))
    : 0;
  return { isOverdue, daysOverdue };
}

test("บิล due = เมื่อวาน(BKK) ยังไม่จ่าย → overdue=true, daysOverdue=1", () => {
  const today = todayBkk();
  const yesterday = addDaysBkk(-1);
  const r = compute(yesterday, today, false);
  assert.equal(r.isOverdue, true, "บิล due เมื่อวานต้องเป็น overdue");
  assert.equal(r.daysOverdue, 1, "เกินกำหนด 1 วัน");
});

test("บิล due = วันนี้(BKK) → ยังไม่ overdue (boundary ไม่นับวันนี้)", () => {
  const today = todayBkk();
  const r = compute(today, today, false);
  assert.equal(r.isOverdue, false, "ครบกำหนดวันนี้ ยังไม่เกิน");
  assert.equal(r.daysOverdue, 0);
});

test("บิล due = 3 วันก่อน(BKK) → daysOverdue=3", () => {
  const today = todayBkk();
  const r = compute(addDaysBkk(-3), today, false);
  assert.equal(r.isOverdue, true);
  assert.equal(r.daysOverdue, 3);
});

test("บิลที่จ่ายแล้ว ไม่ใช่ overdue แม้ due ผ่านมานาน", () => {
  const today = todayBkk();
  const r = compute(addDaysBkk(-10), today, true);
  assert.equal(r.isOverdue, false, "จ่ายครบแล้ว = ไม่ overdue");
  assert.equal(r.daysOverdue, 0);
});
