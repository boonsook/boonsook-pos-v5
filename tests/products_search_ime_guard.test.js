// Phase 522 — products page search box must survive mobile Thai IME composition.
// Run: node --test tests/products_search_ime_guard.test.js
//
// Bug: the search handler re-renders the whole view (renderView → recreates
// #prodSearchInput) on each debounced keystroke. Recreating the input MID Thai
// IME composition duplicates/jumps characters ("หน้" → "หน้หน้า", text inserting
// itself). Phase 507 skipped e.isComposing, but the debounce could still fire
// while composing the NEXT character → still recreated mid-IME. Phase 522 (deeper):
// the render NEVER runs while composing — if the timer fires mid-composition it
// defers (pending) and runs on compositionend, so the input is never recreated
// mid-typing. Source-regex (DOM/IME behaviour can't be unit-run here).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../modules/products.js", import.meta.url), "utf8");

// isolate the search-handler region (between the "Search (debounce" comment and the "Sort" binding)
const start = src.indexOf("Search (debounce");
const end = src.indexOf("// Sort", start);
const region = start >= 0 && end > start ? src.slice(start, end) : src;

test("products search: tracks IME composition (start + end)", () => {
  assert.ok(start >= 0 && end > start, "search handler region must exist");
  assert.match(region, /addEventListener\("compositionstart"[\s\S]{0,90}?_searchComposing = true/,
    "compositionstart must set the composing flag");
  assert.match(region, /addEventListener\("compositionend"/, "must listen for compositionend");
});

test("products search: NEVER recreates the input while composing (the core fix)", () => {
  // the debounced timer must DEFER (set pending + return) instead of rendering while composing
  assert.match(region, /if \(_searchComposing\) \{ _searchPending = true; return; \}/,
    "debounced timer must defer (pending + return) when composing — must NOT call renderView mid-IME");
  // the deferred render then runs on compositionend (composition finished = recreate is safe)
  assert.match(region, /_searchComposing = false;[\s\S]{0,140}?_searchPending[\s\S]{0,50}?_doProdSearch\(\)/,
    "compositionend must clear the flag and run the pending render");
});

test("products search: input handler bails during composition", () => {
  assert.match(region, /addEventListener\("input"[\s\S]{0,140}?if \(e\.isComposing \|\| _searchComposing\) return/,
    "input listener must bail while composing (isComposing or _searchComposing)");
});

test("products search: still debounced + still re-renders results (functional preserved)", () => {
  assert.match(region, /setTimeout\(/, "keeps the debounce");
  assert.match(region, /renderView\(ctx, \{ focusSearch: true \}\)/, "still re-renders + restores focus when not composing");
  assert.match(region, /searchQuery = String\(_prodSearchEl\?\.value \|\| ""\)\.trim\(\)/,
    "still sets the trimmed query from the live input value");
});
