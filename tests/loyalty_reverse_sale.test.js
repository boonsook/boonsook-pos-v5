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

// Phase 541 (S6): reverseEarnedPointsForSale now reads loyalty rows from the DB (source of truth)
// via fetchAllRowsRaw → mock globalThis.fetch to serve `rows`, honouring the PostgREST filters the
// function uses (ref_id=eq.X · ref_type=in.(a,b) · customer_id=eq.Y). failFetch → HTTP 500 (throws
// in fetchAllRowsRaw → exercises the no-silent-skip path). Also sets window.SUPABASE_CONFIG.
function installMockDb(rows = [], { failFetch = false } = {}) {
  const origFetch = globalThis.fetch;
  globalThis.window = globalThis.window || {};
  const prevCfg = globalThis.window.SUPABASE_CONFIG;
  globalThis.window.SUPABASE_CONFIG = { url: "https://test.supabase.co", anonKey: "anon" };
  globalThis.fetch = async (url) => {
    if (failFetch) return { ok: false, status: 500, json: async () => ({}) };
    const params = new URLSearchParams(String(url).split("?")[1] || "");
    if (Number(params.get("offset") || 0) > 0) return { ok: true, status: 200, json: async () => [] };
    let out = rows.slice();
    for (const [k, v] of params.entries()) {
      if (["select", "order", "limit", "offset"].includes(k)) continue;
      if (v.startsWith("eq.")) out = out.filter(r => String(r[k]) === v.slice(3));
      else if (v.startsWith("in.")) {
        const set = v.slice(3).replace(/^\(|\)$/g, "").split(",");
        out = out.filter(r => set.includes(String(r[k])));
      }
    }
    return { ok: true, status: 200, json: async () => out };
  };
  return { restore() { globalThis.fetch = origFetch; globalThis.window.SUPABASE_CONFIG = prevCfg; } };
}

// Mock window._appXhrPost (the reverse INSERT) AND the DB read (from `rows`). Returns captured payloads.
function installMockXhr(rows = [], { shouldFail = false, errMsg = "boom" } = {}) {
  const captured = [];
  const db = installMockDb(rows);
  globalThis.window = globalThis.window || {};
  globalThis.window._appXhrPost = async (table, record) => {
    captured.push({ table, record });
    if (shouldFail) return { ok: false, error: { message: errMsg } };
    return { ok: true, data: { ...record, id: 999 + captured.length }, error: null };
  };
  return {
    captured,
    restore: () => { delete globalThis.window._appXhrPost; db.restore(); },
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
  const xhr = installMockXhr(state.loyaltyPoints);
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
  const xhr = installMockXhr(state.loyaltyPoints);
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
  const xhr = installMockXhr(state.loyaltyPoints);
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
  const xhr = installMockXhr(state.loyaltyPoints);
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
  const xhr = installMockXhr(state.loyaltyPoints);
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
  const xhr = installMockXhr(state.loyaltyPoints);
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
  const xhr = installMockXhr(state.loyaltyPoints);
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
  const xhr = installMockXhr(state.loyaltyPoints);
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
  // DB read mocked (so we reach the insert step), but intentionally NO _appXhrPost insert mock.
  const db = installMockDb(state.loyaltyPoints);
  if (globalThis.window) delete globalThis.window._appXhrPost;
  try {
    const res = await reverseEarnedPointsForSale(100, { state, customerId: 42 });
    assert.equal(res.ok, false);
    assert.equal(res.skipped, false);
    assert.ok(/_appXhrPost/.test(res.reason));
  } finally { db.restore(); }
});

test("reverseEarnedPointsForSale: returns failure (ok:false, skipped:false) when DB insert fails", async () => {
  const state = { loyaltyPoints: [ earnRow({ id: 1, customerId: 42, points: 5, saleId: 100 }) ] };
  const xhr = installMockXhr(state.loyaltyPoints, { shouldFail: true, errMsg: "RLS denied" });
  try {
    const res = await reverseEarnedPointsForSale(100, { state, customerId: 42 });
    assert.equal(res.ok, false);
    assert.equal(res.skipped, false);
    assert.ok(/RLS/.test(res.reason));
    assert.equal(xhr.captured.length, 1, "still attempted the insert (xhr was called) — failure is from server side");
  } finally { xhr.restore(); }
});

// ─── Phase 497 (#4a): DB unique-violation = idempotent skip (concurrent double-void) ───
test("Phase 497: unique-violation (23505) on insert → skip not error (another void already reversed)", async () => {
  const state = { loyaltyPoints: [ earnRow({ id: 1, customerId: 42, points: 5, saleId: 100 }) ] };
  const captured = [];
  const db = installMockDb(state.loyaltyPoints);
  globalThis.window = globalThis.window || {};
  globalThis.window._appXhrPost = async (table, record) => {
    captured.push({ table, record });
    return { ok: false, error: { code: "23505", message: 'duplicate key value violates unique constraint "uq_loyalty_sale_reverse"', status: 409 } };
  };
  try {
    const res = await reverseEarnedPointsForSale(100, { state, customerId: 42 });
    assert.equal(res.ok, false);
    assert.equal(res.skipped, true, "23505 = the concurrent void already reversed → skip, never double-deduct");
    assert.match(res.reason, /already reversed/);
    assert.equal(captured.length, 1, "it attempted the insert; the DB partial-unique rejected the duplicate");
  } finally { delete globalThis.window._appXhrPost; db.restore(); }
});

test("Phase 497: a real (non-unique) DB error still surfaces as failure (skipped:false)", async () => {
  const state = { loyaltyPoints: [ earnRow({ id: 1, customerId: 42, points: 5, saleId: 100 }) ] };
  const db = installMockDb(state.loyaltyPoints);
  globalThis.window = globalThis.window || {};
  globalThis.window._appXhrPost = async () => ({ ok: false, error: { code: "42501", message: "permission denied", status: 403 } });
  try {
    const res = await reverseEarnedPointsForSale(100, { state, customerId: 42 });
    assert.equal(res.skipped, false, "only 23505/duplicate is swallowed; RLS/network must still surface");
  } finally { delete globalThis.window._appXhrPost; db.restore(); }
});

test("Phase 497: xhrPost surfaces the Postgres error code so idempotent callers can detect 23505", () => {
  const src = readFileSync(path.join(__dirname2, "..", "modules", "api.js"), "utf8");
  assert.match(src, /code\s*=\s*parsed\.code/, "xhrPost must read the PG error code");
  assert.match(src, /error:\s*\{\s*message:\s*msg,\s*code,\s*status:\s*xhr\.status\s*\}/, "xhrPost error must include code + status");
});

// ─── Phase 91.4 hotfix regression ───
// Phase 91.3 wired the helper from refunds.js + sales.js but gated the call on
// the SALE row's customer_id. That sale-row column is an opt-in schema extension
// — pos.js only sends customer_id if `_posCustomer?.id` was truthy at insert
// time AND the column exists. Some prod environments don't have it, so the
// guard skipped the call entirely. The helper itself was always designed to
// recover customer_id from the earn record — this test pins that behavior
// down with a real call shape (customerId omitted / null).
test("Phase 91.4: helper resolves customer_id from earn record when caller passes null", async () => {
  // Mirror the real call from modules/sales.js with the post-91.4 wiring:
  //   reverseEarnedPointsForSale(saleId, { state, customerId: targetSale?.customer_id || null })
  // where targetSale is the sale row from state.sales — here we simulate the
  // bad case (sale row exists but customer_id column missing/null).
  const state = { loyaltyPoints: [
    // Earn record HAS customer_id (loyalty_points.customer_id always populated since Phase 91.1)
    earnRow({ id: 1, customerId: 42, points: 5, saleId: 143 }),
  ]};
  const xhr = installMockXhr(state.loyaltyPoints);
  try {
    const res = await reverseEarnedPointsForSale(143, {
      state,
      customerId: null, // ← Phase 91.3 wiring would have GATED off this, never calling helper
    });
    assert.equal(res.ok, true, "helper must succeed by reading customer_id from the earn record");
    assert.equal(res.reversed, 5);
    assert.equal(xhr.captured.length, 1);
    assert.equal(xhr.captured[0].record.customer_id, 42, "reverse record must carry the customer_id from the earn row");
  } finally { xhr.restore(); }
});

test("Phase 91.4: undefined customerId (option key omitted) also works — helper falls back", async () => {
  const state = { loyaltyPoints: [
    earnRow({ id: 1, customerId: 42, points: 5, saleId: 143 }),
  ]};
  const xhr = installMockXhr(state.loyaltyPoints);
  try {
    const res = await reverseEarnedPointsForSale(143, { state });
    assert.equal(res.ok, true);
    assert.equal(xhr.captured[0].record.customer_id, 42);
  } finally { xhr.restore(); }
});

// ─── Phase 541 (S6): reverse reads the DB source-of-truth, not the capped cache ───
test("Phase 541 (S6): reverses from the DB even when state.loyaltyPoints is empty (old sale outside cache)", async () => {
  // The whole point of S6: the in-memory cache is capped (≤500) so an old sale's earn row may be
  // absent. The DB still has it → the reverse must happen. (Previously: state-only → wrongly skipped.)
  const dbRows = [ earnRow({ id: 1, customerId: 42, points: 5, saleId: 100 }) ];
  const xhr = installMockXhr(dbRows);   // DB read = dbRows; cache passed below is empty
  try {
    const res = await reverseEarnedPointsForSale(100, { state: { loyaltyPoints: [] }, customerId: 42 });
    assert.equal(res.ok, true, "must reverse based on the DB, not the empty cache");
    assert.equal(res.reversed, 5);
    assert.equal(xhr.captured.length, 1);
    assert.equal(xhr.captured[0].record.ref_type, "sale_reverse");
    assert.equal(xhr.captured[0].record.ref_id, 100);
  } finally { xhr.restore(); }
});

test("Phase 541 (S6): DB idempotency holds when cache is empty (existing sale_reverse in DB → no double)", async () => {
  const dbRows = [
    earnRow({   id: 1, customerId: 42, points: 5, saleId: 100 }),
    redeemRow({ id: 2, customerId: 42, points: 5, refType: "sale_reverse", refId: 100 }),
  ];
  const xhr = installMockXhr(dbRows);
  try {
    const res = await reverseEarnedPointsForSale(100, { state: { loyaltyPoints: [] }, customerId: 42 });
    assert.equal(res.skipped, true);
    assert.match(res.reason, /already reversed/);
    assert.equal(xhr.captured.length, 0, "DB-sourced idempotency must hold even with an empty cache");
  } finally { xhr.restore(); }
});

test("Phase 541 (S6): caps the reverse at the DB remaining (earned 10, redeemed 7 → reverse 3)", async () => {
  const dbRows = [
    earnRow({   id: 1, customerId: 42, points: 10, saleId: 100 }),
    redeemRow({ id: 2, customerId: 42, points: 7,  refType: "redemption" }),  // remaining = 3
  ];
  const xhr = installMockXhr(dbRows);
  try {
    const res = await reverseEarnedPointsForSale(100, { state: { loyaltyPoints: [] }, customerId: 42 });
    assert.equal(res.ok, true);
    assert.equal(res.totalEarned, 10);
    assert.equal(res.reversed, 3, "cap at DB remaining, never negative");
    assert.equal(res.capped, true);
    assert.equal(xhr.captured[0].record.points, 3);
  } finally { xhr.restore(); }
});

test("Phase 541 (S6): DB fetch failure → {ok:false, skipped:false} and NEVER inserts a reverse", async () => {
  const db = installMockDb([], { failFetch: true });
  let inserted = 0;
  globalThis.window._appXhrPost = async () => { inserted++; return { ok: true }; };
  try {
    const res = await reverseEarnedPointsForSale(100, { state: { loyaltyPoints: [] }, customerId: 42 });
    assert.equal(res.ok, false);
    assert.equal(res.skipped, false, "a failed source-of-truth read must SURFACE (caller warns), not silently skip");
    assert.equal(inserted, 0, "must not insert a reverse when the balance/earn read failed");
  } finally { delete globalThis.window._appXhrPost; db.restore(); }
});

// ─── Source-level pin: wiring must NOT pre-gate on customer_id ───
// This catches a regression where someone re-introduces the pre-check.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const refundsSrc = readFileSync(path.join(__dirname2, "..", "modules", "refunds.js"), "utf8");
const salesSrc   = readFileSync(path.join(__dirname2, "..", "modules", "sales.js"),   "utf8");

// Strip JS line + block comments so the regex below can't false-match against
// "Phase 91.4: removed the `if (...)`..." explainer comments in the source.
function stripComments(src) {
  return src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

test("Phase 91.4: refunds.js wiring must NOT gate on _selectedSale.customer_id (helper resolves it)", () => {
  const code = stripComments(refundsSrc);
  // The buggy pre-check looked like `if (... && _selectedSale?.customer_id)` — reject that shape.
  assert.ok(
    !/&&\s*_selectedSale\?\.customer_id\s*\)/.test(code),
    "refunds.js must not gate the helper call on _selectedSale.customer_id (passing it as a value is fine, gating is the bug)"
  );
  // Confirm the helper IS still being called (otherwise the gate is moot).
  assert.ok(
    /reverseEarnedPointsForSale\(/.test(code),
    "refunds.js must still call reverseEarnedPointsForSale (otherwise nothing to test)"
  );
});

test("Phase 91.4: sales.js wiring must NOT gate on targetSale.customer_id (helper resolves it)", () => {
  const code = stripComments(salesSrc);
  // Buggy pre-check shape: `if (targetSale?.customer_id) { ... }`.
  assert.ok(
    !/if\s*\(\s*targetSale\?\.customer_id\s*\)/.test(code),
    "sales.js must not gate the helper call on targetSale.customer_id — that was the Phase 91.4 hotfix"
  );
  assert.ok(
    /reverseEarnedPointsForSale\(/.test(code),
    "sales.js must still call reverseEarnedPointsForSale (otherwise nothing to test)"
  );
});

// ─── Phase 541 (S6) source guard: reverse must read the DB before deciding "no earn" ───
test("Phase 541 (S6): reverseEarnedPointsForSale fetches loyalty_points from DB before the no-earn branch", () => {
  const loyaltySrc = readFileSync(path.join(__dirname2, "..", "modules", "loyalty.js"), "utf8");
  const start = loyaltySrc.indexOf("export async function reverseEarnedPointsForSale");
  const end = loyaltySrc.indexOf("export async function earnPoints", start);
  assert.ok(start !== -1 && end > start, "reverseEarnedPointsForSale body must be found");
  // strip comments so the explainer comment ("...state.loyaltyPoints is an in-memory cache...")
  // doesn't false-match the "must not read state" assertion below.
  const body = stripComments(loyaltySrc.slice(start, end));
  assert.match(body, /fetchAllRowsRaw\(/, "must read from the DB (source of truth), not state.loyaltyPoints");
  assert.match(body, /loyalty_points\?ref_id=eq\./, "must query loyalty_points by the sale's ref_id");
  const idxFetch = body.indexOf("fetchAllRowsRaw");
  const idxNoEarn = body.indexOf("no earn records for this sale");
  assert.ok(idxFetch !== -1 && idxNoEarn !== -1 && idxFetch < idxNoEarn,
    "the DB fetch must come BEFORE the 'no earn records' skip (else old sales are wrongly skipped)");
  assert.match(body, /skipped: false, reason: 'db fetch failed/,
    "a failed DB fetch must return {skipped:false} (no silent skip, no insert)");
  // must NOT regress to reading the capped in-memory cache as the source of truth (code, not comments)
  assert.ok(!/state\.loyaltyPoints/.test(body), "reverse must not read state.loyaltyPoints as source of truth");
});
