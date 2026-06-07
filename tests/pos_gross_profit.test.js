// Phase 398 — write sales.gross_profit at checkout (money write-path, §4.1)
// Run: node --test tests/pos_gross_profit.test.js
//
// Why this exists:
//   The dashboard "กำไรขั้นต้น" KPI reads sales.gross_profit, a column the app never wrote
//   (always ฿0). Phase 398 computes it at checkout = subtotal(ex-VAT) − Σ(cost×qty) from the
//   cost POS already keeps (products.cost = sale_items.unit_cost). It must NOT inflate profit
//   (empty cart / quick-pay → null) and MUST NOT break checkout (column-missing fallback).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { _computeGrossProfit } from "../modules/pos.js";

const src = fs.readFileSync(path.resolve("modules/pos.js"), "utf8");

// ── pure formula ──────────────────────────────────────────────────────────────
test("gross profit = subtotal − Σ(cost × qty)", () => {
  assert.equal(_computeGrossProfit([{ id: 1, qty: 2, price: 100 }], [{ id: 1, cost: 60 }], 200), 80);
});

test("empty cart / quick-pay → null (never inflate profit)", () => {
  assert.equal(_computeGrossProfit([], [{ id: 1, cost: 60 }], 200), null);
  assert.equal(_computeGrossProfit(null, [], 100), null);
  assert.equal(_computeGrossProfit(undefined, undefined, 100), null);
});

test("product with no cost (or not found) → cost 0 → gross = subtotal", () => {
  assert.equal(_computeGrossProfit([{ id: 9, qty: 1 }], [{ id: 9 }], 100), 100);
  assert.equal(_computeGrossProfit([{ id: 9, qty: 1 }], [], 100), 100);
});

test("VAT exclusive: ex-VAT subtotal 100, cost 60 → 40", () => {
  assert.equal(_computeGrossProfit([{ id: 1, qty: 1, price: 100 }], [{ id: 1, cost: 60 }], 100), 40);
});

test("rounds to 2 decimals (no float drift into DB)", () => {
  assert.equal(_computeGrossProfit([{ id: 1, qty: 3, price: 0.1 }], [{ id: 1, cost: 0 }], 0.3), 0.3);
});

// ── checkout wiring (source guard) ────────────────────────────────────────────
test("doCheckout writes gross_profit and has a column-missing fallback", () => {
  assert.match(src, /gross_profit:\s*_grossProfit/, "salePayload includes gross_profit");
  assert.match(src, /_computeGrossProfit\(state\.cart, state\.products, _saleSubtotal\)/, "computed from cart/products/subtotal");
  assert.match(src, /gross_profit:\s*_gp,\s*\.\.\.legacy/, "fallback strips gross_profit before retry");
  assert.match(src, /\/column\|gross_profit\/i\.test\(saleRes\.error/, "fallback triggers on a column error");
});

// ── must not alter the existing money formulas ────────────────────────────────
test("the existing subtotal/total/vat/change formulas are unchanged", () => {
  assert.match(src, /const _saleSubtotal = round2\(vatCalc\.enabled \? vatCalc\.subtotal : amount\)/, "subtotal value unchanged");
  assert.match(src, /total_amount:\s*round2\(actualTotal\)/, "total_amount unchanged");
  assert.match(src, /vat_amount:\s*round2\(vatCalc\.vat\)/, "vat unchanged");
  assert.match(src, /change_amount:\s*round2\(Math\.max/, "change unchanged");
});
