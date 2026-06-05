// Phase 370 service-job-block-save-on-insufficient (Part 2 reverted in Phase 371)
// Run: node --test tests/service_job_block_save_guard.test.js
//
// Why this exists:
//   The pre-save stock check in ac_install / service_form / solar already throws (blocks POST)
//   when a MOBILE warehouse is short and the home warehouse cannot cover the transfer. But the
//   branch `if (isHome) continue;` skipped the case "user picked the HOME warehouse and home is
//   short" — so the job got POSTed, the Phase 369 deduct failed-clean (no negative write), and the
//   job was "saved but stock not deducted", warned only by a toast.
//   Phase 370 part 1 (KEPT): turn that `continue` into a `throw` (hard block before POST).
//   Phase 370 part 2 (REVERTED in Phase 371 — out of scope, owner did not ask for it): the
//   post-save best-effort STOCK_UNRESOLVED note-flag was removed; the stockOpsFailed block is back
//   to its build-369 form (toast only). The 4th test per file now asserts that flag is ABSENT.
//
// These are closures inside large modules, so we assert on file source structure, scoped per file.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const FILES = [
  { tag: "ac_install", file: "modules/ac_install.js", homeStockHelper: "_getHomeStock" },
  { tag: "service_form", file: "modules/service_form.js", homeStockHelper: "_getHomeStock" },
  { tag: "solar", file: "modules/solar.js", homeStockHelper: "_solGetHomeStock" },
];

function read(rel) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

for (const { tag, file, homeStockHelper } of FILES) {
  const src = read(file);

  test(`${tag}: no leftover "if (isHome) continue" (home-insufficient must block, not skip)`, () => {
    assert.ok(
      !/if\s*\(isHome\)\s*continue/.test(src),
      `${file}: "if (isHome) continue" must be removed (it let home-short jobs save with no deduct)`
    );
  });

  test(`${tag}: isHome branch now throws to block save before POST`, () => {
    assert.match(
      src,
      /if\s*\(isHome\)\s*\{[\s\S]{0,260}throw new Error/,
      `${file}: isHome branch must throw (block save) instead of continue`
    );
  });

  test(`${tag}: non-home shortage path preserved (throw + transfersNeeded.push + confirm dialog)`, () => {
    // home cannot cover shortage -> still throws "ของไม่พอ"
    assert.match(
      src,
      new RegExp(`if\\s*\\(!homeStock\\s*\\|\\|\\s*homeStock\\.stock\\s*<\\s*shortage\\)\\s*\\{[\\s\\S]{0,160}throw new Error`),
      `${file}: non-home "home cannot cover" throw must stay`
    );
    // mobile short + home covers -> still queues a transfer (not weakened)
    assert.ok(src.includes("transfersNeeded.push("), `${file}: transfersNeeded.push must stay`);
    // confirm dialog before auto-transfer still present
    assert.ok(
      src.includes("window.App?.confirm?.(msg)"),
      `${file}: confirm-transfer dialog must stay`
    );
    // home-stock helper still used (read-only) in non-home path
    assert.ok(src.includes(`${homeStockHelper}(prod, state)`), `${file}: ${homeStockHelper} must stay`);
  });

  test(`${tag}: NO post-save reconcile flag (Phase 371 — Part 2 reverted, out of scope)`, () => {
    // Phase 370 added a best-effort STOCK_UNRESOLVED note-flag (Part 2) that the owner did not
    // ask for; Phase 371 removed it. The stockOpsFailed block must be back to build-369 form:
    // just a toast, no PATCH-by-id of service_jobs.
    assert.ok(!src.includes("STOCK_UNRESOLVED"), `${file}: STOCK_UNRESOLVED flag must be removed`);
    assert.ok(
      !src.includes('service_jobs?id=eq.${jobId}'),
      `${file}: no PATCH-by-id of service_jobs (Part 2 reverted)`
    );
    // the existing warn toast must stay (build-369 behavior)
    assert.ok(
      src.includes("ใบงาน save แล้ว แต่ตัดสต็อก"),
      `${file}: stockOpsFailed toast must stay`
    );
  });
}
