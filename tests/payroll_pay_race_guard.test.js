// Phase 433 — payroll double-pay race guard
// Run: node --test tests/payroll_pay_race_guard.test.js
//
// Why this exists:
//   Two machines/tabs clicking "จ่าย" on the same staff_payroll row used to BOTH
//   succeed (unconditional PATCH) and then both fired the money side-effects
//   (auto salary expense + payroll JV) → duplicated expense + JV.
//   Phase 433 closes the race in two layers:
//     1. client CAS — PATCH `...&paid_at=is.null` + `Prefer: return=representation`;
//        the loser receives 200 + an EMPTY row set and must bail out BEFORE any
//        side-effect (no expense, no JV, no "paid" audit entry).
//     2. DB backstop — trg_guard_payroll_double_pay (supabase-phase433-payroll-pay-guard.sql)
//        locks paid_at once set: blocks re-pay AND a stale edit clearing it to NULL.
//   Source-level checks only (same pattern as the other payroll guards).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/payroll.js"), "utf8");
const sqlPath = path.resolve("supabase-phase433-payroll-pay-guard.sql");

// extract the _markPaid body only (iron rule: never regex the whole file)
function markPaidBody() {
  const start = src.indexOf("async function _markPaid");
  const end = src.indexOf("async function _createSalaryExpense");
  assert.ok(start > -1, "must find _markPaid");
  assert.ok(end > start, "_createSalaryExpense must follow _markPaid");
  return src.slice(start, end);
}

test("CAS: mark-paid PATCH only targets unpaid rows (&paid_at=is.null)", () => {
  const body = markPaidBody();
  assert.ok(body.includes('"&paid_at=is.null"') || body.includes("&paid_at=is.null"),
    "PATCH URL must carry the paid_at=is.null CAS filter");
  assert.match(body, /Prefer["']?\s*:\s*["']return=representation/,
    "must request the updated rows back to detect the race loser");
});

test("race loser bails out BEFORE money side-effects (no expense / no JV / no paid-audit)", () => {
  const body = markPaidBody();
  const loserIdx = body.indexOf("ถูกจ่ายไปแล้วจากเครื่อง");
  assert.ok(loserIdx > -1, "loser branch with the Thai duplicate-pay toast must exist");
  const expenseIdx = body.indexOf("_createSalaryExpense(");
  const journalIdx = body.indexOf("postJournalForPayroll(");
  const paidAuditIdx = body.indexOf('logActivity("payroll_pay"');
  assert.ok(expenseIdx > -1 && journalIdx > -1 && paidAuditIdx > -1, "winner side-effects must still exist");
  assert.ok(loserIdx < expenseIdx, "loser bail-out must come before the expense side-effect");
  assert.ok(loserIdx < journalIdx, "loser bail-out must come before the JV side-effect");
  assert.ok(loserIdx < paidAuditIdx, "loser bail-out must come before the paid audit log");
  // the bail-out path must actually return
  const loserSlice = body.slice(loserIdx, expenseIdx);
  assert.match(loserSlice, /return;/, "loser branch must return before side-effects");
});

test("race loser is traced in the audit log (payroll_pay_race_blocked)", () => {
  const body = markPaidBody();
  assert.ok(body.includes('logActivity("payroll_pay_race_blocked"'),
    "blocked double-pay must be traceable in audit log");
});

test("winner path unchanged: expense + JV fired exactly once each", () => {
  const body = markPaidBody();
  assert.equal((body.match(/_createSalaryExpense\(/g) || []).length, 1,
    "exactly one expense side-effect call");
  assert.equal((body.match(/postJournalForPayroll\(/g) || []).length, 1,
    "exactly one JV side-effect call");
});

test("stale local pre-check (idempotent guard) is retained as the first cheap gate", () => {
  const body = markPaidBody();
  assert.ok(body.includes("idempotent guard"), "local paid_at pre-check must stay");
});

test("SQL backstop file: trigger locks paid_at once set (re-run safe, additive only)", () => {
  assert.ok(fs.existsSync(sqlPath), "supabase-phase433-payroll-pay-guard.sql must exist");
  const sql = fs.readFileSync(sqlPath, "utf8");
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\._guard_payroll_paid_lock\(\)/, "guard function");
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_guard_payroll_double_pay ON public\.staff_payroll/, "re-run safe drop");
  assert.match(sql, /CREATE TRIGGER trg_guard_payroll_double_pay/, "trigger created");
  assert.match(sql, /BEFORE UPDATE ON public\.staff_payroll/, "BEFORE UPDATE trigger");
  assert.match(sql, /WHEN \(OLD\.paid_at IS NOT NULL\)/, "fires only for already-paid rows");
  assert.match(sql, /NEW\.paid_at IS DISTINCT FROM OLD\.paid_at/, "same-value edits must pass (current edit flow)");
  assert.match(sql, /RAISE EXCEPTION 'Phase433/, "blocks with a traceable error");
  assert.ok(!/CREATE POLICY|DROP POLICY|ALTER POLICY/.test(sql), "must not touch RLS policies");
  assert.ok(!/total_amount/.test(sql), "must not touch the DB-generated total_amount");
});
