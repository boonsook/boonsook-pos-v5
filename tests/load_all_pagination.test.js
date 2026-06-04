// Phase 366 fix-loadalldata-1000-row-cap
// Run: node --test tests/load_all_pagination.test.js
//
// Why this exists:
//   PostgREST default max-rows = 1000 → a bare .select("*") silently caps each table at
//   1000 rows. products grew past 1000 (1075) → 75 missing (unsellable / miscounted);
//   warehouse_stock (products x warehouses) can be much larger → stock skewed.
//   fetchAllPaginated paginates with .range() until every page is loaded.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fetchAllPaginated } from "../modules/fetch_paginated.js";

// mock queryFn factory: serves `total` synthetic rows in pages of pageSize, recording ranges asked
function makeSource(total) {
  const calls = [];
  const queryFn = async (from, to) => {
    calls.push([from, to]);
    if (from >= total) return { data: [], error: null };
    const rows = [];
    for (let i = from; i <= to && i < total; i++) rows.push({ id: i });
    return { data: rows, error: null };
  };
  return { queryFn, calls };
}

test("loads all rows across pages (1075 = 1000 + 75)", async () => {
  const { queryFn, calls } = makeSource(1075);
  const rows = await fetchAllPaginated(queryFn, 1000);
  assert.equal(rows.length, 1075, "must return every row, not the 1000 cap");
  assert.equal(rows[0].id, 0);
  assert.equal(rows[1074].id, 1074);
  assert.deepEqual(calls, [[0, 999], [1000, 1999]], "asks page 0-999 then 1000-1999, then stops");
});

test("single page when under pageSize (224)", async () => {
  const { queryFn, calls } = makeSource(224);
  const rows = await fetchAllPaginated(queryFn, 1000);
  assert.equal(rows.length, 224);
  assert.equal(calls.length, 1, "one request only");
  assert.deepEqual(calls[0], [0, 999]);
});

test("exact multiple of pageSize stops on the empty next page (2000, no hang/loop)", async () => {
  const { queryFn, calls } = makeSource(2000);
  const rows = await fetchAllPaginated(queryFn, 1000);
  assert.equal(rows.length, 2000);
  // 0-999 (full) -> 1000-1999 (full) -> 2000-2999 (empty) -> stop
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("empty table = one request, no rows", async () => {
  const { queryFn, calls } = makeSource(0);
  const rows = await fetchAllPaginated(queryFn, 1000);
  assert.equal(rows.length, 0);
  assert.equal(calls.length, 1);
});

test("error mid-stream throws (does not swallow)", async () => {
  let n = 0;
  const queryFn = async (from, to) => {
    n++;
    if (n === 1) return { data: Array.from({ length: 1000 }, (_, i) => ({ id: from + i })), error: null };
    return { data: null, error: { message: "boom" } };
  };
  await assert.rejects(() => fetchAllPaginated(queryFn, 1000), (err) => err && err.message === "boom", "must throw the supabase error object, not return partial");
});

test("custom small pageSize paginates correctly (10 rows, size 3)", async () => {
  const { queryFn, calls } = makeSource(10);
  const rows = await fetchAllPaginated(queryFn, 3);
  assert.equal(rows.length, 10);
  assert.deepEqual(calls, [[0, 2], [3, 5], [6, 8], [9, 11]], "last partial page (1 row) ends it");
});

// ── guard: loadAllData wires the helper for the 3 must-be-complete tables ─────
test("loadAllData uses fetchAllPaginated for products, customers, warehouse_stock", () => {
  const main = fs.readFileSync(path.resolve("main.js"), "utf8");
  assert.match(main, /import \{ fetchAllPaginated \} from "\.\/modules\/fetch_paginated\.js"/, "imports the helper");
  assert.match(main, /fetchAllPaginated\(\(f,t\) => sb\.from\("products"\)[\s\S]{0,80}\.range\(f,t\)\)/, "products paginated");
  assert.match(main, /fetchAllPaginated\(\(f,t\) => sb\.from\("customers"\)[\s\S]{0,80}\.range\(f,t\)\)/, "customers paginated");
  // warehouse_stock must add a stable .order() BEFORE .range() (was orderless)
  assert.match(main, /fetchAllPaginated\(\(f,t\) => sb\.from\("warehouse_stock"\)\.select\("\*"\)\.order\("id"[^)]*\)\.range\(f,t\)\)/, "warehouse_stock paginated with stable order");
  // paginated results are arrays → assigned via valArr (not r.value.data)
  assert.match(main, /state\.products\s*=\s*valArr\(rProducts\)/, "products via valArr");
  assert.match(main, /state\.warehouseStock\s*=\s*valArr\(rWhStock\)/, "warehouseStock via valArr");
});

// ── guard: intentional .limit(50) recent-only tables are NOT changed ──────────
test("intentional limit(50) tables remain limited (not paginated)", () => {
  const main = fs.readFileSync(path.resolve("main.js"), "utf8");
  for (const t of ["quotations", "service_jobs", "delivery_invoices", "receipts"]) {
    assert.match(main, new RegExp(`sb\\.from\\("${t}"\\)\\.select\\("\\*"\\)[^\\n]*\\.limit\\(50\\)`), `${t} keeps .limit(50)`);
  }
  // sales keeps its limit(50) too
  assert.match(main, /sb\.from\("sales"\)\.select\("\*"\)[\s\S]{0,60}\.limit\(50\)/, "sales keeps limit(50)");
});
