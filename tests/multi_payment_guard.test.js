// Phase 89.42 — Regression tests for multi-payment save guard (Site 1)
//
// Bug scenario being prevented (MEDIUM_RISK from Phase 89.40 audit):
//   1. User opens receipt → multi-pay drawer → adds 2+ payment methods
//   2. User clicks "บันทึก" → handler A starts, awaits PATCH /receipts
//   3. User clicks again before A resolves → handler B enters, also awaits PATCH
//   4. → 2 PATCH calls on same receipt, possible lost update (last write wins),
//        rapid duplicate JV side-effects if linked auto-post is wired in later
//
// Fix: wrap the save click handler body in modules/_inflight_guard.js
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createInflightGuard } from "../modules/_inflight_guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const receiptsSrc = readFileSync(path.join(__dirname, "..", "modules", "receipts.js"), "utf8");

// ── Integration: production code actually uses the helper ────────────
test("receipts.js multi-pay: imports createInflightGuard from _inflight_guard helper", () => {
  assert.match(
    receiptsSrc,
    /import\s+\{[^}]*createInflightGuard[^}]*\}\s+from\s+["']\.\/_inflight_guard\.js["']/,
    "receipts.js must import createInflightGuard so the multi-pay save handler can be guarded",
  );
});

test("receipts.js multi-pay: declares a module-level guard instance for the save handler", () => {
  assert.match(
    receiptsSrc,
    /const\s+_multiPayGuard\s*=\s*createInflightGuard\(\)/,
    "receipts.js must declare a module-level _multiPayGuard instance (separate from other guards)",
  );
});

test("receipts.js multi-pay: save handler routes through _multiPayGuard.run()", () => {
  assert.match(
    receiptsSrc,
    /_multiPayGuard\.run\s*\(/,
    "the multi-pay save click handler body must be wrapped in _multiPayGuard.run(...)",
  );
});

// ── Behavioral contract: scenarios specific to multi-payment ─────────
test("multi-pay guard contract: double-click within inflight window → only 1 PATCH issued", async () => {
  const guard = createInflightGuard();
  const patchCalls = [];
  const fakeSave = async () => {
    // mimic PATCH /receipts latency
    await new Promise((res) => setTimeout(res, 30));
    patchCalls.push({ payments: [{ method: "cash", amount: 500 }] });
    return "ok";
  };
  const [r1, r2] = await Promise.all([guard.run(fakeSave), guard.run(fakeSave)]);
  assert.equal(patchCalls.length, 1, "rapid double-click must collapse to a single PATCH (no lost-update race)");
  assert.equal(r1, "ok", "1st caller still gets the PATCH result");
  assert.equal(r2, undefined, "2nd caller silently skips (no UI error)");
});

test("multi-pay guard contract: sequential saves after lock release both run", async () => {
  const guard = createInflightGuard();
  const patchCalls = [];
  const fakeSave = (label) => () => new Promise((res) => setTimeout(() => { patchCalls.push(label); res(label); }, 10));
  const r1 = await guard.run(fakeSave("first"));
  const r2 = await guard.run(fakeSave("second"));
  assert.deepEqual(patchCalls, ["first", "second"], "after 1st save finishes, a follow-up edit must still go through");
  assert.equal(r1, "first");
  assert.equal(r2, "second");
});

test("multi-pay guard contract: save error releases lock so user can retry", async () => {
  const guard = createInflightGuard();
  await assert.rejects(
    () => guard.run(async () => { throw new Error("PATCH 503 — supabase down"); }),
    /PATCH 503/,
  );
  // User retries — must succeed
  const r = await guard.run(async () => "retry-ok");
  assert.equal(r, "retry-ok", "after a failed save, the next user retry must be able to acquire the guard");
});
