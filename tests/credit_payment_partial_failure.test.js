// Phase 92.12 (review hardening) — partial-failure safety for credit payment
// Money-critical: once the credit_payments ledger row is inserted, the operation
// must NOT invite a retry (which would duplicate the ledger row). Cache sync
// (credit_paid_amount / credit_paid_at) is best-effort with ledger-SUM reconciliation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { processCreditPayment } from "../modules/credit_tracker.js";

const silent = { warn() {} };

// Build a fetcher that routes by URL/method. Caller supplies behavior flags.
//   insertOk        — POST credit_payments succeeds
//   ledgerSum       — value returned for GET credit_payments?select=amount (reconcile)
//   reconcilePatchOk— PATCH sales credit_paid_amount (reconcile) succeeds
//   paidAtOk        — PATCH sales credit_paid_at succeeds
function makeFetcher({ insertOk = true, ledgerSum = null, reconcilePatchOk = true, paidAtOk = true } = {}) {
  const calls = { insert: 0, ledgerGet: 0, reconcilePatch: 0, paidAtPatch: 0 };
  const fn = async (url, opts = {}) => {
    const method = opts.method || "GET";
    if (url.includes("/credit_payments") && method === "POST") {
      calls.insert++;
      if (!insertOk) return { ok: false, status: 500, text: async () => "boom" };
      return { ok: true, json: async () => [{ id: 99, amount: JSON.parse(opts.body).amount }] };
    }
    if (url.includes("/credit_payments") && method === "GET") {
      calls.ledgerGet++;
      const rows = (ledgerSum == null) ? [] : [{ amount: ledgerSum }];
      return { ok: true, json: async () => rows };
    }
    if (url.includes("/sales") && method === "PATCH") {
      const body = JSON.parse(opts.body || "{}");
      if ("credit_paid_amount" in body) {
        calls.reconcilePatch++;
        return { ok: !!reconcilePatchOk, status: reconcilePatchOk ? 204 : 500, text: async () => "" };
      }
      if ("credit_paid_at" in body) {
        calls.paidAtPatch++;
        return { ok: !!paidAtOk, status: paidAtOk ? 204 : 500, text: async () => "" };
      }
    }
    return { ok: true, json: async () => [] };
  };
  return { fn, calls };
}

const baseArgs = (over = {}) => ({
  supabaseUrl: "https://x", anonKey: "k", accessToken: "t",
  sale: { id: 1, _paid: 100, _total: 500, customer_id: 7 },
  amount: 50, method: "cash", note: "",
  logger: silent,
  ...over,
});

test("happy path partial payment: insert + CAS ok → ok, paidSynced, no warning", async () => {
  const f = makeFetcher();
  const casOk = async () => ({ ok: true, before: 100, after: 150 });
  const r = await processCreditPayment(baseArgs({ fetcher: f.fn, atomicAdd: casOk }));
  assert.equal(r.ok, true);
  assert.equal(r.ledgerInserted, true);
  assert.equal(r.paidSynced, true);
  assert.equal(r.newPaid, 150);
  assert.equal(r.fullyPaid, false);
  assert.equal(r.syncWarning, null);
});

test("insert fails → ok:false + retrySafe:true (only safe case to re-enable button)", async () => {
  const f = makeFetcher({ insertOk: false });
  const casOk = async () => ({ ok: true, before: 100, after: 150 });
  const r = await processCreditPayment(baseArgs({ fetcher: f.fn, atomicAdd: casOk }));
  assert.equal(r.ok, false);
  assert.equal(r.ledgerInserted, false);
  assert.equal(r.retrySafe, true);
  assert.equal(f.calls.insert, 1);
});

test("D1 — credit_paid_at PATCH fails after CAS success → payment still ok (not failed)", async () => {
  // fully paid: _paid 450 + 50 = 500 == _total → triggers credit_paid_at PATCH
  const f = makeFetcher({ paidAtOk: false });
  const casOk = async () => ({ ok: true, before: 450, after: 500 });
  const r = await processCreditPayment(baseArgs({
    fetcher: f.fn, atomicAdd: casOk,
    sale: { id: 1, _paid: 450, _total: 500, customer_id: 7 },
  }));
  assert.equal(r.ok, true, "ledger committed → payment ok");
  assert.equal(r.retrySafe, false, "must NOT invite retry");
  assert.equal(r.paidSynced, true);
  assert.equal(r.fullyPaid, true);
  assert.equal(r.paidAtSet, false, "credit_paid_at failed (best-effort)");
  assert.match(r.syncWarning, /ครบชำระ|รีโหลด/, "warn about reload, not a hard error");
  assert.equal(f.calls.paidAtPatch, 1);
});

test("D2a — CAS fails after ledger insert, reconcile from ledger SUM succeeds → ok, synced via reconcile", async () => {
  // ledger SUM authoritative = 180 (e.g. concurrent payment already committed)
  const f = makeFetcher({ ledgerSum: 180, reconcilePatchOk: true });
  const casFail = async () => ({ ok: false, error: "CAS contention" });
  const r = await processCreditPayment(baseArgs({ fetcher: f.fn, atomicAdd: casFail }));
  assert.equal(r.ok, true);
  assert.equal(r.retrySafe, false, "ledger committed — no duplicate retry");
  assert.equal(r.paidSynced, true, "reconciled from ledger");
  assert.equal(r.newPaid, 180, "cache set to authoritative ledger SUM (no lost update)");
  assert.equal(r.syncWarning, null);
  assert.equal(f.calls.ledgerGet, 1);
  assert.equal(f.calls.reconcilePatch, 1);
});

test("D2b — CAS fails AND reconcile fails → ok (ledger committed) + non-retry warning", async () => {
  const f = makeFetcher({ ledgerSum: 180, reconcilePatchOk: false });
  const casFail = async () => ({ ok: false, error: "CAS contention" });
  const r = await processCreditPayment(baseArgs({ fetcher: f.fn, atomicAdd: casFail }));
  assert.equal(r.ok, true, "ledger committed → ok even when cache sync failed");
  assert.equal(r.retrySafe, false, "must NOT silently invite duplicate retry");
  assert.equal(r.paidSynced, false);
  assert.match(r.syncWarning, /ยังไม่ sync|กดซ้ำ/, "clear non-retry message");
});

test("D2c — cache sync throws after ledger insert → ok, non-retry warning (no throw out)", async () => {
  const f = makeFetcher();
  const casThrows = async () => { throw new Error("network down"); };
  const r = await processCreditPayment(baseArgs({ fetcher: f.fn, atomicAdd: casThrows }));
  assert.equal(r.ok, true);
  assert.equal(r.retrySafe, false);
  assert.equal(r.paidSynced, false);
  assert.match(r.syncWarning, /ยังไม่ sync|กดซ้ำ/);
});
