// Phase 90.12 — Regression tests for runtime admin guard on the loyalty settings save handler.
//
// Defense-in-depth: the settings tab content is already gated at render time
// (renderLoyaltyPage L230 — non-admin sees "เฉพาะผู้ดูแลระบบเท่านั้น" and the
// save button is never rendered). But if a session sees a role downgrade after
// the page rendered, the DOM still holds the wired-up save button. Same problem
// if someone reaches the handler via DevTools injection. Supabase RLS is the
// real gate, but we want a user-visible refusal and zero write attempt on the
// client side too.
//
// Source-level checks — pattern matches tests/loyalty_admin_check.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loyaltySrc = readFileSync(path.join(__dirname, "..", "modules", "loyalty.js"), "utf8");

// Slice out the renderSettingsTab body so assertions don't leak into adjacent functions.
function extractFn(src, fnName) {
  const start = src.indexOf(`function ${fnName}(`);
  if (start < 0) return null;
  const after = src.slice(start);
  const closeMatch = after.match(/\n}\n/);
  if (!closeMatch) return null;
  return after.slice(0, closeMatch.index + closeMatch[0].length);
}

test("renderSettingsTab must destructure requireAdmin from ctx (was previously _requireAdmin = unused)", () => {
  const fnBody = extractFn(loyaltySrc, "renderSettingsTab");
  assert.ok(fnBody, "renderSettingsTab must exist");
  assert.ok(
    /const\s*\{[^}]*\brequireAdmin\b[^}]*\}\s*=\s*ctx/.test(fnBody),
    "renderSettingsTab must destructure { requireAdmin } from ctx — without it the save handler can't call requireAdmin()"
  );
  assert.ok(
    !/requireAdmin:\s*_requireAdmin/.test(fnBody),
    "renderSettingsTab must NOT rename requireAdmin to _requireAdmin — that signals unused, but Phase 90.12 uses it"
  );
});

test("save handler must call requireAdmin?.() and refuse the write on false", () => {
  const fnBody = extractFn(loyaltySrc, "renderSettingsTab") || "";

  // The handler must invoke requireAdmin somewhere — bare reference to the var is not enough.
  assert.ok(
    /requireAdmin\?\.\(\)|requireAdmin\(\)/.test(fnBody),
    "save handler must invoke requireAdmin() (with parens) — bare reference doesn't check the role"
  );

  // Verify the guard sits BEFORE the xhrPatch/xhrPost CALL (not just a comment mention) —
  // otherwise the write happens first and the guard is purely cosmetic.
  const idxGuard = fnBody.search(/requireAdmin\?\.\(\)|requireAdmin\(\)/);
  const idxWrite = fnBody.search(/await\s+window\._appXhr(Patch|Post)\s*\(/);
  assert.ok(idxGuard >= 0, "guard call site must exist");
  assert.ok(idxWrite >= 0, "save still needs to write via await window._appXhrPatch/_appXhrPost(...)");
  assert.ok(
    idxGuard < idxWrite,
    "requireAdmin() check must run BEFORE the network write — otherwise the guard is decoration, not enforcement"
  );
});

test("guard branch must early-return (not just toast then fall through into the write)", () => {
  const fnBody = extractFn(loyaltySrc, "renderSettingsTab") || "";

  // Grab the lines from the guard call to the next semicolon-terminated statement after it.
  // We want to see `return` close to the guard, before the newSettings/payload assembly.
  const guardIdx = fnBody.search(/if\s*\(\s*!requireAdmin/);
  assert.ok(guardIdx >= 0, "guard must be written as `if (!requireAdmin?.())` — a negated runtime check");

  const afterGuard = fnBody.slice(guardIdx, guardIdx + 400);
  assert.ok(
    /\breturn\b/.test(afterGuard),
    "guard branch must `return` — otherwise the handler continues into the write path"
  );
});

test("guard must surface a user-visible refusal via showToast (not silent)", () => {
  const fnBody = extractFn(loyaltySrc, "renderSettingsTab") || "";
  const guardIdx = fnBody.search(/if\s*\(\s*!requireAdmin/);
  assert.ok(guardIdx >= 0, "guard must exist");
  const branch = fnBody.slice(guardIdx, guardIdx + 400);
  assert.ok(
    /showToast/.test(branch),
    "guard branch must call showToast — a silent refusal looks like a broken button to the user"
  );
});

test("renderLoyaltyPage must still hand requireAdmin into ctx (destructure with the real name)", () => {
  const fnBody = extractFn(loyaltySrc, "renderLoyaltyPage") || "";
  assert.ok(
    /\brequireAdmin\b/.test(fnBody) && !/requireAdmin:\s*_requireAdmin/.test(fnBody),
    "renderLoyaltyPage must destructure { requireAdmin } (not aliased to _requireAdmin) so renderSettingsTab receives it via ctx"
  );
});
