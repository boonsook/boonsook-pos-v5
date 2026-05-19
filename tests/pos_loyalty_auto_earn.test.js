// Phase 91.1 — Regression tests for POS checkout auto-earn loyalty points
//
// Goal: when a POS sale completes with a selected customer, fire earnPoints()
// against the loyalty module so the customer accrues points automatically —
// no admin trip to the Manual tab needed.
//
// Invariants this test locks in:
//   1. Capture happens BEFORE state reset (L1202 clears _posCustomer)
//   2. Earn fires AFTER xhrPostPOS("sales", ...) succeeds (saleId is needed as refId)
//   3. Gate at call site: only fires when customer + is_active + points_per_baht>0
//   4. Uses actualTotal as the amount basis (customer-paid, post-VAT)
//   5. Refers to the sale via refType='sale' + refId=saleId
//   6. Fire-and-forget pattern (no await on the import().then(...))
//   7. Dynamic import has the ?v=APP_BUILD cache-bust (avoid Phase 90.7 ESM stale)
//
// Source-level checks only — running the real POS would need a full browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const posSrc = readFileSync(path.join(__dirname, "..", "modules", "pos.js"), "utf8");

test("pos.js captures customer id BEFORE state reset (L1202 clears _posCustomer)", () => {
  // The capture line must exist and reference _posCustomer with optional chaining.
  assert.ok(
    /const\s+_earnCustomerId\s*=\s*_posCustomer\?\.id/.test(posSrc),
    "pos.js must capture `_earnCustomerId = _posCustomer?.id` before the state-reset block clears _posCustomer"
  );
  assert.ok(
    /const\s+_earnAmount\s*=\s*actualTotal/.test(posSrc),
    "pos.js must capture `_earnAmount = actualTotal` (customer-paid total) for the earn call"
  );
});

test("capture must happen AFTER the sales insert succeeds (saleId is needed as refId)", () => {
  const captureIdx = posSrc.search(/const\s+_earnCustomerId\s*=/);
  const insertIdx = posSrc.search(/xhrPostPOS\(\s*["']sales["']/);
  assert.ok(insertIdx >= 0, "pos.js must still call xhrPostPOS('sales', ...)");
  assert.ok(captureIdx > insertIdx, "capture must occur after the sales insert (we need saleId to be set)");
});

test("capture must happen BEFORE the post-checkout state-reset that nulls _posCustomer", () => {
  // There are several `_posCustomer = null` sites (init, manual clear button, post-checkout reset).
  // We care specifically about the post-checkout reset — anchor it by the inline Thai comment.
  const captureIdx = posSrc.search(/const\s+_earnCustomerId\s*=\s*_posCustomer\?\.id/);
  const postCheckoutClearIdx = posSrc.search(/_posCustomer\s*=\s*null;\s*\/\/\s*เคลียร์ลูกค้าหลังจบบิล/);
  assert.ok(captureIdx >= 0, "capture site `_earnCustomerId = _posCustomer?.id` must exist");
  assert.ok(postCheckoutClearIdx >= 0, "post-checkout `_posCustomer = null; // เคลียร์ลูกค้าหลังจบบิล` must still exist");
  assert.ok(
    captureIdx < postCheckoutClearIdx,
    "capture must run before the post-checkout reset — otherwise we'd capture null and skip every earn"
  );
});

test("call site gates on customer + is_active + points_per_baht > 0", () => {
  // The if-condition must reference all three. Order doesn't matter, but all three must appear in the same condition block.
  const guardMatch = posSrc.match(/if\s*\(\s*_earnCustomerId[\s\S]{0,300}?\)\s*\{/);
  assert.ok(guardMatch, "auto-earn must be wrapped in a guard starting with `if (_earnCustomerId ...)`");
  const guard = guardMatch[0];
  assert.ok(/is_active/.test(guard), "guard must check loyaltySettings?.is_active");
  assert.ok(/points_per_baht/.test(guard), "guard must check points_per_baht > 0 (skip when rate not configured)");
});

test("earnPoints is called with (customerId, amount, 'sale', saleId, ctx)", () => {
  // Lock in the call signature so future refactors of earnPoints can spot the call site.
  const callMatch = posSrc.match(/\.earnPoints\(\s*_earnCustomerId\s*,\s*_earnAmount\s*,\s*['"]sale['"]\s*,\s*saleId\s*,/);
  assert.ok(
    callMatch,
    "pos.js must call .earnPoints(_earnCustomerId, _earnAmount, 'sale', saleId, ctx) — exact arg order matches modules/loyalty.js:60"
  );
});

test("dynamic import URL must include ?v=APP_BUILD cache-bust (Phase 90.7)", () => {
  // Without ?v=APP_BUILD, a new build can serve a stale parsed loyalty.js from the
  // browser's ESM registry — exactly the trap Phase 90.7 closed for main.js's _bustedUrl.
  assert.ok(
    /import\(\s*['"]\.\/loyalty\.js\?v=['"][\s+]*\+/.test(posSrc) ||
      /import\(\s*['"`]\.\/loyalty\.js\?v=\$\{/.test(posSrc),
    "loyalty.js dynamic import must include ?v=APP_BUILD cache-bust"
  );
  assert.ok(
    /window\.APP_BUILD/.test(posSrc.split("postJournalForSale").pop() || ""),
    "the ?v= value must come from window.APP_BUILD (not a hard-coded number)"
  );
});

test("auto-earn must be fire-and-forget — no top-level await on the import chain", () => {
  // Locate the import('./loyalty.js?v= ... ).then(m => m.earnPoints(...)).catch(...)
  // chain and verify there's no preceding `await` that would block checkout completion.
  const earnLine = posSrc.match(/[^\n]*import\(\s*['"`]\.\/loyalty\.js[\s\S]*?\.catch\(/);
  assert.ok(earnLine, "earn dynamic-import chain must exist with a trailing .catch");
  assert.ok(
    !/await\s+import\(\s*['"`]\.\/loyalty\.js/.test(posSrc),
    "earn import must NOT be awaited — block checkout UX → bad. Pattern matches postJournalForSale fire-and-forget."
  );
});

test("auto-earn failures are swallowed (.catch on the chain — never throws into checkout flow)", () => {
  // The .then(...).catch(...) chain must catch errors from both the import() and the earnPoints() resolution.
  // We assert the .catch exists with a console.warn or similar diagnostic — not a silent { }.
  const chunk = posSrc.match(/import\(\s*['"`]\.\/loyalty\.js[\s\S]{0,800}?\.catch\([\s\S]{0,200}?\)/);
  assert.ok(chunk, "earn chain must end with a .catch");
  assert.ok(
    /console\.warn|console\.error/.test(chunk[0]),
    "earn .catch must log via console.warn / console.error — silent swallow hides real bugs"
  );
});
