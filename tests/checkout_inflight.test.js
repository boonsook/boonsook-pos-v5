// Phase 89.41 — Regression tests for single-flight guard used by checkout flows
//
// Bug scenario being prevented (HIGH_RISK race condition from Phase 89.40 audit):
//   1. User clicks "ชำระเงิน" / "สั่งซื้อ" once → handler A starts, awaits sale insert
//   2. User clicks again before A resolves → handler B enters, also awaits insert
//   3. → 2 sales rows committed, 2 receipts, double stock deduction
//
// Fix: wrap entire checkout body in a single-flight guard. 2nd concurrent
// invocation returns immediately without doing the work.
//
// Helper module under test: modules/_inflight_guard.js (used by both
// main.js checkout() — Site 1 — and customer_dashboard.js _handleCustCheckout — Site 2).
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInflightGuard } from "../modules/_inflight_guard.js";

test("createInflightGuard: 2 concurrent calls → fn runs exactly once (double-click guard)", async () => {
  const guard = createInflightGuard();
  let runs = 0;
  const work = () => new Promise((res) => setTimeout(() => { runs++; res("done-" + runs); }, 30));
  const [r1, r2] = await Promise.all([guard.run(work), guard.run(work)]);
  assert.equal(runs, 1, "underlying fn must execute exactly once");
  assert.equal(r1, "done-1", "1st caller receives the fn's resolved value");
  assert.equal(r2, undefined, "2nd caller returns undefined (no-op, silent skip)");
});

test("createInflightGuard: lock releases after fn resolves — sequential calls all succeed", async () => {
  const guard = createInflightGuard();
  let runs = 0;
  const work = () => new Promise((res) => setTimeout(() => { runs++; res(runs); }, 5));
  const r1 = await guard.run(work);
  const r2 = await guard.run(work);
  const r3 = await guard.run(work);
  assert.equal(r1, 1);
  assert.equal(r2, 2);
  assert.equal(r3, 3);
  assert.equal(runs, 3, "after each fn resolves the guard re-arms");
});

test("createInflightGuard: lock releases when fn throws — guard does not get stuck", async () => {
  const guard = createInflightGuard();
  await assert.rejects(
    () => guard.run(async () => { throw new Error("simulated checkout failure"); }),
    /simulated checkout failure/,
  );
  assert.equal(guard.isInflight, false, "lock must release in finally even on throw");
  const r = await guard.run(async () => "recovered");
  assert.equal(r, "recovered", "next call after rejection must be able to acquire the lock");
});

test("createInflightGuard: isInflight reflects state during and after fn execution", async () => {
  const guard = createInflightGuard();
  assert.equal(guard.isInflight, false, "initial state");
  let observedDuring = null;
  const p = guard.run(async () => {
    observedDuring = guard.isInflight;
    await new Promise((res) => setTimeout(res, 10));
    return "ok";
  });
  await p;
  assert.equal(observedDuring, true, "isInflight must be true while fn is running");
  assert.equal(guard.isInflight, false, "isInflight resets after fn resolves");
});

test("createInflightGuard: 3-way burst → only first runs, others silently skip", async () => {
  const guard = createInflightGuard();
  let runs = 0;
  const work = () => new Promise((res) => setTimeout(() => { runs++; res(runs); }, 20));
  const results = await Promise.all([guard.run(work), guard.run(work), guard.run(work)]);
  assert.equal(runs, 1, "triple-click → 1 execution only");
  assert.equal(results[0], 1);
  assert.equal(results[1], undefined);
  assert.equal(results[2], undefined);
});
