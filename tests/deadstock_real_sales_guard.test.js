// Phase 478 dead-stock-report-uses-real-period-sales
// Run: node --test tests/deadstock_real_sales_guard.test.js
//
// Why this exists:
//   The Dead Stock report computed "sold in period" from state.saleItems — which is NEVER
//   loaded (loadAllData fetches sale_items on-demand per bill, never into state), and from
//   state.sales which is capped at 50. So soldProductIds was always empty and EVERY product
//   with stock>0 was reported as dead/never-sold (the whole page was wrong).
//   Phase 478: the page fetches real sale activity from stock_movements (type=sale) for the
//   whole period (created_at >= cutoff, paginated, no cap), builds soldSet + lastSaleMap, and
//   computes dead = stock>0 AND not sold-in-period. A fetch failure shows an error state — it
//   must NOT silently fall back to "everything is dead".

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { computeDeadStock, indexSaleMovements } from "../modules/dead_stock.js";

const PRODUCTS = [
  { id: 1, name: "A", product_type: "stock", stock: 10, cost: 100 },   // not sold -> dead
  { id: 2, name: "B", product_type: "stock", stock: 5,  cost: 50 },    // sold -> not dead
  { id: 3, name: "C", product_type: "service", stock: 99, cost: 0 },   // service -> excluded
  { id: 4, name: "D", product_type: "non_stock", stock: 9, cost: 9 },  // non_stock -> excluded
  { id: 5, name: "E", product_type: "stock", stock: 0,  cost: 80 },    // no stock -> excluded
  { id: 6, name: "F", product_type: "stock", stock: 2,  cost: 1000 },  // not sold -> dead (highest value)
];

// ── behavioral: indexSaleMovements ───────────────────────────────────────────
test("indexSaleMovements: soldSet = distinct product_id; lastSaleMap = max created_at per product", () => {
  const rows = [
    { product_id: 2, created_at: "2026-06-01T08:00:00Z" },
    { product_id: 2, created_at: "2026-06-10T08:00:00Z" }, // later -> wins
    { product_id: 7, created_at: "2026-06-05T08:00:00Z" },
    { product_id: null, created_at: "2026-06-09" },        // dropped
  ];
  const { soldSet, lastSaleMap } = indexSaleMovements(rows);
  assert.ok(soldSet.has("2") && soldSet.has("7"));
  assert.equal(soldSet.size, 2);
  assert.equal(lastSaleMap.get("2"), "2026-06-10");
  assert.equal(lastSaleMap.get("7"), "2026-06-05");
});

test("indexSaleMovements: non-array / empty -> empty index", () => {
  assert.equal(indexSaleMovements(null).soldSet.size, 0);
  assert.equal(indexSaleMovements([]).soldSet.size, 0);
});

// ── behavioral: computeDeadStock ─────────────────────────────────────────────
test("computeDeadStock: dead = stock>0 AND not in soldSet; excludes service/non_stock/zero-stock", () => {
  const soldSet = new Set(["2"]);
  const { stockProducts, enriched } = computeDeadStock({ products: PRODUCTS, soldSet, lastSaleMap: new Map(), nowMs: Date.now() });
  // stock products = ids 1,2,6 (3=service,4=non_stock,5=zero excluded)
  assert.deepEqual(stockProducts.map(p => p.id).sort(), [1, 2, 6]);
  const deadIds = enriched.map(p => p.id);
  assert.ok(deadIds.includes(1) && deadIds.includes(6), "unsold stock products are dead");
  assert.ok(!deadIds.includes(2), "sold product is NOT dead");
  assert.ok(!deadIds.includes(3) && !deadIds.includes(4) && !deadIds.includes(5), "non-stock/zero excluded");
});

test("computeDeadStock: empty soldSet -> every stock product is dead (correct when nothing sold)", () => {
  const { stockProducts, enriched } = computeDeadStock({ products: PRODUCTS, soldSet: new Set(), lastSaleMap: new Map(), nowMs: Date.now() });
  assert.equal(enriched.length, stockProducts.length);
  assert.equal(enriched.length, 3);
});

test("computeDeadStock: sorted by stock value desc; totalValue = sum", () => {
  const { enriched, totalValue } = computeDeadStock({ products: PRODUCTS, soldSet: new Set(["2"]), lastSaleMap: new Map(), nowMs: Date.now() });
  // F = 2*1000 = 2000, A = 10*100 = 1000
  assert.equal(enriched[0].id, 6);
  assert.equal(enriched[0].value, 2000);
  assert.equal(totalValue, 3000);
});

test("computeDeadStock: daysSince computed from lastSaleMap + nowMs (deterministic)", () => {
  const nowMs = new Date("2026-06-20T00:00:00Z").getTime();
  const lastSaleMap = new Map([["1", "2026-06-10"]]); // 10 days before now
  const { enriched } = computeDeadStock({ products: PRODUCTS, soldSet: new Set(["2"]), lastSaleMap, nowMs });
  const a = enriched.find(p => p.id === 1);
  assert.equal(a.lastSale, "2026-06-10");
  assert.equal(a.daysSince, 10);
  const f = enriched.find(p => p.id === 6);
  assert.equal(f.lastSale, null, "no last sale in window -> null (not a false date)");
});

// ── source guard: the fetch wiring + no-regress to state.saleItems ───────────
const src = fs.readFileSync(path.resolve("modules/dead_stock.js"), "utf8");

test("dead_stock no longer reads state.saleItems (the never-loaded source of the bug)", () => {
  assert.ok(!/state\.saleItems/.test(src), "must not reference state.saleItems");
});

test("dead_stock fetches real sale activity from stock_movements (type=sale, cutoff-filtered, paginated)", () => {
  assert.match(src, /stock_movements\?type=eq\.sale/, "fetch sale movements");
  assert.match(src, /created_at=gte\.\s*"?\s*\+\s*encodeURIComponent\(cutoffKey\)/, "filter by cutoff");
  assert.match(src, /offset/, "paginates via offset");
  assert.match(src, /page\.length < PAGE/, "loops until last (incomplete) page — no cap");
});

test("fetch failure shows an error state — NOT a silent 'everything is dead' fallback", () => {
  assert.match(src, /errorHtml/, "has an error render path");
  const errIdx = src.indexOf("if (!res.ok)");
  const computeIdx = src.indexOf("= computeDeadStock(");   // the CALL, not the function definition
  assert.ok(errIdx >= 0 && computeIdx >= 0 && errIdx < computeIdx, "error branch handled before compute (returns early)");
  // the error branch must return before building the list
  const errBlock = src.slice(errIdx, computeIdx);
  assert.match(errBlock, /return;/, "error branch returns early (does not compute dead list)");
});

test("dead_stock stays read-only (no mutation HTTP verbs / state writes)", () => {
  for (const verb of ['"POST"', '"PATCH"', '"DELETE"', '"PUT"']) {
    assert.ok(!src.includes(verb), `read-only report must not use ${verb}`);
  }
  assert.ok(!/xhrPost|xhrPatch|xhrDelete/.test(src), "no xhr mutation helpers");
});
