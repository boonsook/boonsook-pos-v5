// Phase 90.13 — Regression tests for history modal click-outside listener
//
// Bug shape (pre-fix): showPointHistory(...) attached a click listener to
// #loyalty-history-modal on every call. Each open stacked another listener
// on the same element. The action itself is idempotent (set display:none),
// but it's a real DOM listener leak that grows with usage — and any future
// handler logic added to the same listener would fire N times.
//
// Fix: bind the close-on-background-click listener ONCE in renderLoyaltyPage,
// alongside the existing close-button listener (which was already one-shot).
// showPointHistory only toggles display, never re-binds.
//
// Source-level checks — pattern matches tests/loyalty_settings_admin_guard.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loyaltySrc = readFileSync(path.join(__dirname, "..", "modules", "loyalty.js"), "utf8");

function extractFn(src, fnName) {
  const start = src.indexOf(`function ${fnName}(`);
  if (start < 0) return null;
  const after = src.slice(start);
  const closeMatch = after.match(/\n}\n/);
  if (!closeMatch) return null;
  return after.slice(0, closeMatch.index + closeMatch[0].length);
}

test("showPointHistory must NOT attach a click listener to the modal (would stack on every open)", () => {
  const fnBody = extractFn(loyaltySrc, "showPointHistory");
  assert.ok(fnBody, "showPointHistory must exist in modules/loyalty.js");

  // The buggy form. Reject any addEventListener call on the modal reference.
  // Allow comment/doc strings to mention it (Phase 90.13 explainer is fine),
  // but no live `modal.addEventListener` / `modal?.addEventListener` calls.
  // Strip line comments first so the regex doesn't trip on the explainer.
  const noComments = fnBody.replace(/\/\/[^\n]*/g, "");
  assert.ok(
    !/modal\??\.addEventListener\(/.test(noComments),
    "showPointHistory must not call modal.addEventListener — bind the listener once in renderLoyaltyPage instead"
  );
});

test("renderLoyaltyPage must bind a one-time click-outside listener on #loyalty-history-modal", () => {
  const fnBody = extractFn(loyaltySrc, "renderLoyaltyPage");
  assert.ok(fnBody, "renderLoyaltyPage must exist");

  // The listener must target the history modal element. Either form is accepted:
  //   document.getElementById('loyalty-history-modal')?.addEventListener('click', ...)
  //   const m = document.getElementById('loyalty-history-modal'); m.addEventListener('click', ...);
  // What matters: the modal id appears, addEventListener('click', ...) appears,
  // and the body sets display = 'none' on background click.
  const hasModalRef = /loyalty-history-modal/.test(fnBody);
  const hasClickListener = /addEventListener\(\s*['"]click['"]/.test(fnBody);
  const hasBackgroundClose = /e\.target\s*===\s*this/.test(fnBody) || /event\.target\s*===\s*this/.test(fnBody);

  assert.ok(hasModalRef, "renderLoyaltyPage must reference #loyalty-history-modal");
  assert.ok(hasClickListener, "renderLoyaltyPage must register a 'click' listener (for background close)");
  assert.ok(
    hasBackgroundClose,
    "renderLoyaltyPage's modal click handler must gate on `e.target === this` so child clicks don't close the modal"
  );
});

test("the close listener still hides the modal (display:none) on background click", () => {
  const fnBody = extractFn(loyaltySrc, "renderLoyaltyPage") || "";
  // The handler body should set `style.display = 'none'` after the e.target check.
  // Grab a slice around the e.target === this guard and look for the hide statement.
  const idx = fnBody.search(/e\.target\s*===\s*this/);
  assert.ok(idx >= 0, "background-click guard must exist");
  const after = fnBody.slice(idx, idx + 200);
  assert.ok(
    /display\s*=\s*['"]none['"]/.test(after) || /style\.display\s*=\s*['"]none['"]/.test(after),
    "background click handler must hide the modal (display:none) — otherwise clicking outside does nothing"
  );
});

test("close button listener (Phase 89.23) is preserved — not removed alongside the leak fix", () => {
  // Sanity: the existing one-shot close-button listener should remain.
  const fnBody = extractFn(loyaltySrc, "renderLoyaltyPage") || "";
  assert.ok(
    /loyalty-history-close/.test(fnBody),
    "renderLoyaltyPage must still bind the close (✕) button — bug fix is scoped to the background click only"
  );
});
