// Phase 524/546 - products page search must stay usable on mobile while filtering live.
// Run: node --test tests/products_search_ime_guard.test.js
//
// Phase 524 stopped rendering on every keystroke because recreating
// #prodSearchInput + focus() made mobile keyboards flicker and broke Thai IME.
// Phase 546 restores live filtering with a debounce and composition guard:
// input updates schedule a delayed search, Thai composition waits until commit,
// Enter remains immediate, and blur remains deferred so taps land first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../modules/products.js", import.meta.url), "utf8");

const start = src.indexOf("// Search");
const end = src.indexOf("// Sort", start);
const region = start >= 0 && end > start ? src.slice(start, end) : src;

test("products search: debounces live input before rendering", () => {
  assert.ok(start >= 0 && end > start, "search handler region must exist");
  assert.match(region, /addEventListener\("input"/, "input event must trigger live filtering");
  assert.match(region, /_scheduleProdSearch/, "input must schedule, not inline-render directly");
  assert.match(region, /setTimeout\(\(\) => _runProdSearch\(true\), 220\)/,
    "live filtering must be debounced and keep focus");
  assert.match(region, /clearTimeout\(_prodSearchTimer\)/,
    "typing again must cancel the previous pending search");
});

test("products search: guards Thai/IME composition", () => {
  assert.match(region, /addEventListener\("compositionstart"/,
    "must detect composition start");
  assert.match(region, /addEventListener\("compositionend"[\s\S]{0,160}?_scheduleProdSearch\(\)/,
    "must search only after composition commits");
  assert.match(region, /if \(_prodSearchComposing\) return/,
    "input events during composition must not re-render the field");
});

test("products search: runs on Enter immediately", () => {
  assert.match(region, /addEventListener\("keydown"[\s\S]{0,140}?e\.key === "Enter"[\s\S]{0,80}?_runProdSearch\(true\)/,
    "Enter must trigger the search immediately with refocus=true");
});

test("products search: runs on blur after taps can land", () => {
  assert.match(region, /addEventListener\("blur"[\s\S]{0,100}?_runProdSearch\(false\)/,
    "blur must trigger the search with refocus=false");
  assert.match(region, /setTimeout\(/, "blur search should be deferred");
});

test("products search: no-op when the query is unchanged", () => {
  assert.match(region, /if \(v === searchQuery\) return/,
    "must skip rendering when the typed value equals the current searchQuery");
});

test("products search: actual search resets to first page and restores focus only when requested", () => {
  assert.match(region, /currentPage = 1/, "new search must reset pagination");
  assert.match(region, /renderView\(ctx, refocus \? \{ focusSearch: true \} : \{\}\)/,
    "the actual search still calls renderView with conditional focus restore");
  assert.match(region, /searchQuery = v/, "still stores the trimmed query");
});
