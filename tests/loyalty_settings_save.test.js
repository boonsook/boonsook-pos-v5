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

test("renderSettingsTab: save handler still calls window._appXhrPatch (logic preserved)", () => {
  const fnBody = extractFn(loyaltySrc, "renderSettingsTab");
  assert.ok(fnBody, "renderSettingsTab function must exist");
  assert.ok(
    /window\._appXhrPatch\(\s*`\/api\/loyalty-settings\/\$\{settings\.id\}`/.test(fnBody),
    "save handler must still call window._appXhrPatch with /api/loyalty-settings/<id> — fix is reorder only, do not change save logic"
  );
});
