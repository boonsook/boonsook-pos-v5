// Phase 517a — customer-credit-2180 ledger foundation (build 517)
// Run: node --test tests/customer_credit_2180_use_guard.test.js
//
// Why this exists:
//   Phase 512 posts Cr 2180 (liability) on credit/exchange refunds, but there was
//   no per-customer source-of-truth for "เครดิตคงเหลือ". 517a adds:
//     - table customer_credit_ledger (+ add credit / - use credit)
//     - RPC redeem_customer_credit (atomic, rejects over-use, idempotent)
//     - refunds.js writes +amount on credit/exchange refunds (idempotent, best-effort)
//   517a does NOT touch POS checkout / postJournalForSale / credit_payments — using
//   credit on a new sale (Dr 2180 split) is deferred to 517b after checkout rollback
//   is made safe. These guards lock the foundation invariants.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const refunds = fs.readFileSync(path.resolve("modules/refunds.js"), "utf8");
const sql = fs.readFileSync(path.resolve("supabase-phase517a-customer-credit-ledger.sql"), "utf8");

// Extract the doCheckout/save handler region where the ledger write lives,
// so assertions target the new block, not the whole file.
function regionAround(src, anchor = "_credLedgerKey =", before = 80, after = 2200) {
  const i = src.indexOf(anchor);
  assert.ok(i >= 0, `anchor not found: ${anchor}`);
  return src.slice(Math.max(0, i - before), i + after);
}

// ── refunds.js wiring ─────────────────────────────────────────────────────────
test("refunds.js writes +amount credit ledger for credit/exchange via canonical classifier", () => {
  assert.match(refunds, /refundMappingKeyForMethod/, "must reuse refundMappingKeyForMethod (single source of truth for credit/exchange)");
  const block = regionAround(refunds);
  // classified as refund_credit or refund_exchange only
  assert.match(block, /refund_credit"\s*\|\|\s*_credLedgerKey === "refund_exchange"|refund_credit".*refund_exchange"/s,
    "ledger write must be gated to refund_credit/refund_exchange only");
  // POST to the ledger table, positive amount
  assert.match(block, /customer_credit_ledger/, "must POST to customer_credit_ledger");
  assert.match(block, /amount:\s*round2\(/, "amount must be round2() of the refund total");
  assert.match(block, /source_id:\s*insertedRefund\.id/, "source_id must be the refund id (idempotency anchor)");
});

test("refunds.js does NOT create floating credit when customer_id is missing", () => {
  const block = regionAround(refunds);
  assert.match(block, /if\s*\(\s*!insertedRefund\.customer_id\s*\)/, "must branch on missing customer_id");
  // the no-customer branch must warn and NOT POST a ledger row
  const noCust = block.slice(block.indexOf("!insertedRefund.customer_id"));
  const elseIdx = noCust.indexOf("} else {");
  const noCustBranch = elseIdx > 0 ? noCust.slice(0, elseIdx) : noCust;
  assert.ok(!/method:\s*"POST"/.test(noCustBranch), "must not POST a ledger row without a customer_id");
});

test("refunds.js credit-ledger path does NOT touch credit_payments (that's 1200 AR, not 2180)", () => {
  const block = regionAround(refunds);
  // the real invariant: no AR (credit_payments) write — using 2180 credit is not a debtor payment.
  // (a comment may mention the word; we assert there is no actual credit_payments operation)
  assert.ok(!/rest\/v1\/credit_payments|processCreditPayment\s*\(/.test(block), "ledger write must not insert/post credit_payments");
});

test("refunds.js still posts the refund JV (Phase 512 not removed)", () => {
  assert.match(refunds, /postJournalForRefund\(/, "must still call postJournalForRefund (JV Cr 2180 intact)");
});

test("refunds.js ledger write is best-effort (idempotent 409 ok, never throws to roll back the refund)", () => {
  const block = regionAround(refunds);
  assert.match(block, /led\.status\s*!==\s*409/, "409 (duplicate) must be treated as success (idempotent)");
  assert.match(block, /try\s*\{/, "ledger write must be wrapped so failure cannot roll back the committed refund");
});

// ── SQL: table + idempotency ──────────────────────────────────────────────────
test("SQL creates customer_credit_ledger with bigint customer_id FK", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.customer_credit_ledger/, "table create present");
  assert.match(sql, /customer_id\s+bigint\s+NOT NULL\s+REFERENCES public\.customers\(id\)/i, "customer_id must be bigint FK to customers(id)");
});

test("SQL has unique idempotency guards (source_id and source_key)", () => {
  assert.match(sql, /CREATE UNIQUE INDEX[^;]*uq_ccl_source\b[^;]*\(source_type,\s*source_id\)/s, "unique on (source_type, source_id)");
  assert.match(sql, /CREATE UNIQUE INDEX[^;]*uq_ccl_source_key[^;]*\(source_type,\s*source_key\)/s, "unique on (source_type, source_key)");
});

// ── SQL: redeem RPC (the over-use / concurrency guard) ────────────────────────
test("SQL redeem_customer_credit RPC enforces atomic over-use protection", () => {
  const fn = sql.slice(sql.indexOf("FUNCTION public.redeem_customer_credit"));
  assert.ok(fn.length > 0, "RPC must exist");
  assert.match(fn, /SECURITY DEFINER/, "must be SECURITY DEFINER (SUM authoritative, bypass RLS)");
  assert.match(fn, /pg_advisory_xact_lock/, "must serialize concurrent redeems per customer (advisory lock)");
  assert.match(fn, /v_balance\s*<\s*p_amount\s*-\s*0\.01/, "must reject when balance < amount (over-use guard)");
  assert.match(fn, /ERRCODE\s*=\s*'23514'/, "over-use / invalid args must raise SQLSTATE 23514");
  assert.match(fn, /amount must be > 0|p_amount <= 0/, "must reject amount <= 0");
  assert.match(fn, /source_type = 'sale_credit_use' AND source_key = p_source_key/, "must be idempotent on source_key (replay-safe)");
  assert.match(fn, /-p_amount/, "must insert a NEGATIVE amount (use credit)");
});

// ── SQL: RLS (client cannot insert negative sale_credit_use directly) ─────────
test("SQL RLS forbids client-side negative/sale_credit_use inserts; customer OTP denied", () => {
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/, "RLS enabled");
  // staff WITH CHECK only allows +amount refund rows (or admin) — no direct negative ledger
  assert.match(sql, /WITH CHECK\s*\(\s*public\.is_admin\(\)\s*OR\s*\(amount > 0 AND source_type IN \('refund_credit', 'refund_exchange'\)\)/s,
    "staff insert restricted to +amount refund rows (sale_credit_use must go through RPC)");
  assert.match(sql, /AS RESTRICTIVE FOR ALL TO authenticated[^;]*is_customer_role/s, "customer OTP role must be denied (RESTRICTIVE)");
});

// ── SQL: backfill only binds credit to a real customer ───────────────────────
test("SQL backfill only credits refunds that have a customer_id", () => {
  const bf = sql.slice(sql.indexOf("INSERT INTO public.customer_credit_ledger (customer_id, source_type, source_id, amount, note, created_at)"));
  assert.ok(bf.length > 0, "backfill insert present");
  assert.match(bf, /r\.customer_id IS NOT NULL/, "backfill must skip refunds without customer_id");
  assert.match(bf, /ON CONFLICT \(source_type, source_id\)[^;]*DO NOTHING/s, "backfill must be idempotent");
});

test("SQL reloads PostgREST schema cache", () => {
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/, "must NOTIFY pgrst after DDL");
});
