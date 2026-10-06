# Phase 646 release review — SQL applied, app release pending

Baseline: `99c0303` (build 641). Candidate client: build 642 / v5.69.109.
SQL: `supabase-phase646-credit-refund-approval.sql`.
Current SQL SHA-256: `d360562bdd408cbbbca1edbf54f2af1ad309e7c91cab970e59d11a8a4625a467`.
The reviewed SQL at this SHA was applied to production under separate owner
approval on 2026-10-06. Do not apply it again. At this review snapshot, the
app build 642 has not been pushed, merged or deployed; credit refunds remain
paused. A byte change to the SQL would be a new migration requiring separate
review and approval.
The prior approval of `c6eb13f3...70ae7e0d9` is invalid for this changed SQL.
The prior ID-order candidate `9a9b3766...5b79ea83ed8` is also invalid:
independent review and the a21 local counterexample proved a bypass. The
history-only candidate `1b2af060...c412d16` is invalid too: an independent
review and a25 local RED test proved staff could rewrite a redeem row. The
deduction-only candidate `6174c6af...dfa339c63` is invalid too: independent
review and a29 local RED test proved staff could relabel a sale earn row.
The current SHA makes loyalty history append-only. Its independent local
review, owner approval, fresh read-only preflight and one successful apply
are historical gates now; none authorizes a second apply or app deployment.

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
- Owner-approved conservative loyalty rule: **any** historical `redeem` row
  for the customer, including a redemption before this sale or a reversal
  from another sale, parks a full-sale credit refund for manual review before
  any refund/JV/credit. This applies even when the target sale earned no
  points. The ledger has no per-sale allocation and its IDs do not prove
  order. `manual_review` is visible to staff but has no automatic completion
  path in this release; an operator must resolve it separately.
- A completed credit refund rejects late POS earn rows for that sale. This
  prevents points arriving after reversal.
- All existing loyalty rows (including sale earn, redeem and `sale_reverse`)
  are immutable to UPDATE/DELETE via a row trigger; browser/service roles lose
  `TRUNCATE` on `loyalty_points`, which bypasses row triggers/RLS. The migration
  checks table owner/RLS before installing this protection. Normal staff
  INSERT earn and Phase 540 redeem RPC remain available. Any correction needs
  a separately reviewed compensating entry, not rewriting ledger history.

## Evidence available now

- Before apply, production catalog only:
  `PHASE646-PRODUCTION-CATALOG-READONLY-20261006.md`.
- After owner-approved apply, retained psql result shows one `BEGIN` through
  final `COMMIT` with empty stderr. The owner reported a production/session-mode
  connection; the retained command tags do not independently prove target or
  transport. The read-only post-check returned ten true categories and one
  false verifier predicate: PostgreSQL
  stored the empty `search_path` as `search_path=""`, while the predicate
  expected literal `search_path=`. A separate catalog-only query returned all
  ten functions with expected owner, security mode, empty search path and
  EXECUTE ACL. See `PHASE646-PRODUCTION-POSTCHECK-REVIEW.md` in task
  `019f81e8-22b9-77c3-a825-71f36306c482`'s
  `phase646-production-postcheck-diagnostic-20261006-v4` evidence directory.
  This is catalog evidence only: no live financial RPC, business-row read or
  authenticated app behavior was tested.
- Local PostgreSQL 17.6 isolated rehearsal a31 (including the repository's
  real Phase 92.61b legacy refund trigger and Phase 540 redemption RPC):
  full-sale net 90 from gross
  100, exact stock/JV/loyalty/ledger, idempotent replay, accounting failure
  rolls all effects back, partial/VAT/ambiguous/spent-loyalty manual review,
  direct-write and method-alias denial, completed-sale second-refund denial
  on both `INSERT` and `UPDATE` even when the request is RLS-hidden.
  Added a failing-before-fix counterexample: sale A earns 5, customer redeems
  3, sale B earns 3; balance returns to 5 but A remains manual with no side
  effects. A redemption and unrelated sale reversal before a later sale's earn
  also park that sale; a separate no-earn sale with the same customer's
  redemption history is parked. Authenticated staff cannot add, update, or
  delete earn rows for a completed source sale. Two-connection probes cover
  source-item mutation and simultaneous Phase 540 redeem/POS earn while a
  full-sale finalizer holds the loyalty locks. Staff cannot update/delete
  historical redemption, sale earn or sale reversal rows, or TRUNCATE their table; a
  normal Phase 540 staff redemption still succeeds. Local server stopped; see
  `phase646-pg-rehearsal-20261006-a31-final/STOP-CONFIRMED.txt` and
  `input-hashes.json` under the local evidence directory.
- **Red proof a21:** changing the original earn row's identity to exceed the
  later redemption row's identity made the ID-order candidate issue credit.
  The same regression passes in a31 with the conservative history gate. Both
  isolated servers stopped; a21 is not release evidence for the current SHA.
- **Red proof a25:** before the final trigger hardening, authenticated staff
  could rewrite a redeem row and hide it from the history guard. The same
  mutation and DELETE/TRUNCATE variants are denied in a31. Both local
  servers stopped; a25 is not release evidence for the current SHA.
- **Red proof a29:** before append-only hardening, authenticated staff could
  change `ref_type` on a target sale's earn row before finalization, hiding
  points that should be reversed. The same mutation and DELETE are denied in
  a31. Both local servers stopped; a29 is not release evidence for the
  current SHA.
- Final-source lint: 0 errors; unit: 3,904/3,904; focused Phase 646 browser
  spec: 4/4. Full browser e2e: 436/436 on the unchanged build-642 runtime
  while the local SQL correction was being finalized. Browser tests do not
  execute SQL or prove production privilege shape.
- Independent re-review of SQL SHA `d360562b...625a467` passed local-only:
  Blocking 0, Should-fix 0. The reviewer independently matched a31 hashes
  against all six current source files, verified a29 RED/a31 GREEN and ran
  the 15/15 SQL source guard. Local evidence is not production ACL/RLS proof
  and does not authorize a release.

## Remaining app release sequence — no SQL rerun

1. Amend release records to reflect the applied SQL and its limited catalog
   evidence, then independently review the exact new commit. Do not rerun SQL.
2. Push and open a PR for build 642; wait for lint, unit and browser CI on the
   final head. A green local run is not PR CI.
3. Seek a separate merge/deploy decision. After deployment, verify the
   canonical live build marker and refresh all devices; old builds' direct
   credit-refund writes are expected to fail closed.
4. Authenticated read-only UI smoke for sales request/admin queue on both
   desktop and mobile. A real financial end-to-end test would create a refund,
   stock/JV/loyalty/credit effects and needs a separately approved synthetic
   sale/test plan; do not mutate existing customer documents for smoke.

STOP: credit refunds stay paused; no merge, deployment, production SQL rerun or
financial smoke under this review note.
