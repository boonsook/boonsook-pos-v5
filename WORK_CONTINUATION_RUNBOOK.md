# Superseded Session Note - Read This First

This runbook contains older historical context. For the current shared state between Codex and Claude sessions, read `SESSION_START_SHARED.md` first.

## Current Status as of 2026-06-01 (live)

- Live build: **316**, version **5.64.0**. Canonical smoke URL: `boonsook-pos-v5.pages.dev` (production custom domain: `boonsukair.com`).
- Phase 92.46c JE REST RLS: **RESOLVED** — SQL applied + verified (`diag_je_rest.js`, `verify:accounting` A1-A6, `verify:je` all PASS). Commit `cb6dbf0`. Root cause was the admin-only `je_select` SELECT-back policy blocking the post-insert representation, not the INSERT whitelist; fix added a permissive `je_select_auto` policy for non-admin auto-post source headers (excluding `staff_payroll`).
- Phase 92.47 expense export Bangkok-TZ fix: shipped (commit `a11bc9a`).
- PWA cache bump 315 -> 316 (delivers the expense fix to cached clients): shipped + deployed + live-verified (commit `d0d2b2f`). All build markers (`data-app-build`, `main.js?v=`, `sw.js` cache) = 316.
- Remaining accounting orphan counts (e.g. `sales_without_journal=85`) are intentional/non-actionable skips, not an open incident.

**Everything in the "Current Blocker - Phase 92.46b" and "Phase 92.46b Current State" sections below is RESOLVED HISTORY** (closed in 92.46c). Keep it for forensic reference only; it does not reflect live status.

# Boonsook POS V5 - Work Continuation Runbook

Last updated: 2026-05-29

## [RESOLVED 2026-06-01 in 92.46c] Phase 92.46b Accounting Auto-Journal REST 403 (historical)

Status: **RESOLVED** in Phase 92.46c (commit `cb6dbf0`) — `verify:accounting` A1-A6 PASS, `verify:je` PASS. The narrowing/forensic notes below are kept for history; they do not reflect live status. See the "Current Status" block at the top of this file.

Operator note, 2026-05-29:
- Stop asking the user for more broad SQL diagnostics. The decisive DB-side insert simulation already passed.
- Treat the remaining blocker as REST/PostgREST runtime behavior until a restart/retest proves otherwise.
- The next useful action is service restart + one `npm run verify:accounting` rerun, not another policy rewrite.

Latest known app state:
- Live app: v5.64.0 / build 315.
- Phase 92.45 leave RLS spoof hardening: verified PASS via automated spoof script.
- Phase 92.46 accounting integrity: still failing REST smoke.

What is proven:
- Direct DB simulation with `SET LOCAL ROLE authenticated` and sales JWT claims passes.
- Context was correct: `db_user=authenticated`, `is_acct=false`, `jwt_sub=b28a7260-1ece-4fdf-8248-2a32d01d2dbc`.
- Direct `INSERT INTO public.journal_entries (...) source_table='sales'` succeeded inside a rolled-back transaction.
- Therefore the current DB policy/grant/predicate path appears valid for direct database execution.
- The temporary diagnostic output was:
  - `1_context | OK | db_user=authenticated, is_acct=false, jwt_sub=b28a7260-...`
  - `2_insert | PASS | INSERT succeeded under sales/authenticated context`

What still fails:
- `npm run verify:accounting`
- A2: sales role creates sale, but REST `POST /journal_entries` returns HTTP 403 with code `42501`, message `new row violates row-level security policy for table "journal_entries"`.
- A2b: orphan count drifts because sale is created but journal entry is not created.
- `NOTIFY pgrst, 'reload schema';` was run successfully, but the REST smoke result did not change.

Cleared as unlikely root cause:
- Missing `je_insert_auto` policy.
- Wrong target role on `je_insert_auto`.
- Missing table-level INSERT grant for `authenticated`.
- Restrictive policy shadowing.
- FORCE RLS / wrong table owner.
- Hidden trigger on `journal_entries`.
- Hidden `created_by` / `auth.uid()` / `user_id` owner-check clause in `je_insert_auto`.
- `is_accountant()` throwing in no-JWT SQL Editor context.

Do not do:
- Do not disable RLS.
- Do not change `WITH CHECK` to `true`.
- Do not remove the source-table whitelist.
- Do not keep rewriting the same policy without new evidence.
- Do not touch `auto_post.js` until REST/cache/env mismatch has been ruled out.

Next operator steps:
1. Restart Supabase API/PostgREST for the project, or use the Supabase dashboard API restart if available. If API restart is not visible, use the closest Supabase service/database restart option available in the dashboard.
2. Wait 1-2 minutes.
3. Run `npm run verify:accounting`.
4. If A2 changes to HTTP 201 and A2b PASS, run the final orphan backfill and update the incident as resolved.
5. If A2 still returns HTTP 403 after restart, do one targeted engineering action only:
   - compare `.env` Supabase URL/project ref and refreshed JWT against the project where SQL was applied; then
   - if the project/token match, ship an additive `je_insert_auto_v2` policy or exact force drop/create of `je_insert_auto`, then rerun `npm run verify:accounting`.
6. Do not request more user-pasted SQL unless the restart + targeted action still leaves A2 at HTTP 403.

Evidence to preserve in final report:
- Direct DB insert result: `2_insert PASS - INSERT succeeded under sales/authenticated context`.
- Latest failing REST smoke: A2 HTTP 403 / A2b orphan drift.
- `accounting_integrity_summary()` still HTTP 200.
- A3/A4 negative tests still HTTP 403 PASS.

Last updated: 2026-05-28

This file is for any agent/team member who opens a fresh session and needs to continue the current HR/Payroll/Accounting hardening work without relying on chat history.

## Current Production Context

- Latest known app build: 316 (bumped from 315 in commit `d0d2b2f`, deployed + live-verified 2026-06-01)
- Latest known version: 5.64.0
- Latest completed work: Phase 92.46c JE REST RLS (RESOLVED + verified) and Phase 92.47 expense export Bangkok-TZ fix (shipped)
- Canonical smoke URL: `https://boonsook-pos-v5.pages.dev/` (production custom domain: `https://boonsukair.com/`)
- Supabase project URL seen in tests: `https://rwmmjljelpcpwohwiplu.supabase.co`

## Important Completed Work

### Phase 92.43 - Payroll / Accounting Audit Hardening

Status: shipped and manually smoke-tested.

Confirmed behavior:

- Payroll `total_amount` is persisted and not left null.
- Payroll paid date uses Bangkok date behavior.
- Payroll pay has audit log.
- Payroll delete has audit log.

### Phase 92.44 - Payroll Payment Journal Visibility

Status: shipped and manually smoke-tested.

Confirmed behavior:

- Payroll pay creates visible accounting journal row using doc type `PV` (payment/outgoing).
- Payroll journal row uses `source_table="staff_payroll"` and `source_id=payroll.id`.
- Re-paying same payroll is idempotent.
- Deleting paid payroll reverses/removes linked journal.
- After deleting payroll, payroll KPI/report and expense summary return to zero and no orphan journal is visible.

### Phase 92.45 - Leave SQL/RLS Hardening + Audit Enforcement

Status: deployed and mostly verified. Final spoof script verification is still pending.

Verified:

- SQL migration was run in Supabase.
- RLS policies on `staff_leaves` are present:
  - `leaves_delete_admin`
  - `leaves_insert_admin_or_self_pending`
  - `leaves_select_admin_or_self`
  - `leaves_update_admin_or_self_pending`
- Triggers on `staff_leaves` are present:
  - `trg_staff_leaves_guard_insert`
  - `trg_staff_leaves_guard_update`
  - `trg_staff_leaves_updated_at`
- Functions exist:
  - `_guard_staff_leaves_insert`
  - `_guard_staff_leaves_update`
  - `review_staff_leave`
- `review_staff_leave` grants were corrected:
  - `authenticated`: EXECUTE
  - `postgres`: EXECUTE
  - `service_role`: EXECUTE
  - no `anon`
  - no `PUBLIC`
- Admin approve flow works from UI.
- Non-admin UI shows only own leave records and does not show approve/reject.
- Audit log shows `leave_create` and `leave_approve`.

Still pending:

- Final automated non-admin spoof verification using real non-admin and admin Supabase Auth credentials.

## Immediate Next Step: Phase 92.45b Final Leave Spoof Verification

Goal: prove S3 reviewed_by/reviewed_at spoofing is closed 100%.

Use the script approach. Do not ask the user to paste browser console fetch code.

### Required Environment Variables

Create `.env` locally from `.env.example` if needed. Do not commit secrets.

```env
SUPABASE_URL=https://rwmmjljelpcpwohwiplu.supabase.co
SUPABASE_ANON_KEY=<real anon key>
NONADMIN_EMAIL=<non-admin test email>
NONADMIN_PASSWORD=<non-admin password>
ADMIN_EMAIL=<admin test email>
ADMIN_PASSWORD=<admin password>
```

Required test accounts:

- Non-admin profile role must be one of `sales`, `technician`, or `staff`.
- Admin profile role must be `admin`.

### Command

```bash
node scripts/leave_spoof_test.js
```

If the script does not exist yet, create it as a local/test utility. It must sign in with Supabase Auth and use real JWTs.

### Required Scenarios

T1 non-admin INSERT spoof:

- POST `staff_leaves` as non-admin.
- Payload attempts to set `status="approved"`, `reviewed_by`, `reviewed_at`, and `review_note`.
- PASS if request is rejected, or inserted row is sanitized to:
  - `status = pending`
  - `reviewed_by = null`
  - `reviewed_at = null`
  - `review_note = null`

T2 non-admin UPDATE pending to approved spoof:

- PATCH own pending leave as non-admin.
- Attempt to set `status="approved"` plus reviewer fields.
- PASS if HTTP is 4xx and DB row is unchanged.

T2b non-admin UPDATE pending to cancelled plus spoof reviewer:

- PATCH own pending leave as non-admin.
- Set `status="cancelled"` plus reviewer fields.
- PASS if cancelled is allowed but reviewer fields remain null/unchanged.

T3 admin RPC approved:

- Call `review_staff_leave` as admin.
- PASS if HTTP 200, row becomes approved, `reviewed_by = admin auth.uid()`, `reviewed_at` is server time, and audit log has `leave_approve`.

T3b non-admin RPC negative:

- Call `review_staff_leave` as non-admin.
- PASS if HTTP 4xx with admin-only / SQLSTATE 42501 style error.

### Expected Final Matrix

```text
T1 INSERT spoof              PASS
T2 UPDATE -> approved        PASS
T2b UPDATE -> cancelled      PASS
T3 admin RPC approved        PASS
T3b non-admin RPC            PASS

ALL PASS - S3 reviewed_by/reviewed_at spoof CLOSED 100%
```

If any scenario fails, stop and report the exact scenario, HTTP status, DB row, and probable SQL/RLS/function root cause.

## Known Open Incident: Sales Auto-Journal RLS Denied

Detailed note: `INCIDENT_NOTES.md`

Observed console warning:

```text
[auto_post_jv deferred (RLS denied role) for sales#155 -- source saved OK; verify je_insert_auto policy (supabase-phase89-25-fix-je-rls-pos.sql)]
```

Meaning:

- POS sale appears to save.
- Auto journal posting is deferred because sales role is denied by RLS.
- This is separate from Leave RLS.

Risk:

- Sale records may exist without matching journal entries.
- Accounting reports may be incomplete unless backfilled.

## Next Phase: Phase 92.46 - Sales Auto-Journal RLS / Backfill Hardening

Start this after Phase 92.45b spoof verification is completed or clearly reported.

Goal:

- A sale created by sales role must either create its journal entry successfully or produce a visible/admin-actionable deferred/backfill record.

Files/areas to inspect:

- `modules/accounting/auto_post.js`
- `supabase-phase89-25-fix-je-rls-pos.sql`
- journal entry RLS policies
- POS sale save flow and its auto-post call site

Recommended approach:

- Prefer a security-definer RPC or trusted backfill path over letting sales insert arbitrary journal rows.
- Keep journal posting idempotent by `source_table` + `source_id`.
- If auto-post fails, record a visible deferred state; console-only warning is not enough for production.

Required tests:

- Login sales.
- Create POS sale.
- Sale saves.
- Journal entry exists.
- No `auto_post_jv deferred (RLS denied role)` warning.
- Repeat/backfill does not create duplicate journal.
- Non-admin cannot create arbitrary journal for another sale.
- Payroll PV journal flow from Phase 92.44 still works.

Deliverables:

- Root cause.
- SQL/RLS/RPC changes.
- Files changed.
- Gates.
- Live build/version if deployed.
- Manual smoke result.
- Update `INCIDENT_NOTES.md` with resolved/remaining status.

## Later Phase: Phase 92.47 - Accounting Integrity Dashboard / Reconciliation

Goal:

- Admin can see records that should have journal entries but do not.

Suggested checks:

- sales without journal
- expenses without journal
- paid payroll without PV/JV
- deleted/reversed payroll with orphan journal
- service jobs without journal if that flow is enabled

Admin UI should show:

- count by category
- recent missing records
- safe retry/backfill action
- clear success/fail report

## Later Phase: Phase 92.48 - Month Close Checklist

Goal:

- Admin has a clear pre-close checklist before period close.

Checklist groups:

- Payroll paid/unpaid counts
- payroll `total_amount` not null
- payroll journal linked
- pending leave count
- over-quota/unpaid leave impact
- sales without journal
- expenses without journal
- orphan PV/JV count
- audit log coverage for payroll and leave actions

UX:

- Admin-only
- Dense operational screen
- green = ready
- amber = needs review
- red = blocker

## General Operating Rules

- Do not ask the user to run browser console security tests.
- If credentials are needed, use local `.env`; never commit secrets.
- Do not make destructive DB changes unless SQL is rerun-safe.
- Do not broaden scope while fixing accounting/RLS flows.
- Preserve existing Thai UI wording unless the task requires copy changes.
- Do not change payroll math unless the task explicitly touches payroll math.
- Every phase report must include:
  - phase/build/version
  - files changed
  - root cause
  - gates
  - manual smoke steps
  - regression notes
  - remaining risks

## Final Report Template

```text
Phase:
Build/version:
Commit:

Gates:
- lint:
- unit:
- e2e:
- audit:
- deploy:
- live verify:

Changed:
- ...

Verified:
- ...

Regression:
- ...

Remaining risks:
- ...

User manual test needed:
- ...
```
# Phase 92.46b Current State - Auto-Journal REST 403

Last updated: 2026-05-29 — **SUPERSEDED: RESOLVED in Phase 92.46c on 2026-06-01 (commit `cb6dbf0`). Kept as forensic history; see the "Current Status" block at the top of this file.**

## Short Verdict

Phase 92.46b is **not closed yet**. *(historical snapshot — it WAS subsequently closed in 92.46c.)*

The database-side RLS predicate now passes when simulated directly in Supabase SQL Editor, but the automated REST smoke still fails on `journal_entries` insert from the sales role.

Current interpretation:

- DB direct test: PASS
- REST/PostgREST smoke: FAIL
- Most likely remaining area: PostgREST/API schema cache, stale JWT/env/project mismatch, or REST layer not seeing the same DB state
- Do not keep rewriting `je_insert_auto` unless the direct SQL Editor insert starts failing again

## Latest Evidence

`npm run verify:security`

- Phase 92.45 leave RLS spoof verification: ALL PASS
- S3 reviewed_by/reviewed_at spoof closed 100%

`npm run verify:accounting`

- A1 `accounting_integrity_summary()` admin RPC: PASS, HTTP 200
- A2 sales POST sale + auto-post `journal_entries`: FAIL, JE HTTP 403
- A2 error body: `42501`, `new row violates row-level security policy for table "journal_entries"`
- A2b orphan summary unchanged: FAIL, `sales_without_journal` drifted from 85 to 86
- A3 non-whitelisted source table: PASS, HTTP 403
- A4 no source table as non-admin: PASS, HTTP 403
- A5 integrity views: PASS, HTTP 200
- A6 non-admin RPC negative: PASS, HTTP 403

Direct SQL Editor simulation already passed:

- `SET LOCAL ROLE authenticated`
- `request.jwt.claims.sub = b28a7260-1ece-4fdf-8248-2a32d01d2dbc`
- `public.is_accountant() = false`
- Direct insert into `public.journal_entries` with `source_table='sales'`, `source_id=999999`, `doc_type='SV'`, balanced debit/credit, status `approved`: PASS

This means the active DB policy path can allow the sales/authenticated context. The failing path is currently REST/PostgREST smoke.

## Cleared Root Causes

- No restrictive policy on `journal_entries` / `journal_lines`
- Total policies are 8: 4 on `journal_entries`, 4 on `journal_lines`
- `authenticated` has INSERT grants on both tables
- `journal_entries` RLS enabled
- `FORCE ROW LEVEL SECURITY` is false
- table owner is `postgres`
- `je_insert_auto` exists and targets `authenticated`
- `je_insert_auto` WITH CHECK contains whitelist including `sales`
- `is_accountant()` exists, is `SECURITY DEFINER`, and returns false for the sales test context
- Only trigger found on `journal_entries` is expected `trg_check_period_locked`
- Column-level grants exist for required insert columns

## Next Action

Do these in order:

1. Restart Supabase API/PostgREST.
   - Dashboard path varies by plan, try Project Settings -> API -> Restart server/project.
   - If not available, use Settings -> Infrastructure -> Restart database.
   - Wait 1-2 minutes after restart.
2. Run:

```bash
npm run verify:accounting
```

3. Expected result:
   - A2 must become HTTP 201 PASS.
   - A2b must stop drifting.

4. If A2 is still HTTP 403:
   - Check `.env` points to the same Supabase project where SQL was applied.
   - Refresh non-admin JWT by signing in again or recreating `.env` credentials.
   - Run `node scripts/diag_je_rls.js` and compare REST project/role behavior.
   - Investigate PostgREST cache/project mismatch before rewriting SQL.

## Do Not Repeat

- Do not disable RLS.
- Do not replace the policy with `USING (true)` or broad open checks.
- Do not remove the whitelist from `je_insert_auto`.
- Do not keep creating diagnostic SQL variants unless REST/env/cache has been ruled out.
- Do not mark Phase 92.46b closed until `npm run verify:accounting` passes A1-A6.

## Definition of Done

- `npm run verify:security` remains ALL PASS.
- `npm run verify:accounting` passes A1-A6.
- A2 sales auto-post creates JE with HTTP 201.
- A2b summary does not increase orphan count.
- Run final `npm run backfill:orphans`.
- Run `SELECT public.accounting_integrity_summary();` and record final counts.
- Update `INCIDENT_NOTES.md`, `HANDOFF.md`, and `CHANGELOG.md`.
- Mark `2026-05-28 POS auto_post_jv RLS denied` as resolved only after REST smoke passes.

# 2026-05-30 Continuation Review - journal_lines (Bug 2) gap

Added by continuation review. Additive only. No SQL applied. The restart-first / no-new-SQL directive above still stands. This section closes a verification blind spot, it does not change the next action (restart, then `npm run verify:accounting`).

## Blind spot: verify:accounting never tests journal_lines

- `scripts/accounting_integrity_smoke.js` A2 does: POST `sales`, then POST `journal_entries`. It never POSTs `journal_lines`.
- So the current Definition of Done (A2 -> HTTP 201) can pass while the REAL `auto_post.js` flow (entry THEN lines) still fails at the lines insert.
- Net effect: the restart could make A1-A6 green and we could declare the incident closed, while real sales-role auto-post still breaks on lines.

## Why lines will fail for non-admin even after the entry insert is fixed (Bug 2)

- `jl_insert_auto` WITH CHECK validates the parent via `EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = entry_id AND je.source_table IN (...))` (see `supabase-phase89-25-fix-je-rls-pos.sql` and `supabase-phase92-46-je-rls-rerun-and-tighten.sql`).
- That subquery on `journal_entries` is itself filtered by the `je_select` policy = `USING (public.is_accountant())` (admin only).
- For a non-admin, `je_select` returns zero rows, so the EXISTS is always false -> `journal_lines` INSERT -> 42501, even for the parent row it just inserted.
- This has existed since phase89-25. It was never observed because Bug 1 (entry 403) blocks earlier. Once REST entry insert works, this is the next failure.
- Worse: `auto_post.js` then tries to roll back the orphan entry via DELETE, but `je_delete` is also admin only -> rollback fails -> orphan JE header with no lines (unbalanced trial balance).

## Env / project check (rules out part of the project-mismatch hypothesis from the repo side)

- `.env` SUPABASE_URL = `rwmmjljelpcpwohwiplu.supabase.co` == `supabase-config.js` url (live app). Same project.
- REST signin + admin REST insert both succeed -> `.env` anon key is valid for that project.
- Still unverifiable from the repo: confirm the Supabase SQL Editor where the direct insert PASSED is the same project ref `rwmmjljelpcpwohwiplu` (the only remaining mismatch surface).

## Ready tools (NOT applied - respect restart-first / no-new-SQL directive)

- `scripts/verify_je_fix.js` (`npm run verify:je`): posts entry THEN 2 balanced lines as non-admin via REST. Run this (or do a real sales-role POS sale and confirm the SV journal has balanced lines) AFTER the restart, to cover the lines path verify:accounting misses.
- `supabase-phase92-46c-je-rls-final.sql`: ON HOLD. Targeted Bug 2 fix only - adds SECURITY DEFINER helper `public._je_is_auto_source(entry_id)` so `jl_insert_auto` no longer depends on `je_select` visibility. Apply ONLY if, after the restart fixes the entry insert, the lines insert is shown to fail (that is the new evidence the directive requires). Do NOT apply it for Bug 1 - the DB entry policy is already proven correct.

## Definition of Done - additional item

- A real non-admin auto-post creates BOTH the `journal_entries` row AND its `journal_lines` (balanced), verified via `npm run verify:je` or a real POS sale - not just A2 entry HTTP 201.
