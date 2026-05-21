// Phase 92.14 — round2 hardening for cart total (pos.js) and refund total (refunds.js)
// Money audit 4.1 should-fix: float drift (Σ qty*price) must be round2'd at the source
// so displayed totals / change / DB refund_amount don't carry 0.30000000000000004 noise.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cartSum } from "../modules/pos.js";
import { refundTotal } from "../modules/refunds.js";

test("cartSum: rounds float-drift sum to 2 decimals", () => {
  // 3 × 33.30 = 99.90000000000001 in float
  const cart = [{ qty: 3, price: 33.30 }];
  assert.equal(cartSum(cart), 99.9);
});

test("cartSum: multi-line classic 0.1+0.2 drift → clean", () => {
  const cart = [{ qty: 1, price: 0.1 }, { qty: 1, price: 0.2 }];
  assert.equal(cartSum(cart), 0.3);
});

test("cartSum: empty / nullish cart → 0", () => {
  assert.equal(cartSum([]), 0);
  assert.equal(cartSum(null), 0);
  assert.equal(cartSum(undefined), 0);
});

test("cartSum: tolerates missing qty/price", () => {
  assert.equal(cartSum([{ price: 10 }, { qty: 2 }, { qty: 2, price: 5 }]), 10);
});

test("refundTotal: rounds float-drift sum to 2 decimals", () => {
  const items = [{ qty: 3, unit_price: 33.30 }];
  assert.equal(refundTotal(items), 99.9);
});

test("refundTotal: sums multiple lines, round2", () => {
  const items = [{ qty: 2, unit_price: 19.95 }, { qty: 1, unit_price: 0.1 }];
  assert.equal(refundTotal(items), 40.0);
});

test("refundTotal: empty / nullish → 0", () => {
  assert.equal(refundTotal([]), 0);
  assert.equal(refundTotal(null), 0);
});
