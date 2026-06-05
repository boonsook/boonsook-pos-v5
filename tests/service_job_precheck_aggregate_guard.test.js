// Phase 372 — service-job pre-check aggregates need per (product+warehouse)
// Run: node --test tests/service_job_precheck_aggregate_guard.test.js
//
// Why: ac_install/service_form/solar pre-check looped per line item; the same
// product+warehouse split across multiple lines each passed individually while the
// SUM exceeded stock → job saved, deduct failed-clean later. Phase 372 aggregates
// need per (product_id|warehouse_id) and dedups so the pre-check compares the real total.
// The pure aggregator is unit-tested behaviorally; wiring is asserted per file.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { aggregateNeedByKey } from "../modules/stock_precheck.js";

test("sums qty for same product+warehouse across line items", () => {
  const m = aggregateNeedByKey([
    { product_id: 1, warehouse_id: 9, qty: 3 },
    { product_id: 1, warehouse_id: 9, qty: 3 },
    { product_id: 2, warehouse_id: 9, qty: 1 },
  ]);
  assert.equal(m.get("1|9"), 6, "same product+wh summed (3+3)");
  assert.equal(m.get("2|9"), 1);
});

test("same product DIFFERENT warehouse not merged", () => {
  const m = aggregateNeedByKey([
    { product_id: 1, warehouse_id: 9, qty: 2 },
    { product_id: 1, warehouse_id: 8, qty: 5 },
  ]);
  assert.equal(m.get("1|9"), 2);
  assert.equal(m.get("1|8"), 5);
});

test("single line = its qty (common case unchanged — no over-block regression)", () => {
  const m = aggregateNeedByKey([{ product_id: 1, warehouse_id: 9, qty: 4 }]);
  assert.equal(m.get("1|9"), 4);
  assert.equal(m.size, 1);
});

test("skips items without warehouse_id/product_id; null-safe", () => {
  const m = aggregateNeedByKey([
    { product_id: 1, qty: 5 },     // no warehouse_id
    { warehouse_id: 9, qty: 5 },   // no product_id
    null,
    { product_id: 1, warehouse_id: 9, qty: 2 },
  ]);
  assert.equal(m.size, 1);
  assert.equal(m.get("1|9"), 2);
  assert.equal(aggregateNeedByKey(null).size, 0);
  assert.equal(aggregateNeedByKey(undefined).size, 0);
});

test("non-numeric / missing qty treated as 0", () => {
  const m = aggregateNeedByKey([
    { product_id: 1, warehouse_id: 9, qty: undefined },
    { product_id: 1, warehouse_id: 9, qty: 2 },
  ]);
  assert.equal(m.get("1|9"), 2);
});

// ── wiring: each service form imports + uses the aggregator, dedups, keeps existing logic ──
for (const f of ["ac_install", "service_form", "solar"]) {
  const src = fs.readFileSync(path.resolve(`modules/${f}.js`), "utf8");
  test(`${f}: wires aggregateNeedByKey + dedup + aggregated need; existing pre-check preserved`, () => {
    assert.match(src, /import \{ aggregateNeedByKey \} from "\.\/stock_precheck\.js"/, "imports helper");
    assert.match(src, /aggregateNeedByKey\(fullItems\)/, "builds need map from fullItems");
    assert.match(src, /_checkedKeys\.has\(/, "dedups per key (check/transfer once per key)");
    assert.match(src, /_needByKey\.get\(/, "uses aggregated need (not raw it.qty)");
    // Phase 370 isHome hard-block must stay
    assert.match(src, /if \(isHome\)\s*\{[\s\S]{0,160}throw new Error/, "isHome block kept");
    // non-home transfer path + confirm dialog must stay
    assert.ok(src.includes("transfersNeeded.push("), "transfer path kept");
    assert.ok(src.includes("window.App?.confirm?.(msg)"), "confirm-transfer dialog kept");
  });
}
