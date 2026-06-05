// Phase 370 service-job-block-save-on-insufficient
// Run: node --test tests/service_job_block_save_guard.test.js
//
// Why this exists:
//   The pre-save stock check in ac_install / service_form / solar already throws (blocks POST)
//   when a MOBILE warehouse is short and the home warehouse cannot cover the transfer. But the
//   branch `if (isHome) continue;` skipped the case "user picked the HOME warehouse and home is
//   short" — so the job got POSTed, the Phase 369 deduct failed-clean (no negative write), and the
//   job was "saved but stock not deducted", warned only by a toast.
//   Phase 370 part 1: turn that `continue` into a `throw` (hard block before POST).
//   Phase 370 part 2: after save, if stock ops fail (race), best-effort flag the job note with
//   STOCK_UNRESOLVED so the silent divergence is at least visible for reconcile.
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

  test(`${tag}: post-save STOCK_UNRESOLVED flag is best-effort (try/catch, no throw, keeps toast)`, () => {
    // existing warn toast preserved
    assert.ok(
      src.includes("ใบงาน save แล้ว แต่ตัดสต็อก/โอนบางรายการล้มเหลว"),
      `${file}: existing stockOpsFailed toast must stay`
    );
    // marker present
    assert.ok(src.includes("STOCK_UNRESOLVED"), `${file}: STOCK_UNRESOLVED marker must be added`);
    // PATCH the saved job (flag note by id)
    assert.match(src, /method:\s*"PATCH"/, `${file}: flag must use PATCH`);
    assert.ok(
      src.includes('service_jobs?id=eq.${jobId}'),
      `${file}: flag PATCH must target the saved jobId`
    );
    // best-effort: the flag block warns on failure, never throws/rolls back
    assert.ok(
      src.includes("flag STOCK_UNRESOLVED failed:") &&
        src.includes("flag STOCK_UNRESOLVED threw:"),
      `${file}: flag must be best-effort (console.warn on !ok and on throw)`
    );
    // no rollback/delete of the saved job in this phase
    assert.ok(
      !/DELETE[\s\S]{0,80}service_jobs\?id=eq\.\$\{jobId\}/.test(src),
      `${file}: must not delete/rollback the saved job`
    );
  });
}
