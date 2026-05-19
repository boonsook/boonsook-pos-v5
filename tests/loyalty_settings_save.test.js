// Phase 90.4 — Regression tests for loyalty settings save button (real bug fix)
//
// Bug discovered via Phase 89.40 ESLint audit (no-unreachable warning at
// modules/loyalty.js:417). Confirmed manually:
//
//   function renderSettingsTab(settings, ctx) {
//     return `<button id="loyalty-save-settings">...</button>`;  // ← line 384
//
//     // UNREACHABLE — setTimeout never executes
//     setTimeout(() => {
//       document.getElementById('loyalty-save-settings')
//         ?.addEventListener('click', ...);   // ← line 418 — handler never attached
//     }, 0);
//   }
//
// Impact: ปุ่ม "บันทึกการตั้งค่า" ใน Loyalty Settings tab broken since
// at least Phase 89 era — user clicks but nothing happens (silent fail).
//
// Reference pattern that works: renderSummaryTab at loyalty.js:275 —
//   const html = searchHtml + tableHtml;
//   setTimeout(() => { ... attach listeners ... }, 0);
//   return html;
//
// Fix: capture html in const, move setTimeout BEFORE return.
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loyaltySrc = readFileSync(path.join(__dirname, "..", "modules", "loyalty.js"), "utf8");

// Extract the renderSettingsTab function body for inspection
function extractFn(src, fnName) {
  const start = src.indexOf(`function ${fnName}(`);
  if (start < 0) return null;
  // Find matching closing brace (naive — relies on consistent indentation:
  // top-level function ends with `\n}\n`)
  const after = src.slice(start);
  const closeMatch = after.match(/\n}\n/);
  if (!closeMatch) return null;
  return after.slice(0, closeMatch.index + closeMatch[0].length);
}

test("renderSettingsTab: setTimeout MUST come BEFORE return (otherwise click handler unreachable)", () => {
  const fnBody = extractFn(loyaltySrc, "renderSettingsTab");
  assert.ok(fnBody, "renderSettingsTab function must exist in modules/loyalty.js");

  // Statement-level matches only (^\s* after newline) — avoid false positives
  // from the word "return" appearing inside comments or string literals.
  const setTimeoutMatch = fnBody.match(/\n\s*setTimeout\(/);
  const returnMatch = fnBody.match(/\n\s*return\s/);

  assert.ok(setTimeoutMatch, "renderSettingsTab must contain a setTimeout statement (to attach click handler post-render)");
  assert.ok(returnMatch, "renderSettingsTab must contain a return statement");
  assert.ok(
    setTimeoutMatch.index < returnMatch.index,
    `setTimeout statement (idx ${setTimeoutMatch.index}) must come BEFORE return statement (idx ${returnMatch.index}) — ` +
      `otherwise the click handler is unreachable and ` +
      `'บันทึกการตั้งค่า' silently fails (no-unreachable real bug from Phase 89.40 audit).`
  );
});

test("renderSettingsTab: returns rendered HTML containing the save button id", () => {
  const fnBody = extractFn(loyaltySrc, "renderSettingsTab");
  assert.ok(fnBody, "renderSettingsTab function must exist");
  assert.ok(
    fnBody.includes('id="loyalty-save-settings"'),
    "rendered HTML must contain the save button so the click handler can find it via getElementById"
  );
});

test("renderSettingsTab: still attaches a click listener for #loyalty-save-settings", () => {
  const fnBody = extractFn(loyaltySrc, "renderSettingsTab");
  assert.ok(fnBody, "renderSettingsTab function must exist");
  // The handler should reference the button id inside addEventListener flow
  assert.ok(
    /getElementById\(['"]loyalty-save-settings['"]\)[^;]*addEventListener\(['"]click['"]/.test(fnBody),
    "must still register a click listener for #loyalty-save-settings — the fix only reorders, not removes"
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Phase 90.6 — additional regression: the previous "save handler still calls
// _appXhrPatch" test only checked the function NAME, not its argument shape.
// That oversight let the BROKEN call slip through Phase 90.4: the handler
// was calling _appXhrPatch with a REST URL + callback (Express-style) when
// the helper actually expects (table, payload, eqCol, eqVal) and returns a
// Promise<{ok, data, error}>. As a result production build 244 still silently
// failed to save loyalty settings.
//
// These tests now lock in the correct contract.
// ───────────────────────────────────────────────────────────────────────────
test("Phase 90.6 — save handler must NOT pass a REST URL as the first arg to _appXhrPatch", () => {
  const fnBody = extractFn(loyaltySrc, "renderSettingsTab");
  assert.ok(fnBody, "renderSettingsTab function must exist");
  assert.ok(
    !/window\._appXhrPatch\(\s*[`'"]\/api\/loyalty-settings/.test(fnBody),
    "_appXhrPatch first arg is a Supabase table name (e.g. 'loyalty_settings'), NOT a REST URL like '/api/loyalty-settings/<id>'"
  );
});

test("Phase 90.6 — save handler calls _appXhrPatch with 'loyalty_settings' table + 'id' eqCol", () => {
  const fnBody = extractFn(loyaltySrc, "renderSettingsTab");
  assert.ok(fnBody, "renderSettingsTab function must exist");
  // Expect: window._appXhrPatch('loyalty_settings', <payload>, 'id', <id>)
  assert.ok(
    /window\._appXhrPatch\(\s*['"]loyalty_settings['"]\s*,/.test(fnBody),
    "1st arg must be the Supabase table name 'loyalty_settings'"
  );
  assert.ok(
    /window\._appXhrPatch\(\s*['"]loyalty_settings['"]\s*,[^)]*,\s*['"]id['"]\s*,/.test(fnBody),
    "3rd arg (eqCol) must be the literal string 'id' so the helper builds ?id=eq.<id>"
  );
});

test("Phase 90.6 — save handler must NOT pass a callback to _appXhrPatch (it returns a Promise)", () => {
  const fnBody = extractFn(loyaltySrc, "renderSettingsTab");
  assert.ok(fnBody, "renderSettingsTab function must exist");
  // Catch the Express-style callback misuse: _appXhrPatch(..., (success) => { ... })
  assert.ok(
    !/_appXhrPatch\([^)]*,\s*\(\s*success\s*\)\s*=>/.test(fnBody),
    "_appXhrPatch returns Promise<{ok, data, error}> — must be awaited, not passed a (success)=>{} callback"
  );
});

test("Phase 90.6 — save flow awaits the result and branches on result.ok", () => {
  const fnBody = extractFn(loyaltySrc, "renderSettingsTab");
  assert.ok(fnBody, "renderSettingsTab function must exist");
  // Either the call is awaited (await _appXhrPatch(...)) OR the result is
  // captured into a variable that is then checked for .ok.
  const awaitsResult =
    /await\s+window\._appXhrPatch\(/.test(fnBody) ||
    /=\s*await\s+window\._appXhrPatch\(/.test(fnBody);
  assert.ok(awaitsResult, "save handler must `await` _appXhrPatch (it returns a Promise)");
  // Result branching: success toast on result.ok, error toast otherwise
  assert.ok(
    /\?\.ok|\.ok\b/.test(fnBody),
    "save handler must read the .ok field of the Promise result to decide success vs error"
  );
});

test("Phase 90.6 — first-time setup fallback: POST to 'loyalty_settings' when settings.id missing", () => {
  const fnBody = extractFn(loyaltySrc, "renderSettingsTab");
  assert.ok(fnBody, "renderSettingsTab function must exist");
  // line_notify.js uses the same pattern (Phase 89.44 reference) — PATCH if id, else POST.
  // Without this, a brand-new shop with no row in loyalty_settings yet cannot save.
  assert.ok(
    /window\._appXhrPost\(\s*['"]loyalty_settings['"]/.test(fnBody),
    "save handler must fall back to window._appXhrPost('loyalty_settings', ...) when settings.id is missing — otherwise first-time setup is impossible"
  );
});

test("Phase 90.6 — payload must NOT include the 'id' field (it's the WHERE-clause value, not a column update)", () => {
  const fnBody = extractFn(loyaltySrc, "renderSettingsTab");
  assert.ok(fnBody, "renderSettingsTab function must exist");
  // The newSettings object literal should not contain `id: settings.id` since
  // id is passed as the 4th eqVal arg to _appXhrPatch. Sending it in the body
  // is harmless on PATCH but redundant and would block a POST insert (id is
  // server-generated for first-time setup).
  // Permissive check: look for "id:" inside the newSettings object construction.
  // (Accept either no id field at all OR an explicit comment that excludes it.)
  const newSettingsLiteralMatch = fnBody.match(/const\s+newSettings\s*=\s*\{[^}]*\}/);
  assert.ok(newSettingsLiteralMatch, "must construct a newSettings object literal for the payload");
  const lit = newSettingsLiteralMatch[0];
  assert.ok(
    !/^\s*id\s*:/m.test(lit) && !/[{,]\s*id\s*:/.test(lit),
    "newSettings payload must not include an `id:` field — it's the WHERE value (4th arg) for PATCH, and server-generated for POST"
  );
});
