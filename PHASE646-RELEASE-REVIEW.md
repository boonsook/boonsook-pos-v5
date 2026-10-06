# Phase 646 release review — local candidate, NOT approved for production

Baseline: `99c0303` (build 641). Candidate client: build 642 / v5.69.109.
SQL: `supabase-phase646-credit-refund-approval.sql`.
Current SQL SHA-256: `c6eb13f3c9393419b5c421aebfe102b10c4cb7a65b6447b5e05c68870ae7e0d9`.
Recompute from the exact reviewed file before any approval or apply; any byte change
invalidates this pin. No SQL has been run on staging or production.

## Scope and owner policy

- Staff (admin/sales) can submit a credit/exchange refund request; admin
  approves before **any** refund row, stock return, JV, loyalty reversal or
  spendable credit. The admin then explicitly finalizes it in one PostgreSQL
  transaction.
- Full-sale amount comes from the server's sale net after discounts. No VAT is
  added. Recorded-VAT, partial/prior, ambiguous sale, missing original stock or
  JV evidence, bundle/legacy stock, and spent loyalty points are parked for
  manual review with no automatic credit. There is no manual-completion bypass.
- Cash/transfer refunds for other sales and POS use of existing credit are
  outside this change. A completed full-sale credit refund blocks any further
  refund or sale void on the same sale.
- Credit refunds may be paused during cutover. Accountant keeps ledger SELECT.
  No direct authenticated/service-role ledger writes remain. The existing B1
  redeem/release RPC definitions are not changed here.

## Evidence available now

- Production catalog only: `PHASE646-PRODUCTION-CATALOG-READONLY-20261006.md`.
  No business rows, RPC behavior or migration apply were read/tested live.
- Local PostgreSQL 17.6 isolated rehearsal a13 (including the repository's
  real Phase 92.61b legacy refund trigger): full-sale net 90 from gross
  100, exact stock/JV/loyalty/ledger, idempotent replay, accounting failure
  rolls all effects back, partial/VAT/ambiguous/spent-loyalty manual review,
  direct-write and method-alias denial, completed-sale second-refund denial
  on both `INSERT` and `UPDATE` even when the request is RLS-hidden,
  and a two-connection item-mutation lock test. Local server stopped.
  Its `input-hashes.json` records the exact SQL, legacy trigger, fixture,
  checks and runner bytes; all five hashes were compared with the current files.
- `npm run lint:errors`: 0 errors; `npm test`: 3902/3902; Playwright full
  browser suite: 436/436 on candidate build markers. These are local tests,
  not authenticated production smoke.
- Independent review found three blocking issues in the first SQL draft and
  an UPDATE bypass in the second. The current candidate closes all four;
  the reviewer found no remaining Blocking/Should-fix in the amended source.
  The exact-input a13 evidence is the local gate for this SHA.

## Proposed release sequence — do not execute without separate approval

1. Freeze the exact reviewed source commit and SQL SHA; verify a fresh
   production catalog/preflight on the same project and session-mode psql
   connection. Stop on drift. Confirm no overlapping schema/credit activity;
   pause only credit refunds, not ordinary non-credit sales.
2. Obtain the owner's separate approval of the **full** SQL SHA and impact.
   Apply once through the reviewed session-mode runbook, with `ON_ERROR_STOP`
   and a transaction. No auto-retry after uncertain outcome.
3. Read-only post-check table/RLS/grants/functions/triggers/schema reload and
   compare exact expected objects. Resolve any ambiguity before deploying.
4. Only after database post-check and separate merge/deploy decision, deploy
   build 642, verify CI/deploy and canonical live build marker. Refresh all
   devices; old builds' direct credit-refund writes are expected to fail closed.
5. Authenticated read-only UI smoke for sales request/admin queue on both
   desktop and mobile. A real financial end-to-end test would create a refund,
   stock/JV/loyalty/credit effects and needs a separately approved synthetic
   sale/test plan; do not mutate existing customer documents for smoke.

STOP: no push, PR, merge, deployment or production SQL under this review note.
