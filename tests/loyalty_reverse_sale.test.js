// Phase 91.3 — Regression tests for loyalty reverse-on-refund/cancel.
//
// The helpers under test live in modules/loyalty.js:
//   getSaleEarnedPoints(state, saleId, customerId)   — sum earn for one sale
//   hasReversedLoyaltyForSale(state, saleId, customerId) — idempotency probe
//   reverseEarnedPointsForSale(saleId, options)      — inserts the reverse row
//
// Record shape (kept inside existing schema — no new `type` value):
//   type      = 'redeem'
//   ref_type  = 'sale_reverse'
//   ref_id    = <saleId>
//
// Critical invariants exercised below:
//   • exact reverse on happy path (sale +5 → reverse 5)
//   • idempotent (second call skips)
//   • skips when no customer, no earn, or remaining=0
//   • cap at remaining (never drives balance negative)
//   • main flow does NOT fail when window._appXhrPost is missing or throws
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSaleEarnedPoints,
  hasReversedLoyaltyForSale,
  reverseEarnedPointsForSale,
} from "../modules/loyalty.js";

// Helpers for assembling fake state.loyaltyPoints rows in the shape the
// production code reads (column types match: customer_id is a number per
// Phase 90.10; ref_id is also a number in the DB, but the helper always
// String()-casts both sides).
function earnRow({ id, customerId, points, saleId }) {
  return {
    id,
    customer_id: customerId,
    type: "earn",
    points,
    ref_type: "sale",
    ref_id: saleId,
    note: null,
    created_at: "2026-05-19T10:00:00Z",
  };
}
function redeemRow({ id, customerId, points, refType = "redemption", refId = null }) {
  return {
    id,
    customer_id: customerId,
    type: "redeem",
    points,
    ref_type: refType,
    ref_id: refId,
    note: null,
    created_at: "2026-05-19T11:00:00Z",
  };
}

// Mock window._appXhrPost and return the captured payload.
// Each call resets — return what you want via factory args.
function installMockXhr({ shouldFail = false, errMsg = "boom" } = {}) {
  const captured = [];
  globalThis.window = globalThis.window || {};
  globalThis.window._appXhrPost = async (table, record) => {
    captured.push({ table, record });
    if (shouldFail) return { ok: false, error: { message: errMsg } };
    return { ok: true, data: { ...record, id: 999 + captured.length }, error: null };
  };
  return {
    captured,
    restore: () => { delete globalThis.window._appXhrPost; },
  };
}

// ─── getSaleEarnedPoints ───
test("getSaleEarnedPoints returns 0 when state or saleId missing", () => {
  assert.equal(getSaleEarnedPoints(null, 1, 1), 0);
  assert.equal(getSaleEarnedPoints({}, null, 1), 0);
  assert.equal(getSaleEarnedPoints({ loyaltyPoints: [] }, 1, 1), 0);
});

test("getSaleEarnedPoints sums only earn rows with matching sale ref_id (ignores other sales)", () => {
  const state = { loyaltyPoints: [
    earnRow({ id: 1, customerId: 42, points: 5,  saleId: 100 }),
    earnRow({ id: 2, customerId: 42, points: 99, saleId: 200 }),  // different sale
    earnRow({ id: 3, customerId: 99, points: 3,  saleId: 100 }),  // different customer
  ]};
  assert.equal(getSaleEarnedPoints(state, 100, 42), 5);
  assert.equal(getSaleEarnedPoints(state, 100, 99), 3);
  assert.equal(getSaleEarnedPoints(state, 200, 42), 99);
});

test("getSaleEarnedPoints with null customerId sums across all customers for that sale", () => {
  const state = { loyaltyPoints: [
    earnRow({ id: 1, customerId: 42, points: 5, saleId: 100 }),
    earnRow({ id: 2, customerId: 99, points: 3, saleId: 100 }),
  ]};
  assert.equal(getSaleEarnedPoints(state, 100, null), 8);
});

test("getSaleEarnedPoints ignores redeem rows even with matching ref_id", () => {
  const state = { loyaltyPoints: [
    earnRow({   id: 1, customerId: 42, points: 5, saleId: 100 }),
    redeemRow({ id: 2, customerId: 42, points: 2, refType: "sale_reverse", refId: 100 }),
  ]};
  assert.equal(getSaleEarnedPoints(state, 100, 42), 5);
});

test("getSaleEarnedPoints uses String() compare (bigint id from DB vs JS number — Phase 90.10 lesson)", () => {
  const state = { loyaltyPoints: [
    earnRow({ id: 1, customerId: 42, points: 5, saleId: 100 }),
  ]};
  // saleId passed as string (e.g. from URL param)
  assert.equal(getSaleEarnedPoints(state, "100", 42), 5);
  // customerId as string
  assert.equal(getSaleEarnedPoints(state, 100, "42"), 5);
});

// ─── hasReversedLoyaltyForSale ───
test("hasReversedLoyaltyForSale returns false when no reverse row exists", () => {
  const state = { loyaltyPoints: [
    earnRow({ id: 1, customerId: 42, points: 5, saleId: 100 }),
  ]};
  assert.equal(hasReversedLoyaltyForSale(state, 100, 42), false);
});

test("hasReversedLoyaltyForSale returns true when reverse row exists", () => {
  const state = { loyaltyPoints: [
    earnRow({   id: 1, customerId: 42, points: 5, saleId: 100 }),
    redeemRow({ id: 2, customerId: 42, points: 5, refType: "sale_reverse", refId: 100 }),
  ]};
  assert.equal(hasReversedLoyaltyForSale(state, 100, 42), true);
});

test("hasReversedLoyaltyForSale distinguishes ref_type='sale_reverse' from other redeem types", () => {
  const state = { loyaltyPoints: [
    earnRow({   id: 1, customerId: 42, points: 5, saleId: 100 }),
    redeemRow({ id: 2, customerId: 42, points: 5, refType: "redemption", refId: 100 }),  // manual redeem, not a reverse
  ]};
  assert.equal(hasReversedLoyaltyForSale(state, 100, 42), false, "manual redeem with ref_id=saleId should not block reverse");
});

// ─── reverseEarnedPointsForSale: happy path ───
test("reverseEarnedPointsForSale: sale earned 5 → reverses exactly 5, inserts type=redeem + ref_type=sale_reverse", async () => {
  const state = { loyaltyPoints: [ earnRow({ id: 1, customerId: 42, points: 5, saleId: 100 }) ] };
  const xhr = installMockXhr();
  try {
    const res = await reverseEarnedPointsForSale(100, { state, customerId: 42 });
    assert.equal(res.ok, true);
    assert.equal(res.reversed, 5);
    assert.equal(res.totalEarned, 5);
    assert.equal(res.capped, false);

    assert.equal(xhr.captured.length, 1);
    const { table, record } = xhr.captured[0];
    assert.equal(table, "loyalty_points");
    assert.equal(record.type, "redeem");
    assert.equal(record.ref_type, "sale_reverse");
    assert.equal(record.ref_id, 100);
    assert.equal(record.customer_id, 42);
    assert.equal(record.points, 5);
    // Note format differs by caller: refund branch includes "sale #N", cancel branch uses Thai "บิล #N".
    // Either way, the sale id must appear for audit.
    assert.ok(/#100/.test(record.note), `note must reference sale id 100 — got: ${record.note}`);
  } finally { xhr.restore(); }
});

test("reverseEarnedPointsForSale: includes refund #id in note when refundId is passed", async () => {
  const state = { loyaltyPoints: [ earnRow({ id: 1, customerId: 42, points: 5, saleId: 100 }) ] };
  const xhr = installMockXhr();
  try {
    await reverseEarnedPointsForSale(100, { state, customerId: 42, refundId: 7 });
    const note = xhr.captured[0].record.note;
    assert.ok(/refund #7/.test(note), `refund-flow note must reference refund id (got: ${note})`);
    assert.ok(/sale #100/.test(note));
  } finally { xhr.restore(); }
});

// ─── reverseEarnedPointsForSale: idempotency ───
test("reverseEarnedPointsForSale: skips when a reverse already exists for this sale (idempotent)", async () => {
  const state = { loyaltyPoints: [
    earnRow({   id: 1, customerId: 42, points: 5, saleId: 100 }),
    redeemRow({ id: 2, customerId: 42, points: 5, refType: "sale_reverse", refId: 100 }),
  ]};
  const xhr = installMockXhr();
  try {
    const res = await reverseEarnedPointsForSale(100, { state, customerId: 42 });
    assert.equal(res.ok, false);
    assert.equal(res.skipped, true);
    assert.equal(res.reason, "already reversed");
    assert.equal(xhr.captured.length, 0, "must NOT insert a second reverse — over-claw-back");
  } finally { xhr.restore(); }
});

// ─── reverseEarnedPointsForSale: silent skips ───
test("reverseEarnedPointsForSale: skips when sale has no earn record (sale had no customer / loyalty was off)", async () => {
  const state = { loyaltyPoints: [
    earnRow({ id: 1, customerId: 42, points: 5, saleId: 999 }),  // different sale only
  ]};
  const xhr = installMockXhr();
  try {
    const res = await reverseEarnedPointsForSale(100, { state, customerId: 42 });
    assert.equal(res.ok, false);
    assert.equal(res.skipped, true);
    assert.equal(res.reason, "no earn records for this sale");
    assert.equal(xhr.captured.length, 0);
  } finally { xhr.restore(); }
});

test("reverseEarnedPointsForSale: skips when neither options.customerId nor earn.customer_id are present", async () => {
  const state = { loyaltyPoints: [
    earnRow({ id: 1, customerId: null, points: 5, saleId: 100 }),  // earn with no customer (shouldn't happen but defend)
  ]};
  const xhr = installMockXhr();
  try {
    const res = await reverseEarnedPointsForSale(100, { state /* no customerId */ });
    assert.equal(res.ok, false);
    assert.equal(res.skipped, true);
    assert.ok(/no customer_id/.test(res.reason));
    assert.equal(xhr.captured.length, 0);
  } finally { xhr.restore(); }
});

// ─── reverseEarnedPointsForSale: cap at remaining ───
test("reverseEarnedPointsForSale: caps reverse at customer's remaining when they already redeemed some (no negative balance)", async () => {
  const state = { loyaltyPoints: [
    earnRow({   id: 1, customerId: 42, points: 5, saleId: 100 }),                 // +5
    redeemRow({ id: 2, customerId: 42, points: 3, refType: "redemption" }),        // -3 (manual redeem)
    // remaining = 5 - 3 = 2; sale earned 5, but only 2 can be reversed
  ]};
  const xhr = installMockXhr();
  try {
    const res = await reverseEarnedPointsForSale(100, { state, customerId: 42 });
    assert.equal(res.ok, true);
    assert.equal(res.reversed, 2,  "must reverse only what remains, not the full 5");
    assert.equal(res.totalEarned, 5);
    assert.equal(res.capped, true);

    const rec = xhr.captured[0].record;
    assert.equal(rec.points, 2);
    assert.ok(/2\/5/.test(rec.note),    `cap note must reflect the partial reverse — got: ${rec.note}`);
    assert.ok(/redeem/.test(rec.note),  "cap note should explain why (already redeemed)");
  } finally { xhr.restore(); }
});

test("reverseEarnedPointsForSale: skips when remaining is 0 (customer already spent every point)", async () => {
  const state = { loyaltyPoints: [
    earnRow({   id: 1, customerId: 42, points: 5, saleId: 100 }),
    redeemRow({ id: 2, customerId: 42, points: 5, refType: "redemption" }),  // remaining = 0
  ]};
  const xhr = installMockXhr();
  try {
    const res = await reverseEarnedPointsForSale(100, { state, customerId: 42 });
    assert.equal(res.ok, false);
    assert.equal(res.skipped, true);
    assert.ok(/no remaining/i.test(res.reason));
    assert.equal(res.totalEarned, 5);
    assert.equal(res.capped, true);
    assert.equal(xhr.captured.length, 0, "skip = no DB row, no toast — admin must reconcile manually");
  } finally { xhr.restore(); }
});

test("reverseEarnedPointsForSale: clamps negative remaining to 0 (defense — should never happen but)", async () => {
  // Hypothetical out-of-band manipulation putting remaining negative.
  // Helper must still refuse to write a "negative reverse" or skip the cap.
  const state = { loyaltyPoints: [
    earnRow({   id: 1, customerId: 42, points: 5, saleId: 100 }),
    redeemRow({ id: 2, customerId: 42, points: 99, refType: "redemption" }),  // remaining = -94
  ]};
  const xhr = installMockXhr();
  try {
    const res = await reverseEarnedPointsForSale(100, { state, customerId: 42 });
    assert.equal(res.ok, false);
    assert.equal(res.skipped, true);
    assert.equal(xhr.captured.length, 0);
  } finally { xhr.restore(); }
});

// ─── reverseEarnedPointsForSale: failure modes ───
test("reverseEarnedPointsForSale: returns failure (ok:false, skipped:false) when xhr is missing — never throws", async () => {
  const state = { loyaltyPoints: [ earnRow({ id: 1, customerId: 42, points: 5, saleId: 100 }) ] };
  // Intentionally do NOT install the mock
  if (globalThis.window) delete globalThis.window._appXhrPost;
  const res = await reverseEarnedPointsForSale(100, { state, customerId: 42 });
  assert.equal(res.ok, false);
  assert.equal(res.skipped, false);
  assert.ok(/_appXhrPost/.test(res.reason));
});

test("reverseEarnedPointsForSale: returns failure (ok:false, skipped:false) when DB insert fails", async () => {
  const state = { loyaltyPoints: [ earnRow({ id: 1, customerId: 42, points: 5, saleId: 100 }) ] };
  const xhr = installMockXhr({ shouldFail: true, errMsg: "RLS denied" });
  try {
    const res = await reverseEarnedPointsForSale(100, { state, customerId: 42 });
    assert.equal(res.ok, false);
    assert.equal(res.skipped, false);
    assert.ok(/RLS/.test(res.reason));
    assert.equal(xhr.captured.length, 1, "still attempted the insert (xhr was called) — failure is from server side");
  } finally { xhr.restore(); }
});
