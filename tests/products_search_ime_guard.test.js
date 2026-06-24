// Phase 524 — products page search must not pop the mobile keyboard while typing.
// Run: node --test tests/products_search_ime_guard.test.js
//
// Bug history: the search box re-rendered the whole view (renderView recreates
// #prodSearchInput + .focus()) on each debounced keystroke. On mobile that
// duplicated Thai IME characters (507/522 fixed that) AND popped the keyboard
// repeatedly while typing (the input is destroyed→recreated→re-focused every
// update). Phase 524 fix (low-risk, no products-render refactor): do NOT render
// while typing — search runs only on Enter or blur, so the input is never
// recreated mid-typing and the keyboard stays put. Source-regex (DOM/IME can't
// be unit-run here).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../modules/products.js", import.meta.url), "utf8");

// isolate the search-handler region (from the "// Search — " marker to the "// Sort" binding)
const start = src.indexOf("// Search — ");
const end = src.indexOf("// Sort", start);
const region = start >= 0 && end > start ? src.slice(start, end) : src;

test("products search: does NOT re-render while typing (no input-render handler)", () => {
  assert.ok(start >= 0 && end > start, "search handler region must exist");
  assert.ok(!region.includes('addEventListener("input"'),
    "must NOT render on the input event (that recreates #prodSearchInput + pops the keyboard each keystroke)");
});

test("products search: runs on Enter (keep focus to keep typing)", () => {
  assert.match(region, /addEventListener\("keydown"[\s\S]{0,120}?e\.key === "Enter"[\s\S]{0,60}?_runProdSearch\(true\)/,
    "Enter must trigger the search (refocus=true)");
});

test("products search: runs on blur (deferred so taps land first)", () => {
  assert.match(region, /addEventListener\("blur"[\s\S]{0,80}?_runProdSearch\(false\)/,
    "blur must trigger the search (refocus=false)");
  assert.match(region, /setTimeout\(/, "blur search should be deferred (let result/button taps fire first)");
});

test("products search: no-op when the query is unchanged (avoid needless re-render)", () => {
  assert.match(region, /if \(v === searchQuery\) return/,
    "must skip rendering when the typed value equals the current searchQuery");
});

test("products search: still re-renders + restores focus on an actual search", () => {
  assert.match(region, /renderView\(ctx, refocus \? \{ focusSearch: true \} : \{\}\)/,
    "the actual search still calls renderView (focusSearch only when refocus=true)");
  assert.match(region, /searchQuery = v/, "still sets the trimmed query");
});
