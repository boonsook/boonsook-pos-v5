// Phase 401 — mobile-fix-report-headers (layout/CSS-only)
// Run: node --test tests/report_header_mobile.test.js
//
// Why this exists:
//   5 accounting report pages share a header row: emoji + a title block
//   (<div style="flex:1;min-width:200px"> with <h2> + subtitle) + Excel/print buttons.
//   On ~360px the buttons did not drop below, so they squeezed the title and the Thai
//   <h2> broke one-glyph-per-line. Phase 401 swaps the title block to .rep-head-main and
//   adds a @media(max-width:600px) rule giving it flex-basis 100% (min-width 0) so the
//   buttons wrap to their own line. This guards the swap WITHOUT touching report logic:
//   the <h2>, the export/print button ids, and the period picker must remain.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const FILES = {
  trial_balance: "modules/accounting/trial_balance.js",
  profit_loss: "modules/accounting/profit_loss.js",
  balance_sheet: "modules/accounting/balance_sheet.js",
  export_bundle: "modules/accounting/export_bundle.js",
  opening_balance: "modules/accounting/opening_balance.js",
};
const src = Object.fromEntries(
  Object.entries(FILES).map(([k, p]) => [k, fs.readFileSync(path.resolve(p), "utf8")])
);
const css = fs.readFileSync(path.resolve("style.css"), "utf8");

test("all 5 report headers use .rep-head-main (no inline flex:1;min-width:200px left)", () => {
  for (const [name, code] of Object.entries(src)) {
    assert.match(code, /class="rep-head-main"/, `${name}: title block uses .rep-head-main`);
    assert.ok(!/flex:1;min-width:200px/.test(code), `${name}: inline flex:1;min-width:200px removed`);
  }
});

test("all 5 keep their <h2> title (report content untouched)", () => {
  for (const [name, code] of Object.entries(src)) {
    assert.match(code, /<h2[^>]*>[^<]+<\/h2>/, `${name}: <h2> title still present`);
  }
});

test("export / print buttons keep their ids (logic untouched)", () => {
  // each report's action buttons must survive the header markup change
  assert.match(src.trial_balance, /id="tbExportBtn"/, "trial_balance export button id kept");
  assert.match(src.profit_loss, /id="plExportBtn"/, "profit_loss export button id kept");
  assert.match(src.balance_sheet, /id="bsExportBtn"/, "balance_sheet export button id kept");
});

test("style.css makes the title full-width under 600px so buttons wrap below", () => {
  assert.match(css, /\.rep-head-main\s*\{[^}]*flex:\s*1 1 auto[^}]*min-width:\s*200px/,
    ".rep-head-main desktop rule (flex 1 1 auto, min-width 200px)");
  assert.match(css, /@media\s*\(max-width:\s*600px\)\s*\{\s*\.rep-head-main\s*\{[^}]*flex:\s*1 1 100%[^}]*min-width:\s*0/,
    "under 600px the title goes flex-basis 100% with min-width 0");
});
