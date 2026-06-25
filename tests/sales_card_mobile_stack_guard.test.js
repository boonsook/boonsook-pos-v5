// Phase 528 — sales list card must stack vertically on mobile (no vertical-text collapse).
// Run: node --test tests/sales_card_mobile_stack_guard.test.js
//
// Bug (pre-existing, NOT from the font work in 526/527): the sales card inner row
//   [left: order_no, flex:1;min-width:0 | right: amount+buttons]
// combined with .page { overflow-wrap: anywhere } collapsed the left column to ~1ch
// on narrow phones, so the bill number "BSK-..." rendered one character per line.
// Fix: tag the sales card row with .sale-card-row and stack it (flex-direction: column)
// inside the mobile @media so order_no gets the full card width. Display-only — no JS
// logic / money touched. Source-regex (DOM layout can't be unit-run here).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const salesJs = readFileSync(new URL("../modules/sales.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");

test("sales card row carries the .sale-card-row hook", () => {
  assert.match(salesJs, /class="row sale-card-row"/,
    "sales card inner row must keep class 'row sale-card-row'");
});

test(".sale-card-row stacks vertically (flex-direction: column)", () => {
  assert.match(css, /\.sale-card-row\s*\{[^}]*flex-direction:\s*column/,
    ".sale-card-row must set flex-direction: column to stack on mobile");
});

test(".sale-card-row rule lives inside a mobile @media (max-width) block", () => {
  const idx = css.indexOf(".sale-card-row {");
  assert.ok(idx > 0, ".sale-card-row rule must exist");
  const before = css.slice(0, idx);
  const lastMedia = before.lastIndexOf("@media");
  assert.ok(lastMedia > 0, ".sale-card-row must follow a @media declaration");
  const segment = before.slice(lastMedia); // from nearest @media up to the rule
  const opens = (segment.match(/\{/g) || []).length;
  const closes = (segment.match(/\}/g) || []).length;
  // inside an OPEN media block → one more '{' than '}' (that @media's '}' comes AFTER the rule)
  assert.ok(opens > closes, ".sale-card-row must be inside an open @media block, not global/desktop");
  assert.match(segment, /@media[^{]*max-width/,
    ".sale-card-row must be inside a @media (max-width: ...) block (mobile only, not desktop)");
});
