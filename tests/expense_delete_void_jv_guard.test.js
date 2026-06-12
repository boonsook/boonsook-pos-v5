// Phase 388 — expense-delete-orphan-jv (HIGH · money path §4.8)
// Run: node --test tests/expense_delete_void_jv_guard.test.js
//
// Why this exists:
//   Deleting an expense auto-posts nothing, but the expense's auto-posted JV must
//   be voided too — otherwise the JV lives on in journal_entries as an "orphan"
//   (phantom expense in the books). Edit already voids+reposts; DELETE did not,
//   creating orphans (root cause behind the PV2069/หลวงพี่ cleanups).
//   sales/receipts/delivery_invoices/payroll all void on delete — expenses must too.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(path.resolve("modules/expenses.js"), "utf8");

test("expenses.js imports voidJvForSource", () => {
  assert.match(SRC, /import\s*\{[^}]*voidJvForSource[^}]*\}\s*from\s*["']\.\/accounting\/auto_post\.js["']/);
});

test("both edit AND delete paths void the linked JV (>=2 calls for 'expenses')", () => {
  const calls = SRC.match(/voidJvForSource\(\s*["']expenses["']/g) || [];
  assert.ok(calls.length >= 2, `expected >=2 voidJvForSource("expenses") calls (edit+delete), got ${calls.length}`);
});

test("delete handler voids JV BEFORE deleting the expense row (no orphan)", () => {
  const i = SRC.indexOf('querySelectorAll(".exp-delete-btn")');
  assert.ok(i > -1, "delete handler not found");
  const block = SRC.slice(i, i + 1000);
  assert.match(block, /voidJvForSource\(\s*["']expenses["']/, "delete handler must void JV");
  const vi = block.indexOf("voidJvForSource");
  const di = block.indexOf("_appXhrDelete");
  assert.ok(vi > -1 && di > -1 && vi < di, "must void JV before _appXhrDelete (avoid orphan JV)");
});

test("delete handler awaits DELETE result and reports failure before success toast", () => {
  const i = SRC.indexOf('querySelectorAll(".exp-delete-btn")');
  assert.ok(i > -1, "delete handler not found");
  const block = SRC.slice(i, i + 1500);
  const delIdx = block.indexOf("const delRes = await window._appXhrDelete");
  const failIdx = block.indexOf("if (delRes && !delRes.ok)");
  const successIdx = block.indexOf('showToast("ลบรายจ่ายเรียบร้อย"');
  const catchIdx = block.indexOf('showToast("❌ ลบรายจ่ายไม่สำเร็จ: "');
  assert.ok(delIdx > -1, "delete must await _appXhrDelete result");
  assert.ok(failIdx > delIdx, "delete must check failed result");
  assert.ok(successIdx > failIdx, "success toast must happen only after delete result check");
  assert.ok(catchIdx > successIdx, "delete errors must be surfaced to the user");
});
