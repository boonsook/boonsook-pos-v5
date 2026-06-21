// Phase 507 — products page search box must survive mobile Thai IME composition.
// Run: node --test tests/products_search_ime_guard.test.js
//
// Bug: the search handler re-renders the whole view (renderView → recreates
// #prodSearchInput) on each debounced keystroke; doing that MID-composition on
// a mobile Thai IME duplicates/jumps characters ("หน้" → "หน้หน้า"). Fix: skip
// while composing (e.isComposing) and run the search on compositionend.
// Source-regex (DOM/IME behaviour can't be unit-run here).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../modules/products.js", import.meta.url), "utf8");

// isolate the search-handler region (between the "Search (debounce" comment and the "Sort" binding)
const start = src.indexOf("Search (debounce");
const end = src.indexOf("// Sort", start);
const region = start >= 0 && end > start ? src.slice(start, end) : src;

test("products search: skips re-render during IME composition", () => {
  assert.ok(start >= 0, "search handler region must exist");
  assert.match(region, /if \(e\.isComposing\) return/,
    "input handler must bail while composing (e.isComposing) so the input is not recreated mid-typing");
});

test("products search: runs the search on compositionend (commit ตัวไทย)", () => {
  assert.match(region, /addEventListener\("compositionend"/,
    "must listen for compositionend so committed Thai text still triggers a search");
});

test("products search: still debounced + still re-renders results", () => {
  assert.match(region, /setTimeout\(/, "keeps the debounce");
  assert.match(region, /renderView\(ctx, \{ focusSearch: true \}\)/, "still re-renders + restores focus after debounce");
  assert.match(region, /searchQuery = String\(val \|\| ""\)\.trim\(\)/, "still sets the trimmed search query");
});

test("products search: input handler no longer re-renders unconditionally on every keystroke", () => {
  // the old bug: a bare input listener that always renderView'd. Now the input
  // listener must guard on isComposing before doing any work.
  assert.match(region, /addEventListener\("input"[\s\S]{0,160}?if \(e\.isComposing\) return/,
    "the isComposing guard must sit inside the input listener (skip work mid-composition)");
});
