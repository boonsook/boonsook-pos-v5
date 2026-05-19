// Phase 91.2 HOTFIX — Regression tests for the loyalty earn formula.
//
// Production build 253 had the formula inverted:
//   pointsToAdd = floor(amount * pointsPerBaht)  // WRONG
// A 500-baht sale with rate "ทุก 100 บาท = 1 แต้ม" credited 50,000 points
// instead of 5. The DB column is named `points_per_baht` but the UI label
// makes the actual semantic BAHT-PER-POINT (the divisor). So the correct
// formula is:
//   pointsToAdd = floor(amount / bahtPerPoint)
//
// This file tests the centralized calcEarnPoints() helper with REAL behavior
// (not source-level grep) so the formula can never silently drift back.

import { test } from "node:test";
import assert from "node:assert/strict";
import { calcEarnPoints } from "../modules/loyalty.js";

const RATE_100 = { is_active: true, points_per_baht: 100 };

test("the bug: 500 baht at rate 100 must earn exactly 5 points (NEVER 50,000)", () => {
  const got = calcEarnPoints(500, RATE_100);
  assert.equal(got, 5, "500/100 = 5. If you see 50000 here, the formula is multiplying again.");
  assert.notEqual(got, 50000, "50000 is the pre-fix wrong value — bug is back");
});

test("floor semantics: 99 baht at rate 100 earns 0 (below threshold)", () => {
  assert.equal(calcEarnPoints(99, RATE_100), 0);
});

test("boundary: 100 baht at rate 100 earns exactly 1", () => {
  assert.equal(calcEarnPoints(100, RATE_100), 1);
});

test("scaling: 1000 baht at rate 100 earns 10", () => {
  assert.equal(calcEarnPoints(1000, RATE_100), 10);
});

test("fractional spend gets floored: 549 baht at rate 100 earns 5 (not 5.49)", () => {
  assert.equal(calcEarnPoints(549, RATE_100), 5);
  assert.equal(calcEarnPoints(599.99, RATE_100), 5);
});

test("returns 0 when settings missing entirely (defensive null guard)", () => {
  assert.equal(calcEarnPoints(500, null), 0);
  assert.equal(calcEarnPoints(500, undefined), 0);
  assert.equal(calcEarnPoints(500, {}), 0);
});

test("returns 0 when is_active is false (loyalty disabled)", () => {
  assert.equal(calcEarnPoints(500, { is_active: false, points_per_baht: 100 }), 0);
});

test("returns 0 when points_per_baht is 0 or negative (rate unconfigured)", () => {
  assert.equal(calcEarnPoints(500, { is_active: true, points_per_baht: 0 }), 0);
  assert.equal(calcEarnPoints(500, { is_active: true, points_per_baht: -1 }), 0);
});

test("returns 0 when amount is 0 or negative (refund / void sale should not earn)", () => {
  assert.equal(calcEarnPoints(0, RATE_100), 0);
  assert.equal(calcEarnPoints(-500, RATE_100), 0, "negative spend (refund) must not credit points");
});

test("string coercion: amount or rate passed as string still works (DB returns strings sometimes)", () => {
  assert.equal(calcEarnPoints("500", RATE_100), 5);
  assert.equal(calcEarnPoints(500, { is_active: true, points_per_baht: "100" }), 5);
});

test("rate of 1 means 1 baht = 1 point (effectively no threshold)", () => {
  assert.equal(calcEarnPoints(500, { is_active: true, points_per_baht: 1 }), 500);
});

test("rate of 50 (every 50 baht = 1 point): 500 → 10 points", () => {
  assert.equal(calcEarnPoints(500, { is_active: true, points_per_baht: 50 }), 10);
});

test("integration: earnPoints uses calcEarnPoints (not the old multiplication)", async () => {
  // Mock window._appXhrPost so earnPoints can run without a real HTTP layer.
  // The point is to verify earnPoints reports the right point count via the
  // success toast it would emit — which means the formula is wired through.
  const { earnPoints } = await import("../modules/loyalty.js");

  globalThis.window = globalThis.window || {};
  let postedRecord = null;
  globalThis.window._appXhrPost = async (table, record) => {
    postedRecord = { table, record };
    return { ok: true, data: { id: 1 }, error: null };
  };

  let toastMsg = null;
  const ctx = {
    state: { loyaltySettings: RATE_100 },
    showToast: (msg) => { toastMsg = msg; },
    loadAllData: null,
  };

  const result = await earnPoints(/* customerId */ 42, /* amount */ 500, "sale", 999, ctx);

  assert.equal(result?.ok, true, "earnPoints should succeed when amount and rate are valid");
  assert.ok(postedRecord, "earnPoints must POST a loyalty_points record");
  assert.equal(postedRecord.table, "loyalty_points");
  assert.equal(postedRecord.record.points, 5, "must POST exactly 5 points for 500/100 — NEVER 50000");
  assert.equal(postedRecord.record.customer_id, 42);
  assert.equal(postedRecord.record.ref_type, "sale");
  assert.equal(postedRecord.record.ref_id, 999);
  assert.ok(toastMsg && toastMsg.includes("5 แต้ม"), `toast must report 5 points (was: ${toastMsg})`);

  // Cleanup the mock so it doesn't leak into other tests
  delete globalThis.window._appXhrPost;
});

test("integration: amount below threshold returns ok:false and posts NOTHING (no DB write)", async () => {
  const { earnPoints } = await import("../modules/loyalty.js");

  globalThis.window = globalThis.window || {};
  let postCalls = 0;
  globalThis.window._appXhrPost = async () => {
    postCalls++;
    return { ok: true, data: { id: 1 }, error: null };
  };

  const ctx = {
    state: { loyaltySettings: RATE_100 },
    showToast: () => {},
    loadAllData: null,
  };

  const result = await earnPoints(42, /* amount = 50 (below 100 threshold) */ 50, "sale", 123, ctx);
  assert.equal(result?.ok, false, "below-threshold spend must NOT report success");
  assert.equal(postCalls, 0, "below-threshold spend must NOT call _appXhrPost — saves DB row + RLS check");

  delete globalThis.window._appXhrPost;
});
