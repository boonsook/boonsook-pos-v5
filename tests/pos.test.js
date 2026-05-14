// Phase 89.18 — Unit tests for POS pure helpers (round2, calcVAT)
// Covers: VAT inclusive/exclusive math, rounding, edge cases
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { round2, calcVAT } from "../modules/pos.js";

// ═══════════════════════════════════════════════════════════
//  round2 — money rounding to 2 decimal places
// ═══════════════════════════════════════════════════════════

test("round2 — basic rounding (banker's vs half-up)", () => {
  assert.equal(round2(1.234), 1.23);
  assert.equal(round2(1.235), 1.24);  // half-up
  assert.equal(round2(1.236), 1.24);
  assert.equal(round2(0), 0);
  assert.equal(round2(100), 100);
});

test("round2 — handles string input", () => {
  assert.equal(round2("12.345"), 12.35);
  assert.equal(round2("99.999"), 100);
});

test("round2 — null/undefined/NaN → 0", () => {
  assert.equal(round2(null), 0);
  assert.equal(round2(undefined), 0);
  assert.equal(round2(NaN), 0);
  assert.equal(round2(""), 0);
});

test("round2 — negative numbers", () => {
  assert.equal(round2(-1.234), -1.23);
  assert.equal(round2(-1.236), -1.24);
  assert.equal(round2(-99.999), -100);
});

// ═══════════════════════════════════════════════════════════
//  calcVAT — VAT inclusive/exclusive calculation
// ═══════════════════════════════════════════════════════════

test("calcVAT — disabled (vatEnabled=false): returns amount as-is, vat=0", () => {
  const r = calcVAT(1000, { vatEnabled: false, vatRate: 7 });
  assert.equal(r.enabled, false);
  assert.equal(r.subtotal, 1000);
  assert.equal(r.vat, 0);
  assert.equal(r.total, 1000);
});

test("calcVAT — disabled when rate=0 even if vatEnabled=true", () => {
  const r = calcVAT(1000, { vatEnabled: true, vatRate: 0 });
  assert.equal(r.enabled, false);
  assert.equal(r.vat, 0);
  assert.equal(r.total, 1000);
});

test("calcVAT — null/missing paymentInfo → disabled, no crash", () => {
  const r1 = calcVAT(500, null);
  const r2 = calcVAT(500, undefined);
  const r3 = calcVAT(500, {});
  assert.equal(r1.enabled, false);
  assert.equal(r1.total, 500);
  assert.equal(r2.total, 500);
  assert.equal(r3.total, 500);
});

test("calcVAT inclusive — 107 with 7% VAT → subtotal 100, vat 7", () => {
  const r = calcVAT(107, { vatEnabled: true, vatRate: 7, vatPriceMode: "inclusive" });
  assert.equal(r.enabled, true);
  assert.equal(r.mode, "inclusive");
  assert.equal(r.subtotal, 100);
  assert.equal(r.vat, 7);
  assert.equal(r.total, 107, "inclusive: total === input amount");
});

test("calcVAT inclusive — default mode when vatPriceMode missing", () => {
  const r = calcVAT(107, { vatEnabled: true, vatRate: 7 });
  assert.equal(r.mode, "inclusive", "default should be inclusive");
  assert.equal(r.subtotal, 100);
  assert.equal(r.vat, 7);
});

test("calcVAT exclusive — 100 + 7% VAT → vat 7, total 107", () => {
  const r = calcVAT(100, { vatEnabled: true, vatRate: 7, vatPriceMode: "exclusive" });
  assert.equal(r.mode, "exclusive");
  assert.equal(r.subtotal, 100);
  assert.equal(r.vat, 7);
  assert.equal(r.total, 107);
});

test("calcVAT inclusive — rounding edge: 100 with 7% VAT", () => {
  // 100 inclusive: subtotal = 100*100/107 = 93.4579... → 93.46
  // vat = 100 - 93.46 = 6.54
  const r = calcVAT(100, { vatEnabled: true, vatRate: 7, vatPriceMode: "inclusive" });
  assert.equal(r.subtotal, 93.46);
  assert.equal(r.vat, 6.54);
  assert.equal(r.total, 100, "inclusive total must equal input exactly");
  // sanity: subtotal + vat === total (no rounding drift)
  assert.equal(round2(r.subtotal + r.vat), 100);
});

test("calcVAT exclusive — rounding edge: 99.99 + 7% VAT", () => {
  // 99.99 * 0.07 = 6.9993 → vat 7.00, total = 99.99 + 7.00 = 106.99
  const r = calcVAT(99.99, { vatEnabled: true, vatRate: 7, vatPriceMode: "exclusive" });
  assert.equal(r.subtotal, 99.99);
  assert.equal(r.vat, 7);
  assert.equal(r.total, 106.99);
});

test("calcVAT — non-standard VAT rate (10%)", () => {
  const incl = calcVAT(110, { vatEnabled: true, vatRate: 10, vatPriceMode: "inclusive" });
  assert.equal(incl.subtotal, 100);
  assert.equal(incl.vat, 10);
  assert.equal(incl.total, 110);

  const excl = calcVAT(100, { vatEnabled: true, vatRate: 10, vatPriceMode: "exclusive" });
  assert.equal(excl.vat, 10);
  assert.equal(excl.total, 110);
});

test("calcVAT — zero amount → all zeros, no NaN", () => {
  const r = calcVAT(0, { vatEnabled: true, vatRate: 7, vatPriceMode: "inclusive" });
  assert.equal(r.subtotal, 0);
  assert.equal(r.vat, 0);
  assert.equal(r.total, 0);
});

test("calcVAT — return shape always has all keys", () => {
  const r = calcVAT(100, { vatEnabled: true, vatRate: 7 });
  for (const k of ["subtotal", "vat", "total", "rate", "enabled", "mode"]) {
    assert.ok(k in r, `key "${k}" missing from result`);
  }
});
