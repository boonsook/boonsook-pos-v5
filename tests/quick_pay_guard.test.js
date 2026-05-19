// Phase 89.42 — Regression tests for POS quickPay checkout guard (Site 2)
//
// Bug scenario being prevented (MEDIUM_RISK from Phase 89.40 audit):
//   1. Cashier on POS screen pins amount on numpad -> quickPayAmount=500
//      + selects customer -> _posCustomer={id:7,...}
//   2. Cashier double-taps "เสร็จสิ้น" (network slow, no visual feedback)
//   3. handler A starts doCheckout (POSTs sale, awaits sale_items inserts,
//      awaits stock deduct chain ~500ms total)
//   4. handler B enters before A reaches line 1194 (quickPayAmount="";)
//      and 1196 (_posCustomer=null;) -> 2 sales committed for same cart,
//      customer attribution can leak if a 3rd checkout starts mid-reset
//
// Fix: replace the existing window._checkoutRunning manual flag with
// modules/_inflight_guard.js (same helper used by Phase 89.41 sites).
// The guard's finally{} block guarantees release even on throw — the
// old pattern required 3 manual reset points (lines 1121, 1128, 1240).
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createInflightGuard } from "../modules/_inflight_guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const posSrc = readFileSync(path.join(__dirname, "..", "modules", "pos.js"), "utf8");

// ── Integration: production code actually uses the helper ────────────
test("pos.js: imports createInflightGuard from _inflight_guard helper", () => {
  assert.match(
    posSrc,
    /import\s+\{[^}]*createInflightGuard[^}]*\}\s+from\s+["']\.\/_inflight_guard\.js["']/,
    "pos.js must import createInflightGuard so doCheckout can be guarded",
  );
});

test("pos.js: declares a module-level _posCheckoutGuard instance", () => {
  assert.match(
    posSrc,
    /const\s+_posCheckoutGuard\s*=\s*createInflightGuard\(\)/,
    "pos.js must declare a module-level _posCheckoutGuard instance (separate from main.js _checkoutGuard)",
  );
});

test("pos.js doCheckout: body routes through _posCheckoutGuard.run()", () => {
  assert.match(
    posSrc,
    /_posCheckoutGuard\.run\s*\(/,
    "doCheckout body must be wrapped in _posCheckoutGuard.run(...)",
  );
});

test("pos.js: window._checkoutRunning manual flag removed (guard replaces it)", () => {
  assert.doesNotMatch(
    posSrc,
    /window\._checkoutRunning\s*=\s*true/,
    "manual set-true is replaced by guard.run() entry",
  );
  assert.doesNotMatch(
    posSrc,
    /window\._checkoutRunning\s*=\s*false/,
    "manual reset-false is replaced by guard's finally release",
  );
});

// ── Behavioral contract: scenarios specific to POS quickPay ─────────
test("quickPay guard contract: rapid double-tap on เสร็จสิ้น → single sale POST", async () => {
  const guard = createInflightGuard();
  const salesPosted = [];
  const fakeCheckout = async () => {
    // mimic POST /sales latency
    await new Promise((res) => setTimeout(res, 30));
    salesPosted.push({ orderNo: "BSK-" + Date.now() });
    return "ok";
  };
  const [r1, r2] = await Promise.all([guard.run(fakeCheckout), guard.run(fakeCheckout)]);
  assert.equal(salesPosted.length, 1, "double-tap must collapse to 1 sale (no duplicate POST)");
  assert.equal(r1, "ok");
  assert.equal(r2, undefined, "2nd tap silently skips — no toast/UI noise");
});

test("quickPay guard contract: customer/amount state never leaks across sequential sales", async () => {
  const guard = createInflightGuard();
  // Module state simulation (what pos.js stores: quickPayAmount + _posCustomer)
  let quickPayAmount = 0;
  let _posCustomer = null;
  const captured = [];

  const checkout = (amount, customer) => async () => {
    quickPayAmount = amount;
    _posCustomer = customer;
    await new Promise((res) => setTimeout(res, 10));
    captured.push({ amount: quickPayAmount, customer: _posCustomer });
    quickPayAmount = 0;
    _posCustomer = null;
  };

  // Cashier 1: customer A, ฿500
  await guard.run(checkout(500, { id: 7, name: "ลูกค้า A" }));
  // Cashier 2: customer B, ฿200 — must start with clean slate
  await guard.run(checkout(200, { id: 9, name: "ลูกค้า B" }));

  assert.equal(captured.length, 2, "2 sequential checkouts both complete");
  assert.equal(captured[0].amount, 500);
  assert.equal(captured[0].customer.id, 7);
  assert.equal(captured[1].amount, 200);
  assert.equal(captured[1].customer.id, 9, "no cross-contamination: 2nd sale sees its own customer, not leaked A");
});

test("quickPay guard contract: throw in doCheckout releases lock so next attempt works", async () => {
  const guard = createInflightGuard();
  await assert.rejects(
    () => guard.run(async () => { throw new Error("POST 500 — supabase timeout"); }),
    /POST 500/,
  );
  // Cashier retries → must succeed
  const r = await guard.run(async () => "retry-ok");
  assert.equal(r, "retry-ok", "after a failed checkout, retry must acquire the guard (lock auto-released in finally)");
});
