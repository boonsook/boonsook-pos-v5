# Incident Notes

## 2026-05-28 - POS auto_post_jv RLS denied for sales role

### Status

**Phase 92.46 SQL ready — awaiting user apply** (2026-05-28)

- **SQL migration:** [`supabase-phase92-46-je-rls-rerun-and-tighten.sql`](supabase-phase92-46-je-rls-rerun-and-tighten.sql) (rerun-safe)
  - Re-applies `je_insert_auto` + `jl_insert_auto` policies (defense vs. "policy was reverted/never applied" scenarios — likely root cause)
  - Tightens WITH CHECK with `source_table` whitelist (8 known values from `auto_post.js`)
  - Adds 3 diagnostic views (`vw_sales_without_journal`, `vw_expenses_without_journal`, `vw_payroll_without_journal`)
  - Adds RPC `accounting_integrity_summary()` admin-only — counts (groundwork สำหรับ Phase 92.47 dashboard)
- **Action required (user):**
  1. Supabase Dashboard → SQL Editor → paste `supabase-phase92-46-je-rls-rerun-and-tighten.sql` → Run
  2. ตรวจ VERIFY queries (a)-(d) ที่ท้ายไฟล์ — Expected: 9 policies / `je_insert_auto` WITH CHECK มี whitelist / 3 views / RPC EXECUTE authenticated
  3. **Automated smoke (recommended):** `npm run verify:accounting`
     - Requires `.env` (cp `.env.example` → `.env` + fill test account creds)
     - Tests: admin RPC works · sales create sale+journal · whitelist guard · non-whitelist reject · no-source reject · 3 views accessible · non-admin RPC reject
     - Output: matrix + `✅ ALL PASS` หรือ `❌ FAIL` per scenario
     - Cleanup: ลบ test rows ที่สร้าง (order_no/doc_no LIKE 'TEST-92-46-%')
  4. **Manual smoke (alternative):** Login **sales** role → POS sale ฿10 → ตรวจ console
     - **Expected:** ไม่มี `auto_post_jv deferred (RLS denied role)` แล้ว
     - **Expected:** หน้า "บัญชี → สมุดรายวัน" filter doc_type=SV ต้องเห็น journal ของ sale นั้น
  5. **Manual SQL verify:** Login admin → SQL Editor → `SELECT public.accounting_integrity_summary();` — ดู counts ทั้ง 3 ตาราง
     - ถ้า `sales_without_journal > 0` แสดงว่ามี orphan สะสมไว้ (backfill ต้องรอ Phase 92.47 dashboard หรือ admin login + re-trigger postJournalForSale ผ่าน UI เดิม)

### Why this fixes it

Console warning ใน auto_post.js line 268 มาจาก fallback branch ตอน HTTP 403/42501 — แปลว่า RLS deny non-admin INSERT บน `journal_entries`. SQL phase89-25 ออกแบบมาเพื่อปิดช่องนี้แล้ว (เพิ่ม `je_insert_auto` policy ที่อนุญาต non-admin ถ้ามี source_table+source_id) แต่ถ้า production ยังไม่ได้รัน SQL นั้น (หรือถูก revert) policy ยังเป็น `je_admin` เก่า (FOR ALL admin only) → non-admin INSERT ถูก deny → warning

Phase 92.46 SQL เป็น strict superset ของ phase89-25 (rerun-safe DROP+CREATE) + เพิ่ม whitelist กัน non-admin spam source_table ปลอม

### Out of Scope (Phase 92.46)

- ไม่แก้ accounting math / mapping logic ใน `auto_post.js`
- ไม่ refactor postJournalForSale ไปเป็น SECURITY DEFINER RPC (defer — current behavior ที่ใช้ RLS allow non-admin INSERT พอแล้ว ถ้า whitelist tight)
- Backfill UI → Phase 92.47 dashboard

---

### Original status (kept for history)

Open / follow-up needed. This is separate from Phase 92.45 Leave SQL/RLS hardening.

### Where Seen

- Page: POS / cashier home
- Role: sales
- Browser console
- Build context: after Phase 92.45, app build 315 / version 5.64.0

### Console Message

```text
[auto_post_jv deferred (RLS denied role) for sales#155 -- source saved OK; verify je_insert_auto policy (supabase-phase89-25-fix-je-rls-pos.sql)]
```

### Meaning

The sale itself appears to save successfully, but automatic journal posting for the sale is deferred because the sales role is denied by RLS when trying to create the journal entry.

This is not a Leave RLS issue. It likely belongs to the accounting auto-post / journal entry policy path.

### Risk

- Sales records may exist without matching journal entries.
- Accounting reports, trial balance, or daily journal may be incomplete until backfilled.
- Admin may need a backfill/retry path if the auto-post is intentionally non-blocking.

### Suggested Follow-Up

Phase candidate: Sales Auto-Journal RLS / Backfill Hardening

Check:

1. Confirm the expected writer for POS sale auto journals:
   - sales user directly
   - security definer RPC
   - service/admin-only backfill
2. Review `supabase-phase89-25-fix-je-rls-pos.sql` and current journal entry RLS policies.
3. Review `modules/accounting/auto_post.js` sale posting path.
4. Verify whether `postJournalForSale` uses the current user auth context or an RPC.
5. If sales should not insert journals directly, add a trusted RPC or queued backfill path.
6. Add smoke test:
   - login sales
   - create POS sale
   - verify sale saved
   - verify journal entry exists or a visible deferred/backfill record exists
   - verify audit/log message is actionable

### Out of Scope

- Leave approve/reject RLS
- Payroll journal PV flow
- Payroll delete/reverse flow
# 2026-05-29 - Phase 92.46b Auto-Journal REST 403 Remains Open

## Status

Not resolved yet.

Phase 92.45 leave RLS spoof hardening is verified closed. Phase 92.46b accounting auto-journal is still blocked at the REST/PostgREST smoke layer.

## Latest Failing Evidence

Latest `npm run verify:accounting`:

- A1 admin RPC `accounting_integrity_summary()`: PASS, HTTP 200
- A2 sales role creates sale + posts `journal_entries`: FAIL, JE HTTP 403
- A2 error: `42501`, `new row violates row-level security policy for table "journal_entries"`
- A2b summary unchanged: FAIL, orphan count drifted from 85 to 86
- A3 non-whitelist source table: PASS, HTTP 403
- A4 no source table as non-admin: PASS, HTTP 403
- A5 integrity views: PASS, HTTP 200
- A6 non-admin RPC negative: PASS, HTTP 403

## Important Positive Evidence

Direct SQL Editor simulation as sales/authenticated passed:

- `current_user = authenticated`
- sales test uid `b28a7260-1ece-4fdf-8248-2a32d01d2dbc`
- `public.is_accountant() = false`
- direct insert into `public.journal_entries` with `source_table='sales'` succeeded inside rollback test

This strongly suggests the DB policy/grant path is capable of passing. The remaining failure is likely REST/PostgREST cache, stale JWT, env/project mismatch, or REST layer state.

## Cleared During Diagnosis

- no restrictive policy on `journal_entries` or `journal_lines`
- `authenticated` INSERT grant exists
- `journal_entries` RLS is enabled
- `FORCE ROW LEVEL SECURITY` is false
- table owner is `postgres`
- `je_insert_auto` exists, targets `authenticated`, and includes `sales` in whitelist
- `is_accountant()` exists and is `SECURITY DEFINER`
- only journal_entries trigger found is expected `trg_check_period_locked`

## Next Required Action

Stop adding new SQL policy changes until REST/cache is checked.

1. Restart Supabase API/PostgREST from Dashboard.
2. Wait 1-2 minutes.
3. Run `npm run verify:accounting`.
4. If A2 becomes HTTP 201 and A2b stops drifting, close the incident after backfill.
5. If A2 remains HTTP 403, compare `.env` Supabase URL/project ref and JWT against the project where SQL was applied.

## Resolution Criteria

The incident is resolved only when:

- `npm run verify:accounting` passes A1-A6
- A2 sales REST auto-post returns HTTP 201
- A2b orphan count does not drift
- final `npm run backfill:orphans` is run
- `accounting_integrity_summary()` final counts are recorded
# 2026-05-29 - POS auto_post_jv RLS denied: REST path still open

Status: OPEN, narrowed. This incident is not resolved until `npm run verify:accounting` passes A1-A6.

Current evidence:
- Phase 92.45 leave RLS spoof verification is closed: automated spoof script PASS.
- Phase 92.46 DB-side policy path now passes direct simulation.
- Direct SQL test with sales JWT context used `SET LOCAL ROLE authenticated`.
- Direct SQL context returned `db_user=authenticated`, `is_acct=false`, and the expected sales `jwt_sub`.
- Direct SQL `INSERT INTO public.journal_entries` with `source_table='sales'` succeeded and was rolled back.

Still failing:
- `npm run verify:accounting` A2 still returns HTTP 403 from REST/PostgREST when sales auto-posts journal entries.
- A2b still fails because the sale is created but the journal entry is not created, so orphan count drifts.

Current interpretation:
- The DB policy/grant/predicate is likely correct for direct DB execution.
- The remaining fault is most likely REST/PostgREST cache, stale schema/policy cache, stale JWT/env/project mismatch, or another REST-layer mismatch.
- Do not reopen broad SQL policy rewrites without new evidence.

Next action:
1. Restart Supabase API/PostgREST or restart the project service from Supabase dashboard.
2. Wait 1-2 minutes.
3. Re-run `npm run verify:accounting`.
4. If A2 becomes HTTP 201 and A2b passes, run final orphan backfill and close this incident.
5. If A2 remains HTTP 403, capture REST request details and compare project URL/JWT/payload against the direct DB insert test.

Resolution criteria:
- A2 PASS: sales REST auto-post creates `journal_entries`.
- A2b PASS: orphan count does not increase.
- A1/A3/A4/A5/A6 remain PASS.
- Final `accounting_integrity_summary()` is captured.

# 2026-06-01 - RESOLVED - Phase 92.46c JE REST RLS fixed and verified

Status: CLOSED. All resolution criteria above are met.

## Root cause (confirmed empirical, not guessed)

`scripts/diag_je_rest.js` against live DB isolated it decisively:
- non-admin role IS `authenticated` (policy `TO authenticated` applies)
- ADMIN insert `return=representation`: 201, source cols persisted (schema cache NOT the issue)
- non-admin insert `return=minimal`: 201 (the INSERT itself always worked / `je_insert_auto` whitelist fine)
- non-admin insert `return=representation` and `return=headers-only`: 403

So the failure was never the INSERT — it was the SELECT-back. `return=representation`/`headers-only` make PostgREST SELECT the new row, and `je_select` was admin-only (`USING (is_accountant())`) → non-admin could not read its own just-inserted row → PostgREST reports `42501 new row violates row-level security policy`. The same admin-only `je_select` also blocked `jl_insert_auto`'s `EXISTS(SELECT FROM journal_entries)` subquery, so non-admin line inserts failed too.

## Fix

`supabase-phase92-46c-je-rls-final.sql` (applied in Supabase SQL Editor 2026-06-01) adds a PERMISSIVE SELECT policy `je_select_auto` for `authenticated`, scoped to auto-post source rows:
`source_table IN (sales, expenses, service_jobs, receipts, delivery_invoices, credit_payments, refunds)` — **`staff_payroll` intentionally excluded** (payroll amounts stay admin-only). Line detail stays admin-only (`jl_select` unchanged). Ends with `NOTIFY pgrst, 'reload schema'`. Additive only — does not touch `auto_post.js`, the insert whitelist, or period-close.

## Verification (2026-06-01, post-apply)

- `node scripts/diag_je_rest.js`: non-admin `return=representation` AND `return=headers-only` now **201** (was 403); `return=minimal` still 201.
- `npm run verify:accounting`: **ALL PASS A1-A6.** A2 sales REST auto-post = **201**. A2b orphan count **85 -> 85, no drift**. A3/A4 negatives still correctly 403 (whitelist guard intact).
- `npm run verify:je`: entry insert **201**, lines insert **201**, exit 0.

## Backfill — not run (no actionable rows)

`npm run backfill:orphans -- --dry-run` + reading `auto_post.js` confirms every remaining orphan is an intentional, non-actionable skip:
- ~84 April 2026 sales + 1 April expense → `auto_post.js:333` skips dates before `ACCOUNTING_EFFECTIVE_DATE=2026-05-01` (pre-effective test data).
- 1 May sale (`2026-05-08`, amount=0) → `auto_post.js:330` `!amountRaw` returns null (zero-amount sale legitimately has no JV).

Real May orphans (22 sales + 2 expenses) were already backfilled in a prior session. Final counts: `sales_without_journal=85`, `expenses_without_journal=1`, `payroll_without_journal=0` — all intentional. Live backfill would be a confirmed no-op (`0 posted`), so it was skipped.

## Confidentiality note

non-admin (sales/cashier) can now SELECT `journal_entries` **headers** for the whitelisted auto-post sources (not payroll, not line detail). Accepted trade-off — documented in the SQL header. If zero exposure is ever required, switch to a `SECURITY DEFINER` RPC post path instead.
