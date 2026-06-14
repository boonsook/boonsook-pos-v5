// Phase 441 — customer list keeps its page across re-renders guard
// Run: node --test tests/customer_list_page_keep_guard.test.js
//
// Why this exists:
//   Editing a customer on page 2 then saving re-renders the list via
//   showRoute("customers") → renderCustomersPage, which used to reset currentPage=1
//   (and search/filter) — bouncing the user back to page 1 on every save, painful when
//   assigning customer groups page by page. renderCustomersPage must now PRESERVE the
//   pagination/filter state; renderView must still clamp the page to a valid range so a
//   preserved (possibly stale) page can never point past the data.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const customers = fs.readFileSync(path.resolve("modules/customers.js"), "utf8");

// isolate the renderCustomersPage body
const m = customers.match(/export function renderCustomersPage\([^)]*\)\s*\{([\s\S]*?)\n\}/);
assert.ok(m, "renderCustomersPage must exist");
const body = m[1];

test("renderCustomersPage does not reset currentPage/search/filter (sticky across save)", () => {
  assert.ok(!/currentPage\s*=\s*1/.test(body), "must not reset currentPage to 1");
  assert.ok(!/searchQuery\s*=\s*""/.test(body), "must not clear searchQuery");
  assert.ok(!/currentFilter\s*=\s*"all"/.test(body), "must not reset currentFilter");
  assert.ok(!/currentGroupFilter\s*=\s*"all"/.test(body), "must not reset currentGroupFilter");
  assert.match(body, /renderView\(ctx\)/, "must still render via renderView");
});

test("renderView still clamps currentPage to the valid range (preserved page stays safe)", () => {
  assert.match(customers, /if\s*\(currentPage\s*>\s*totalPages\)\s*currentPage\s*=\s*totalPages/,
    "renderView must clamp currentPage so a preserved page never points past the data");
});
