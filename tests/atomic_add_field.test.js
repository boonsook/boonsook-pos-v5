// Phase 92.12 — Unit tests for atomicAddToField CAS increment
// Money-critical: credit payment increment must be atomic (no lost updates when
// 2 staff receive payment on the same credit sale concurrently).
// Same CAS pattern as atomicDecrementStock but delta can be +/- (require finite).

import { test } from "node:test";
import assert from "node:assert/strict";
import { atomicAddToField } from "../modules/stock_cas.js";

// fake fetcher: refetch returns current value; PATCH ?field=eq.{before} succeeds only if before matches
function makeFetcher(initial) {
  let value = initial;
  return {
    get value() { return value; },
    fn: async (url, opts) => {
      if (!opts || opts.method !== "PATCH") {
        return { ok: true, json: async () => [{ credit_paid_amount: value }] };
      }
      // PATCH: parse ?credit_paid_amount=eq.{before} from url
      const m = url.match(/credit_paid_amount=eq\.([0-9.]+)/);
      const precond = m ? Number(m[1]) : null;
      if (precond !== value) return { ok: true, json: async () => [] }; // stale → 0 rows
      value = JSON.parse(opts.body).credit_paid_amount;
      return { ok: true, json: async () => [{ credit_paid_amount: value }] };
    },
  };
}

test("atomicAddToField: increments by delta, returns after", async () => {
  const f = makeFetcher(100);
  const r = await atomicAddToField({ fetcher: f.fn, supabaseUrl: "x", anonKey: "k", table: "sales", rowId: 1, field: "credit_paid_amount", delta: 50 });
  assert.equal(r.ok, true);
  assert.equal(r.before, 100);
  assert.equal(r.after, 150);
  assert.equal(f.value, 150);
});

test("atomicAddToField: stale precondition → retry then succeed", async () => {
  // value moves under us once, CAS retries with fresh before
  let calls = 0;
  let value = 100;
  const fetcher = async (url, opts) => {
    if (!opts || opts.method !== "PATCH") return { ok: true, json: async () => [{ credit_paid_amount: value }] };
    calls++;
    if (calls === 1) { value = 130; return { ok: true, json: async () => [] }; } // first PATCH stale → bump value
    const m = url.match(/credit_paid_amount=eq\.([0-9.]+)/); const precond = Number(m[1]);
    if (precond !== value) return { ok: true, json: async () => [] };
    value = JSON.parse(opts.body).credit_paid_amount;
    return { ok: true, json: async () => [{ credit_paid_amount: value }] };
  };
  const r = await atomicAddToField({ fetcher, supabaseUrl: "x", anonKey: "k", table: "sales", rowId: 1, field: "credit_paid_amount", delta: 50 });
  assert.equal(r.ok, true);
  assert.equal(r.after, 180); // 130 (bumped) + 50 — no lost update
});

test("atomicAddToField: null field → fail fast (no infinite retry)", async () => {
  const fetcher = async () => ({ ok: true, json: async () => [{ credit_paid_amount: null }] });
  const r = await atomicAddToField({ fetcher, supabaseUrl: "x", anonKey: "k", table: "sales", rowId: 1, field: "credit_paid_amount", delta: 50 });
  assert.equal(r.ok, false);
});

test("atomicAddToField: contention exhausts retries → ok:false", async () => {
  let value = 100;
  const fetcher = async (url, opts) => {
    if (!opts || opts.method !== "PATCH") return { ok: true, json: async () => [{ credit_paid_amount: value }] };
    value += 1; return { ok: true, json: async () => [] }; // always stale
  };
  const r = await atomicAddToField({ fetcher, supabaseUrl: "x", anonKey: "k", table: "sales", rowId: 1, field: "credit_paid_amount", delta: 50, maxRetries: 3 });
  assert.equal(r.ok, false);
});

test("atomicAddToField: non-finite delta → fail fast", async () => {
  const f = makeFetcher(100);
  const r = await atomicAddToField({ fetcher: f.fn, supabaseUrl: "x", anonKey: "k", table: "sales", rowId: 1, field: "credit_paid_amount", delta: NaN });
  assert.equal(r.ok, false);
});
