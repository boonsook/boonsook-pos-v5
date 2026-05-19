// Phase 90.11 — Regression tests for periodic SW update in boot.js
//
// Goal: long-lived sessions should not sit on an old build until the user
// manually reloads. We trigger `reg.update()` periodically (~10 min) and on
// tab `visibilitychange` so the existing watchForUpdate() → updatefound →
// showUpdateBanner() flow has a chance to surface the new build.
//
// CRITICAL invariant tested below: the new code paths must NOT call
// location.reload() / location.replace() / hardReload themselves. Reload
// stays owned by the existing controllerchange handler (which only fires
// after the user clicks "อัปเดตเลย" in the banner). Otherwise a periodic
// timer would yank the page out from under an active user.
//
// Source-level checks only — pattern matches tests/lazy_import_cache_bust.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bootSrc = readFileSync(path.join(__dirname, "..", "boot.js"), "utf8");

function extractFn(src, fnName) {
  const start = src.indexOf(`function ${fnName}(`);
  if (start < 0) return null;
  const after = src.slice(start);
  const closeMatch = after.match(/\n {0,4}}\n/);
  if (!closeMatch) return null;
  return after.slice(0, closeMatch.index + closeMatch[0].length);
}

test("boot.js exposes startPeriodicUpdate that owns periodic + visibilitychange checks", () => {
  const fnBody = extractFn(bootSrc, "startPeriodicUpdate");
  assert.ok(fnBody, "startPeriodicUpdate must exist in boot.js");
  assert.ok(/setInterval\(/.test(fnBody), "startPeriodicUpdate must schedule a setInterval");
  assert.ok(/visibilitychange/.test(fnBody), "startPeriodicUpdate must listen for visibilitychange");
});

test("both code paths call reg.update() (not reg.unregister or anything else)", () => {
  const fnBody = extractFn(bootSrc, "startPeriodicUpdate") || "";
  const updateCalls = fnBody.match(/reg\.update\(\)/g) || [];
  assert.ok(
    updateCalls.length >= 2,
    "expected reg.update() to be called from BOTH the setInterval body and the visibilitychange handler — found " + updateCalls.length
  );
});

test("startPeriodicUpdate must NOT trigger a reload itself (no location.reload / replace / hardReload)", () => {
  const fnBody = extractFn(bootSrc, "startPeriodicUpdate") || "";
  // Reload belongs to the existing controllerchange handler, which only fires
  // after user-initiated SKIP_WAITING. A periodic timer that reloads would
  // interrupt active work.
  assert.ok(
    !/location\.reload|location\.replace|hardReload\(/.test(fnBody),
    "startPeriodicUpdate must not call location.reload, location.replace, or hardReload — that would yank an active user"
  );
});

test("visibilitychange handler only fires when tab becomes visible (gates on document.hidden)", () => {
  const fnBody = extractFn(bootSrc, "startPeriodicUpdate") || "";
  // We want reg.update() on transitions to visible, not on every hide/show.
  // The cheapest check is `if (document.hidden) return;` early in the handler.
  assert.ok(
    /document\.hidden/.test(fnBody),
    "visibilitychange handler must skip when document.hidden (avoid update() spam when tab loses focus)"
  );
});

test("update errors are swallowed (reg.update() returns a Promise — must .catch to avoid uncaught rejection)", () => {
  const fnBody = extractFn(bootSrc, "startPeriodicUpdate") || "";
  // Either explicit .catch(...) on the promise, or wrapped in try/catch — both fine.
  // The bare `reg.update()` without either would surface uncaught rejection noise in console.
  const hasCatch = /\.catch\(/.test(fnBody);
  const hasTry = /try\s*\{[\s\S]*reg\.update/.test(fnBody);
  assert.ok(
    hasCatch || hasTry,
    "reg.update() failures (offline, throttled, etc.) must be swallowed via .catch or try/catch"
  );
});

test("startPeriodicUpdate is wired into the SW registration .then() — not just defined", () => {
  // It's easy to add a helper and forget to call it. Make sure the call site exists.
  assert.ok(
    /startPeriodicUpdate\(\s*reg\s*\)/.test(bootSrc),
    "startPeriodicUpdate(reg) must be invoked from inside navigator.serviceWorker.register('./sw.js').then(...)"
  );
});
