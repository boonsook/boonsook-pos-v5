# Phase 647 — POS auto-post balance trigger, local candidate only

Baseline: `origin/main` at `254f092` (build 642 / v5.69.109). No production
SQL, data repair, refund, backfill, push, PR, merge or deployment is authorized
by this file. Credit refunds remain paused.

## Incident and cause

The owner-approved synthetic cash sale `BSK-1791334360945` for 10 baht saved
successfully and stock fell from 2 to 1. Auto-post then failed for JV header
663 (`SV2026100009`): PostgREST returned SQLSTATE 23514 with
`JE 663 ผลรวม lines (0.00/0.00) <> header (10.00/10.00)`. The subsequent
header DELETE returned HTTP success but zero deleted rows. This is **not**
evidence that the sale failed; it is evidence of an accounting failure after
the sale. The source-side sale trace badge checks header existence only and
can show that header as “ลงบัญชีแล้ว” without confirming lines. Do not use that
badge as accounting proof and do not click Backfill.

Source path: `modules/pos.js` awaits `postJournalForSale`; `auto_post.js`
POSTs an approved header and then bulk lines in separate REST transactions.
`supabase-phase498-je-lines-balance.sql` installed an INVOKER deferred trigger
that sums `public.journal_lines`. The reviewed JE RLS gives non-accountant
staff INSERT on eligible lines but `jl_select` only to accountants. Thus the
trigger's SUM is RLS-filtered to zero for staff and raises 23514; the separate
`je_delete` policy also denies the attempted rollback. This is the causal
path demonstrated in an isolated PostgreSQL 17.6 reproduction. Fresh live
catalog and the exact incident row have **not** yet been independently read;
the migration must stop if those differ.

## Candidate

`supabase-phase647-je-balance-trigger-rls.sql` changes only the existing
function's execution mode to SECURITY DEFINER and pins its `search_path`.
Candidate file SHA-256: `9b7fb286b9d08f8d1479b2876e42996a966048d65c3566ca75727b6677effd0f`.
The function body MD5 pin is `cd812932adf24bc9887a432c084db477`: the raw `prosrc` read from
production by the read-only C2/C2-S run on 2026-11-20. It equals the reviewed
Phase 498 source body with SQL comments removed and CRLF line endings. The LF
source body (`77709a3f7271068a44cce7307f68dd14`) and any other body must STOP.
It requires owner `postgres`, exact reviewed function body MD5, enabled
deferred trigger, RLS on both tables and no FORCE RLS. It does not redefine
the function, change grants or RLS policies, touch business rows, change the
formula, or change the app build. As table owner, the trigger sees all lines;
staff still cannot SELECT the underlying rows. Unexpected catalog drift
causes a transaction error, not a partial apply.

The local `tests/phase647_je_balance_rls_rehearsal.sql` probe confirms:
staff 10/10 bulk lines fail with 0/0 before the change; pass after it;
10/9 remains blocked. This is a local fixture, **not** live Supabase proof.
Since the 2026-11-20 pin change the probe first rewrites the installed body to
the production shape (`$prodshape$`); that revised probe has **not** yet been
run on PostgreSQL.

## Gates before any production apply

1. Independent review of the exact candidate SHA and PostgreSQL fixture.
2. Owner-authorized fresh, read-only catalog run of
   `phase647-je-balance-preflight-readonly.sql`, plus the separately scoped
   `phase647-orphan-663-readonly.sql` for this synthetic sale. Verify target
   project, function body MD5, owner, trigger, policies, and JE/source/line
   totals. If any result differs, STOP and revise the candidate.
3. Separate owner approval for the **full migration SHA**, a short database
   change window, and a one-time apply. Do not re-run after an ambiguous
   connection outcome. Record command tags and read-only post-check.
4. The existing JV 663 is a separate data-repair decision. After checking it
   has no lines and belongs to the exact 10-baht synthetic sale, prepare an
   independently reviewed, idempotent one-sale repair. Do not delete the
   header or rerun broad Backfill from this candidate. A valid new-sale smoke
   requires a separately approved synthetic sale; do not use a real sale as a
   probe.
5. The misleading header-only badge and non-atomic two-request writer remain
   separate follow-up work. This narrow SQL fix prevents the reproduced
   staff RLS rejection but cannot guarantee cleanup for every future network
   or write failure. Do not call the entire accounting path closed until those
   risks have been reviewed.

6. After this change the trigger's RAISE still reports `v_dr/v_cr` (the real
   line totals) and the header totals to the inserting caller. Before the
   change a non-accountant caller only ever saw `0.00/0.00`. For an
   unbalanced insert the caller therefore learns the partial line totals of
   an entry it may insert into but cannot SELECT. This is a disclosure
   observation from source review, not a blocking defect; the owner accepts
   or rejects it explicitly before apply.

STOP: local candidate ready for independent review; production unchanged.
