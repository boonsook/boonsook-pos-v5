// Phase 514 — credit over-pay DB guard (audit S3)
// Run: node --test tests/credit_overpay_db_guard.test.js
//
// Two layers are asserted:
//   1. The owner-run SQL (supabase-phase514-credit-overpay-guard.sql) defines a BEFORE
//      INSERT OR UPDATE trigger on credit_payments that LOCKs the sales row, sums prior
//      payments (excluding NEW.id), and RAISEs when prior + NEW.amount > total + 0.01 —
//      with NO silent auto-clamp. This is the real last-line guard (client check at
//      credit_tracker.js:412 is UX only; race / direct REST / multi-device can bypass it).
//   2. processCreditPayment's failure contract: a DB reject lands on the insert-fail path
//      (HTTP non-ok) → { ok:false, ledgerInserted:false, retrySafe:true } and MUST NOT
//      sync credit_paid_amount (atomicAddToField never called) — no phantom AR.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { processCreditPayment } from "../modules/credit_tracker.js";

// ── Layer 1: SQL structure ──────────────────────────────────────────────────
const SQL = fs.readFileSync(path.resolve("supabase-phase514-credit-overpay-guard.sql"), "utf8");

test("SQL creates a trigger on public.credit_payments, BEFORE INSERT OR UPDATE", () => {
  assert.match(SQL, /CREATE TRIGGER trg_guard_credit_payment_overpay/, "named trigger");
  assert.match(SQL, /BEFORE INSERT OR UPDATE[\s\S]{0,40}ON public\.credit_payments/, "BEFORE INSERT OR UPDATE on credit_payments");
  assert.match(SQL, /EXECUTE FUNCTION public\._guard_credit_payment_overpay\(\)/, "wires the guard function");
});

test("guard function LOCKs the sales row with FOR UPDATE (serializes concurrent payments)", () => {
  assert.match(SQL, /FROM public\.sales[\s\S]{0,80}FOR UPDATE/, "sales row locked FOR UPDATE before summing");
});

test("guard sums prior credit_payments excluding NEW.id (correct on UPDATE)", () => {
  assert.match(SQL, /SUM\(cp\.amount\)/, "sums payments");
  assert.match(SQL, /cp\.sale_id = NEW\.sale_id/, "scoped to the sale");
  assert.match(SQL, /cp\.id IS DISTINCT FROM NEW\.id/, "excludes the current row");
});

test("guard rejects overpay beyond total + 0.01 tolerance", () => {
  assert.match(
    SQL,
    /v_prior_paid \+ NEW\.amount > COALESCE\(v_total, 0\) \+ 0\.01/,
    "reject condition: prior + new > total + 0.01"
  );
  assert.match(SQL, /RAISE EXCEPTION[\s\S]{0,120}exceeds outstanding balance/, "clear overpay error");
});

test("guard rejects non-positive amount and non-credit / missing sale", () => {
  assert.match(SQL, /NEW\.amount IS NULL OR NEW\.amount <= 0/, "amount must be > 0");
  assert.match(SQL, /v_is_credit IS NOT TRUE/, "non-credit sale rejected");
  assert.match(SQL, /NOT FOUND[\s\S]{0,80}missing sale/, "missing sale rejected");
});

test("guard does NOT auto-clamp / silently rewrite the amount", () => {
  assert.ok(!/NEW\.amount\s*:=/.test(SQL), "must not assign NEW.amount");
  assert.ok(!/LEAST\s*\(/.test(SQL), "must not LEAST()-clamp the amount");
});

test("guard is SECURITY DEFINER (authoritative SUM, not RLS-filtered) + reloads PostgREST", () => {
  assert.match(SQL, /SECURITY DEFINER/, "definer so SUM sees all payment rows");
  assert.match(SQL, /SET search_path = public/, "pinned search_path (definer safety)");
  assert.match(SQL, /NOTIFY pgrst, 'reload schema'/, "PostgREST cache reload");
});

test("SQL ships a read-only STEP0 inspect for legacy non-credit payments before apply", () => {
  assert.match(SQL, /STEP0/, "has inspect step");
  assert.match(SQL, /is_credit IS NOT TRUE/, "STEP0 surfaces credit_payments on non-credit sales");
});

// ── Layer 2: processCreditPayment failure contract on DB reject ──────────────
const silent = { warn() {} };

function makeFetcher({ insertOk = true } = {}) {
  const calls = { insert: 0 };
  const fn = async (url, opts = {}) => {
    const method = opts.method || "GET";
    if (url.includes("/credit_payments") && method === "POST") {
      calls.insert++;
      if (!insertOk) {
        // simulate the DB trigger rejecting the overpay (PostgREST surfaces 400 + message)
        return { ok: false, status: 400, text: async () => "credit payment exceeds outstanding balance (sale_id=1, total=500, already_paid=500, requested=50)" };
      }
      return { ok: true, json: async () => [{ id: 99, amount: JSON.parse(opts.body).amount }] };
    }
    return { ok: true, json: async () => [] };
  };
  return { fn, calls };
}

const baseArgs = (over = {}) => ({
  supabaseUrl: "https://x", anonKey: "k", accessToken: "t",
  sale: { id: 1, _paid: 500, _total: 500, customer_id: 7 },
  amount: 50, method: "cash", note: "",
  logger: silent,
  ...over,
});

test("DB overpay reject → ok:false, ledgerInserted:false, retrySafe:true", async () => {
  const f = makeFetcher({ insertOk: false });
  let casCalls = 0;
  const atomicAdd = async () => { casCalls++; return { ok: true, after: 999 }; };
  const r = await processCreditPayment(baseArgs({ fetcher: f.fn, atomicAdd }));
  assert.equal(r.ok, false);
  assert.equal(r.ledgerInserted, false);
  assert.equal(r.retrySafe, true);
  assert.equal(f.calls.insert, 1, "attempted the ledger insert exactly once");
  // ★ the critical invariant: a rejected ledger insert must NOT sync credit_paid_amount
  assert.equal(casCalls, 0, "atomicAddToField must NOT run when the ledger insert is rejected (no phantom AR)");
});

test("DB overpay reject surfaces a clear Thai overpay message (not raw HTTP dump)", async () => {
  const f = makeFetcher({ insertOk: false });
  const r = await processCreditPayment(baseArgs({ fetcher: f.fn, atomicAdd: async () => ({ ok: true, after: 0 }) }));
  assert.match(r.error, /เกินยอดค้าง/, "friendly overpay message");
  assert.ok(!/HTTP 400/.test(r.error), "should not dump the raw HTTP status for the overpay case");
});
