// Phase 486 — fetch sale_items on-demand (consumers no longer read empty state.saleItems).
// Run: node --test tests/sale_items_fetch_guard.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { indexQtyByProduct, fetchSaleItemsForSaleIds, fetchSaleItemsForProduct } from "../modules/sale_items_fetch.js";

// ── pure: indexQtyByProduct ─────────────────────────────────────────────────────
test("indexQtyByProduct sums qty + revenue per product_id (line_total when present)", () => {
  const m = indexQtyByProduct([
    { product_id: 5, qty: 2, line_total: 100, product_name: "A" },
    { product_id: 5, qty: 3, line_total: 150, product_name: "A" },
  ]);
  assert.equal(m.get("5").qty, 5);
  assert.equal(m.get("5").revenue, 250);
  assert.equal(m.get("5").name, "A");
});

test("indexQtyByProduct falls back to qty × unit_price when no line_total", () => {
  const m = indexQtyByProduct([{ product_id: 7, qty: 4, unit_price: 25 }]);
  assert.equal(m.get("7").revenue, 100);
});

test("indexQtyByProduct skips rows with null product_id; string/number id tolerant", () => {
  const m = indexQtyByProduct([
    { product_id: null, qty: 9, line_total: 9 },
    { product_id: "5", qty: 1, line_total: 10 },
    { product_id: 5, qty: 1, line_total: 10 },
  ]);
  assert.equal(m.has("5"), true);
  assert.equal(m.get("5").qty, 2, "string '5' and number 5 merge under the same key");
  assert.equal([...m.keys()].length, 1);
});

test("indexQtyByProduct: non-array → empty map; NaN qty/line_total → 0", () => {
  assert.equal([...indexQtyByProduct(null).keys()].length, 0);
  const m = indexQtyByProduct([{ product_id: 1, qty: "x", line_total: "y" }]);
  assert.equal(m.get("1").qty, 0);
  assert.equal(m.get("1").revenue, 0);
});

// ── behavioral: fetchSaleItemsForSaleIds (mock global fetch + window) ────────────
function withMockFetch(impl, fn) {
  const prevFetch = globalThis.fetch;
  const prevWindow = globalThis.window;
  const calls = [];
  globalThis.window = { SUPABASE_CONFIG: { url: "https://x.test", anonKey: "anon" }, _sbAccessToken: "tok" };
  globalThis.fetch = async (url) => { calls.push(url); return impl(url); };
  return Promise.resolve(fn(calls)).finally(() => { globalThis.fetch = prevFetch; globalThis.window = prevWindow; });
}

test("fetchSaleItemsForSaleIds: empty ids → {ok:true, rows:[]} and makes NO request", () =>
  withMockFetch(() => ({ ok: true, json: async () => [] }), async (calls) => {
    const r = await fetchSaleItemsForSaleIds([]);
    assert.deepEqual(r, { ok: true, rows: [] });
    assert.equal(calls.length, 0, "no network call for empty ids");
  }));

test("fetchSaleItemsForSaleIds: fetches sale_id=in.(...) and returns rows", () =>
  withMockFetch(() => ({ ok: true, json: async () => [{ product_id: 1, qty: 2 }] }), async (calls) => {
    const r = await fetchSaleItemsForSaleIds([10, 11]);
    assert.equal(r.ok, true);
    assert.equal(r.rows.length, 1);
    assert.match(calls[0], /sale_items\?select=\*&sale_id=in\.\(10,11\)/, "uses in.(ids) filter");
  }));

test("fetchSaleItemsForSaleIds: HTTP failure → {ok:false} (NOT a silent empty)", () =>
  withMockFetch(() => ({ ok: false, status: 500, json: async () => null }), async () => {
    const r = await fetchSaleItemsForSaleIds([1]);
    assert.equal(r.ok, false);
    assert.equal(r.rows.length, 0);
    assert.ok(r.error);
  }));

test("fetchSaleItemsForSaleIds: non-array body → {ok:false}", () =>
  withMockFetch(() => ({ ok: true, json: async () => ({ oops: true }) }), async () => {
    const r = await fetchSaleItemsForSaleIds([1]);
    assert.equal(r.ok, false);
  }));

test("fetchSaleItemsForProduct: empty id → {ok:true, rows:[]} no request; real id → product_id=eq", () =>
  withMockFetch(() => ({ ok: true, json: async () => [{ product_id: 9, qty: 1 }] }), async (calls) => {
    const e = await fetchSaleItemsForProduct("");
    assert.deepEqual(e, { ok: true, rows: [] });
    assert.equal(calls.length, 0);
    const r = await fetchSaleItemsForProduct(9);
    assert.equal(r.ok, true);
    assert.match(calls[0], /sale_items\?select=\*&product_id=eq\.9/);
  }));

test("no SUPABASE_CONFIG → {ok:false} (fail-closed, not silent empty)", () =>
  withMockFetch(() => ({ ok: true, json: async () => [] }), async () => {
    globalThis.window = {};  // strip config
    const r = await fetchSaleItemsForSaleIds([1]);
    assert.equal(r.ok, false);
  }));

// ── source wiring: the 5 fixed consumers no longer READ state.saleItems ─────────
test("the 5 fixed consumers stop reading state.saleItems and use the fetch helper", () => {
  const files = {
    "modules/profit_by_product.js": "fetchSaleItemsForSaleIds",
    "modules/top_customers.js": "fetchSaleItemsForSaleIds",
    "modules/dashboard.js": "fetchSaleItemsForSaleIds",
    "modules/serials.js": "fetchSaleItemsForSaleIds",
    "main.js": "fetchSaleItemsForProduct",
  };
  for (const [file, helper] of Object.entries(files)) {
    const src = fs.readFileSync(path.resolve(file), "utf8");
    assert.ok(!/\(state\.saleItems/.test(src), `${file} must not READ (state.saleItems …) anymore`);
    assert.ok(src.includes(helper), `${file} must use ${helper}`);
    assert.match(src, /from "\.(\/modules)?\/sale_items_fetch\.js"/, `${file} imports the fetch helper`);
  }
});

// ── tracked residual: products.js turnover hint deferred (own follow-up phase) ───
test("KNOWN RESIDUAL: products.js turnover hint still reads state.saleItems (deferred)", () => {
  const src = fs.readFileSync(path.resolve("modules/products.js"), "utf8");
  assert.ok(/\(state\.saleItems/.test(src),
    "products.js turnover hint is the documented deferred consumer (Phase 486 fixed the other 5); " +
    "if this is fixed in a follow-up, update this guard");
});
