// Phase 400 — mobile-fix-vertical-text (layout-only)
// Run: node --test tests/mobile_row_layout.test.js
//
// Why this exists:
//   On narrow screens (~360px) Thai account names broke ONE-GLYPH-PER-LINE in the
//   Opening Balance form, because the row was a non-wrapping flex with a fixed 160px
//   input squeezing the name to ~0 width. Phase 400 moves the row to .ob-* classes
//   (flex-wrap + min-width on the name, full-width input under 600px) and hardens the
//   Refunds "top reasons" row the same way. This guards the FIX without touching logic:
//   the input id (ob_${code}) the save reads, escHtml, and the bar/pct logic must stay.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ob = fs.readFileSync(path.resolve("modules/accounting/opening_balance.js"), "utf8");
const css = fs.readFileSync(path.resolve("style.css"), "utf8");
const refunds = fs.readFileSync(path.resolve("modules/refunds.js"), "utf8");

test("opening_balance row uses .ob-* classes (no inline fixed-width squeeze)", () => {
  assert.match(ob, /class="ob-row"/, "row uses .ob-row");
  assert.match(ob, /class="ob-name"/, "name uses .ob-name");
  assert.match(ob, /class="ob-input"/, "input uses .ob-input");
  // the old inline fixed width that caused the squeeze must be gone from the rows
  assert.ok(!/style="width:160px;padding:8px 10px/.test(ob), "no inline width:160px input left in rows");
});

test("opening_balance keeps the save-critical input id + escaping (logic untouched)", () => {
  assert.match(ob, /id="ob_\$\{f\.code\}"/, 'input id="ob_${f.code}" preserved (save reads it)');
  assert.match(ob, /type="number"[^>]*step="0\.01"[^>]*min="0"/, "number/step/min preserved");
  assert.match(ob, /\$\{escHtml\(f\.label\)\}/, "account label still escaped");
});

test("style.css gives the name a min-width and makes the input full-width on mobile", () => {
  assert.match(css, /\.ob-name\s*\{[^}]*min-width:\s*110px/, ".ob-name has min-width so it cannot collapse");
  assert.match(css, /\.ob-row\s*\{[^}]*flex-wrap:\s*wrap/, ".ob-row wraps");
  assert.match(css, /@media\s*\(max-width:\s*600px\)\s*\{[^}]*\.ob-input\s*\{[^}]*(width:\s*100%|flex:\s*1 1 100%)/,
    "under 600px the input goes full width");
});

test("refunds top-reasons row wraps and the reason keeps a min-width", () => {
  // the row must wrap so the 200px bar can drop to its own line on narrow screens
  assert.match(refunds, /font-size:13px;flex-wrap:wrap"/, "reasons row has flex-wrap:wrap");
  // reason text div must have a min-width (not the old bare flex:1)
  assert.match(refunds, /style="flex:1 1 120px;min-width:120px">\$\{escHtml\(r\)\}/, "reason div min-width + still escaped");
});
