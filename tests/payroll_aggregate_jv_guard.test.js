// Phase 447a — payroll period-aggregate JV guard (MONEY + privacy)
// Run: node --test tests/payroll_aggregate_jv_guard.test.js
//
// Contract (Step 3a of "accountant = สำนักงานบัญชีภายนอก"):
//   เงินเดือนต้องลงบัญชีเป็น JV "ก้อนเดียวต่อรอบ" (ยอดรวม — ไม่มีชื่อ/รายคน) เพื่อไม่ให้
//   สำนักงานบัญชี (accountant, is_accountant()=true → เห็นทุก JE ผ่าน je_select) เห็นเงินเดือนรายคน.
//     - _buildPayrollPeriodLines: Dr 5200 รวม / Cr แยก cash(1110)+bank(1130), balanced เป๊ะ
//     - postPayrollPeriodJournal: source_table=payroll_period, gated effective date, idempotent ต่องวด
//     - _markPaid: ❌ ไม่ลง JV รายคน (postJournalForPayroll) แล้ว
//     - backfill: expenses ข้าม salary/labor_hire/payroll (กัน double-count) + payroll ออกจาก INTEGRITY_CATS

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { _buildPayrollPeriodLines } from "../modules/accounting/auto_post.js";

const MAP = { debit_account_code: "5200", credit_account_code: "1110" };
const sum = (lines, k) => lines.reduce((s, l) => s + Number(l[k] || 0), 0);

// ── behavioral: money math (the risky part) ────────────────────────────────
test("aggregate splits Cr by method (cash→1110, transfer/cheque→1130) and balances", () => {
  const rows = [
    { total_amount: 9000, payment_method: "transfer" },
    { total_amount: 8000, payment_method: "cash" },
    { total_amount: 7000, payment_method: "โอน" },
  ];
  const built = _buildPayrollPeriodLines(rows, MAP, "เงินเดือนพนักงาน — งวด X");
  assert.ok(built, "must build lines");
  assert.equal(built.grand, 24000);
  assert.equal(sum(built.lines, "debit"), sum(built.lines, "credit"), "Dr must equal Cr");
  assert.equal(sum(built.lines, "debit"), 24000);
  const dr = built.lines.find(l => Number(l.debit) > 0);
  assert.equal(dr.account_code, "5200", "Dr = salary expense (debit_account_code)");
  assert.equal(Number(built.lines.find(l => l.account_code === "1130").credit), 16000, "bank Cr = transfer+โอน");
  assert.equal(Number(built.lines.find(l => l.account_code === "1110").credit), 8000, "cash Cr = cash rows");
});

test("all-cash → no bank line; all-transfer → no cash line (still balanced)", () => {
  const cashOnly = _buildPayrollPeriodLines([{ total_amount: 5000, payment_method: "cash" }], MAP, "d");
  assert.ok(!cashOnly.lines.some(l => l.account_code === "1130"), "no 1130 when all cash");
  assert.equal(sum(cashOnly.lines, "debit"), sum(cashOnly.lines, "credit"));
  const xferOnly = _buildPayrollPeriodLines([{ total_amount: 5000, payment_method: "transfer" }], MAP, "d");
  assert.ok(!xferOnly.lines.some(l => l.account_code === "1110"), "no 1110 when all transfer");
  assert.equal(sum(xferOnly.lines, "debit"), sum(xferOnly.lines, "credit"));
});

test("empty / zero / negative rows → null (no JV)", () => {
  assert.equal(_buildPayrollPeriodLines([], MAP, "d"), null);
  assert.equal(_buildPayrollPeriodLines([{ total_amount: 0 }], MAP, "d"), null);
  assert.equal(_buildPayrollPeriodLines([{ total_amount: -100, payment_method: "cash" }], MAP, "d"), null);
});

test("rounding keeps Dr=Cr exactly (round2 before sum)", () => {
  const rows = [
    { total_amount: 100.005, payment_method: "cash" },
    { total_amount: 200.004, payment_method: "transfer" },
  ];
  const built = _buildPayrollPeriodLines(rows, MAP, "d");
  assert.ok(built);
  assert.equal(sum(built.lines, "debit"), sum(built.lines, "credit"), "balanced after rounding");
});

// ── source-regex: wiring + privacy invariants ──────────────────────────────
const AUTO = fs.readFileSync(path.resolve("modules/accounting/auto_post.js"), "utf8");
const PAYROLL = fs.readFileSync(path.resolve("modules/payroll.js"), "utf8");
const BACKFILL = fs.readFileSync(path.resolve("modules/accounting/backfill.js"), "utf8");

test("auto_post: postPayrollPeriodJournal posts to payroll_period, gated + period description", () => {
  assert.match(AUTO, /export async function postPayrollPeriodJournal/, "must export the aggregate poster");
  assert.match(AUTO, /sourceTable:\s*"payroll_period"/, "source_table must be payroll_period (distinct from staff_payroll)");
  assert.match(AUTO, /_isAfterEffective\(docDate\)/, "must gate on effective date");
  assert.match(AUTO, /เงินเดือนพนักงาน — งวด/, "description must be aggregate (period), no employee name");
});

test("payroll: _markPaid no longer posts per-person JV; aggregate handler wired", () => {
  assert.ok(!/postJournalForPayroll\s*\(/.test(PAYROLL), "must NOT call per-person postJournalForPayroll (privacy leak)");
  assert.match(PAYROLL, /async function _postPayrollPeriodJV/, "must have the period-JV handler");
  assert.match(PAYROLL, /postPayrollPeriodJournal\(/, "handler must call the aggregate poster");
  assert.match(PAYROLL, /window\.App\.confirm/, "must confirm via App.confirm (no native confirm/alert)");
});

test("backfill: salary excluded from expense JV (no double-count) + payroll out of INTEGRITY_CATS", () => {
  assert.match(BACKFILL, /salary-via-payroll-period/, "expenses backfill must skip salary categories");
  // strip comment lines so prose mentioning 'payroll' doesn't match
  const code = BACKFILL.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
  const start = code.indexOf("INTEGRITY_CATS");
  const cats = code.slice(start, code.indexOf("];", start));
  assert.ok(!/key:\s*"payroll"/.test(cats), "INTEGRITY_CATS must not include payroll (period-aggregate, not per-row)");
});
