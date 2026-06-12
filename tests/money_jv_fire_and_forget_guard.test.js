// Guard P1 money paths: source documents may commit successfully, but auto-JV
// posting must not be left as a silent fire-and-forget promise.
//
// Run: node --test tests/money_jv_fire_and_forget_guard.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(file) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

function assertNoPostCatch(src, fnName, moduleName) {
  const re = new RegExp(`${fnName}\\([\\s\\S]{0,500}?\\)\\s*\\.catch\\s*\\(`);
  assert.doesNotMatch(src, re, `${moduleName} must not fire-and-forget ${fnName}().catch(...)`);
}

test("refund auto-JV is awaited and failed post is surfaced", () => {
  const src = read("modules/refunds.js");
  assertNoPostCatch(src, "postJournalForRefund", "refunds.js");
  assert.match(src, /await\s+postJournalForRefund\(/, "refund JV post must be awaited");
  assert.match(src, /postJournalForRefund\([^;]+,\s*\{\s*detailed:\s*true\s*\}/, "refund JV post must request detailed result");
  assert.match(src, /ลงบัญชีอัตโนมัติไม่สำเร็จ/, "refund JV failure must warn the user");
});

test("credit payment auto-JV is awaited and failed post is surfaced", () => {
  const src = read("modules/credit_tracker.js");
  assertNoPostCatch(src, "postJournalForCreditPayment", "credit_tracker.js");
  assert.match(src, /await\s+postJournalForCreditPayment\(/, "credit payment JV post must be awaited");
  assert.match(src, /postJournalForCreditPayment\([\s\S]+,\s*\{\s*detailed:\s*true\s*\}/, "credit payment JV post must request detailed result");
  assert.match(src, /ลงบัญชีอัตโนมัติไม่สำเร็จ/, "credit payment JV failure must warn the user");
});

test("receipt paid auto-JV is awaited and failed post is surfaced", () => {
  const src = read("modules/receipts.js");
  assertNoPostCatch(src, "postJournalForReceipt", "receipts.js");
  const awaitCalls = src.match(/await\s+postJournalForReceipt\(/g) || [];
  assert.ok(awaitCalls.length >= 3, `expected all receipt paid paths to await JV post, got ${awaitCalls.length}`);
  const detailedCalls = src.match(/postJournalForReceipt\([^;]+,\s*\{\s*detailed:\s*true\s*\}/g) || [];
  assert.ok(detailedCalls.length >= 3, `expected all receipt paid paths to request detailed result, got ${detailedCalls.length}`);
  assert.match(src, /ลงบัญชีอัตโนมัติไม่สำเร็จ/, "receipt JV failure must warn the user");
});

test("expense auto-JV is awaited and failed post is surfaced", () => {
  const src = read("modules/expenses.js");
  assertNoPostCatch(src, "postJournalForExpense", "expenses.js");
  const awaitCalls = src.match(/await\s+postJournalForExpense\(/g) || [];
  assert.ok(awaitCalls.length >= 3, `expected add/edit/autokey expense paths to await JV post, got ${awaitCalls.length}`);
  const detailedCalls = src.match(/postJournalForExpense\([^;]+,\s*\{\s*detailed:\s*true\s*\}/g) || [];
  assert.ok(detailedCalls.length >= 3, `expected add/edit/autokey expense paths to request detailed result, got ${detailedCalls.length}`);
  assert.match(src, /ลงบัญชีอัตโนมัติไม่สำเร็จ/, "expense JV failure must warn the user");
});

test("recurring expense auto-JV is awaited and failed post is surfaced", () => {
  const src = read("modules/recurring_expenses.js");
  assertNoPostCatch(src, "postJournalForExpense", "recurring_expenses.js");
  assert.match(src, /await\s+postJournalForExpense\(/, "recurring expense JV post must be awaited");
  assert.match(src, /postJournalForExpense\([^;]+,\s*\{\s*detailed:\s*true\s*\}/, "recurring expense JV post must request detailed result");
  assert.match(src, /ลงบัญชีอัตโนมัติไม่สำเร็จ/, "recurring expense JV failure must warn the user");
});
