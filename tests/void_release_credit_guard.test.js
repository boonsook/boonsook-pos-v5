// tests/void_release_credit_guard.test.js
// Phase B4 (build 533) — voiding/deleting a sale must RELEASE the customer credit (2180)
// Run: node --test tests/void_release_credit_guard.test.js
//
// Bug (BUG_AUDIT 2026-06-25 · B4): when a sale paid (partly) with customer credit
//   (sales.credit_used_amount > 0) is voided/deleted, modules/sales.js reverses the JV
//   (a), reverts stock (b) and reverses loyalty (c) — but never calls
//   release_customer_credit. The credit redeemed at checkout (ledger -amount) is
//   therefore lost: the customer's usable credit never comes back and
//   customer_credit_ledger diverges from GL 2180 (the void JV restores Cr 2180 in the
//   ledger of accounts, but the per-customer credit ledger is not restored).
//
// Fix: pos.js exposes window._appReleaseCheckoutCredit (= _releaseAndLog, which POSTs
//   the idempotent release_customer_credit RPC), and the void flow adds step (d):
//   if credit_used_amount > 0 → release using the sale's checkout_key as source_key.
//   Best-effort (mirror a/b/c); idempotent per source_key so re-void is safe.
//
// This guard locks the wiring (source-regex) so the release cannot be dropped, fire for
// non-credit sales, or be reordered before the other compensations.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SALES = fs.readFileSync(path.resolve("modules/sales.js"), "utf8");
const POS = fs.readFileSync(path.resolve("modules/pos.js"), "utf8");

test("pos.js exposes window._appReleaseCheckoutCredit wrapping release_customer_credit", () => {
  assert.match(
    POS,
    /window\._appReleaseCheckoutCredit\s*=\s*_releaseAndLog/,
    "must expose window._appReleaseCheckoutCredit = _releaseAndLog",
  );
  assert.match(
    POS,
    /_releaseAndLog[\s\S]*?rpc\/release_customer_credit/,
    "_releaseAndLog must POST the release_customer_credit RPC",
  );
});

test("void flow calls the release helper with the sale's checkout_key", () => {
  assert.match(
    SALES,
    /window\._appReleaseCheckoutCredit\(\s*srcKey/,
    "release must pass the sale's checkout_key (srcKey) as source_key",
  );
  assert.match(SALES, /credit_used_amount/, "void must read the sale's credit_used_amount");
  assert.match(SALES, /\bcheckout_key\b/, "void must read the sale's checkout_key");
});

test("release runs ONLY for credit sales (guarded by creditUsed > 0 && srcKey)", () => {
  assert.match(
    SALES,
    /creditUsed\s*>\s*0\s*&&\s*srcKey\s*&&\s*window\._appReleaseCheckoutCredit/,
    "release must be guarded by creditUsed>0 && srcKey (no-op for non-credit/legacy sales)",
  );
});

test("release (d) is ordered AFTER void-JV / revert-stock / reverse-loyalty", () => {
  const idxLoyalty = SALES.indexOf("reverseEarnedPointsForSale");
  const idxRelease = SALES.indexOf("_appReleaseCheckoutCredit");
  assert.ok(idxLoyalty !== -1 && idxRelease !== -1, "both markers must exist in sales.js");
  assert.ok(idxRelease > idxLoyalty, "release credit (d) must come after reverse-loyalty (c)");
});

test("release failure is surfaced, not silent (§4.8)", () => {
  assert.match(
    SALES,
    /relOk\s*\?[\s\S]{0,80}?:\s*["']⚠️ คืนเครดิต fail/,
    "release fail must push a visible sideEffect (not swallowed)",
  );
});
