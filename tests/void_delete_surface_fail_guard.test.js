// Phase 539 (S7/S8) — void/delete must NOT show a fake "✅ เรียบร้อย" when a money/stock
// side-effect failed silently.
// Run: node --test tests/void_delete_surface_fail_guard.test.js
//
// BUG_AUDIT_2026-06-25:
//   S7 sales.js delete: void-JV / revert-stock / reverse-loyalty / release-credit are best-effort.
//     On failure the old code appended a "⚠️ … fail" note but STILL led the toast with
//     "ลบรายการขายเรียบร้อย ✅" → a failed accounting/stock reversal reads as success.
//   S8 service_jobs.js delete: if restoreServiceJobStock() THREW, the catch only console.error'd,
//     _restore stayed {restored:false,errors:[]}, and the flow fell through to "ลบงานช่างเรียบร้อย ✅"
//     while the stock was NOT returned — silent.
// Fix: track real failures, downgrade the toast to a warning (suppress the ✅), and report via
//   window._errorReporter.captureMessage for an audit trail. Side-effect execution is unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SALES = fs.readFileSync(path.resolve("modules/sales.js"), "utf8");
const JOBS = fs.readFileSync(path.resolve("modules/service_jobs.js"), "utf8");

// ───────────────────────────────────────────────
// S7 — sales delete
// ───────────────────────────────────────────────

test("S7: sales delete tracks real failures separately from success notes", () => {
  assert.match(SALES, /const failures = \[\]/, "must track a failures array");
  // every money/stock side-effect failure path feeds `failures`, not the success-notes array
  assert.match(SALES, /failures\.push\("ลงบัญชีย้อนกลับ \(void JV\)"\)/, "void-JV fail → failures");
  assert.match(SALES, /failures\.push\("คืนสต็อก"\)/, "revert-stock exception → failures");
  assert.match(SALES, /failures\.push\("คืนแต้ม loyalty"\)/, "reverse-loyalty fail → failures");
  assert.match(SALES, /failures\.push\("คืนเครดิตลูกค้า"\)/, "release-credit fail → failures");
  // the old pattern of mixing "⚠️ … fail" into the success-notes array must be gone
  assert.ok(!/sideEffects\.push\(\s*["'`]⚠️/.test(SALES), "failures must not be pushed into sideEffects as ⚠️ notes");
});

test("S7: a failed side-effect downgrades the toast (no fake ✅) and is reported", () => {
  assert.match(SALES, /if \(failures\.length\)\s*\{/, "must branch on failures.length");
  assert.match(SALES, /showToast\(`⚠️ ลบบิลแล้ว แต่ \$\{failures\.join/, "failure branch shows a warning toast");
  assert.match(SALES, /captureMessage\?\.\(\s*"sale delete side-effects failed"/, "failure branch reports for audit");
  // the success ✅ must live only in the else branch (i.e. preceded by an else)
  assert.match(SALES, /\}\s*else\s*\{[\s\S]{0,200}showToast\("ลบรายการขายเรียบร้อย ✅"/,
    "the ✅ success toast must be in the else branch (only when there are no failures)");
});

// ───────────────────────────────────────────────
// S8 — service-job delete
// ───────────────────────────────────────────────

test("S8: service-job delete flags a stock-restore problem (throw or partial)", () => {
  assert.match(JOBS, /let stockIssue = false/, "must track a stock-restore issue flag");
  assert.match(JOBS, /stockIssue = true/, "throw/partial must set stockIssue");
  assert.match(JOBS, /captureMessage\?\.\(\s*"service_job delete: restore stock threw"/,
    "the restore-throw path must report for audit (was a bare console.error)");
});

test("S8: the success ✅ is suppressed when stock was not restored", () => {
  assert.match(JOBS, /if \(showToast && !stockIssue\) showToast\("ลบงานช่างเรียบร้อย ✅"\)/,
    "the ✅ toast must be gated on !stockIssue");
  // the ✅ success string must appear exactly once — and only in the gated call (no un-gated copy)
  const okMatches = JOBS.match(/showToast\("ลบงานช่างเรียบร้อย ✅"\)/g) || [];
  assert.equal(okMatches.length, 1, "there must be exactly one (gated) success toast");
  // the restore call itself is unchanged (still runs)
  assert.match(JOBS, /restoreServiceJobStock\(/, "restore is still attempted");
});
