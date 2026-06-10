// Phase 92.48: Accounting Integrity panel — _classifyOrphan bucketing
// Guards that the integrity status mirrors auto_post's "should post" rule:
//   pre-effective (before 2026-07-01 Bangkok — Phase 413) OR amount<=0 → skipped (not alarming)
//   on/after effective + amount>0                          → actionable (real gap)
// Dates use T12:00:00Z so the Bangkok (+7) conversion never flips the day.

import { test } from "node:test";
import assert from "node:assert/strict";
import { _classifyOrphan, INTEGRITY_CATS } from "../modules/accounting/backfill.js";
import { _isAfterEffective } from "../modules/accounting/auto_post.js";
import { todayBkk } from "../modules/utils.js";

const sales    = INTEGRITY_CATS.find(c => c.key === "sales");
const expenses = INTEGRITY_CATS.find(c => c.key === "expenses");
const payroll  = INTEGRITY_CATS.find(c => c.key === "payroll");

test("sale before effective date (April) → skipped/pre-effective", () => {
  const r = _classifyOrphan(sales, { id: 30, created_at: "2026-04-15T12:00:00Z", total_amount: 11900 });
  assert.equal(r.bucket, "skipped");
  assert.equal(r.reason, "pre-effective");
});

test("post-effective zero-amount sale → skipped/zero-amount", () => {
  const r = _classifyOrphan(sales, { id: 121, created_at: "2026-07-08T12:00:00Z", total_amount: 0 });
  assert.equal(r.bucket, "skipped");
  assert.equal(r.reason, "zero-amount");
});

test("post-effective real sale → actionable with amount", () => {
  const r = _classifyOrphan(sales, { id: 200, created_at: "2026-07-10T12:00:00Z", total_amount: 500 });
  assert.equal(r.bucket, "actionable");
  assert.equal(r.amount, 500);
});

test("sale falls back to grand_total when total_amount absent", () => {
  const r = _classifyOrphan(sales, { id: 201, created_at: "2026-07-10T12:00:00Z", grand_total: 250 });
  assert.equal(r.bucket, "actionable");
  assert.equal(r.amount, 250);
});

test("expense classifies on expense_date + amount (not created_at)", () => {
  // created_at is post-effective but expense_date is pre-effective → must skip on expense_date
  const r = _classifyOrphan(expenses, { id: 1, expense_date: "2026-04-12", created_at: "2026-07-20T12:00:00Z", amount: 1000 });
  assert.equal(r.bucket, "skipped");
  assert.equal(r.reason, "pre-effective");
});

test("expense post-effective with amount → actionable", () => {
  const r = _classifyOrphan(expenses, { id: 2, expense_date: "2026-07-02", amount: 1000 });
  assert.equal(r.bucket, "actionable");
  assert.equal(r.amount, 1000);
});

test("payroll classifies on paid_at + total_amount", () => {
  const r = _classifyOrphan(payroll, { id: 5, paid_at: "2026-07-31T12:00:00Z", total_amount: 9000 });
  assert.equal(r.bucket, "actionable");
  assert.equal(r.amount, 9000);
});

test("missing docDate falls back to today → bucket ตามกติกาเดียวกับ auto_post (today vs effective)", () => {
  // ★ Phase 413: time-independent — ก่อน 1 ก.ค. today=pre-effective (skipped), หลัง 1 ก.ค. = actionable
  //   คำนวณ expected จาก rule จริงแทน hardcode (test ไม่พังเมื่อเวลาจริงข้าม cutoff)
  const r = _classifyOrphan(sales, { id: 300, created_at: null, total_amount: 100 });
  const expected = _isAfterEffective(todayBkk()) ? "actionable" : "skipped";
  assert.equal(r.bucket, expected);
});
