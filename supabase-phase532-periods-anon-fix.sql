-- supabase-phase532-periods-anon-fix.sql
-- Phase 532 (BUG_AUDIT 2026-06-25 · B2) — close anon write-hole on accounting_periods
--
-- BUG (verified LIVE via pg_policy on 2026-06-27):
--   supabase-phase88-19-period-close.sql created accounting_periods RLS with
--     periods_select / periods_insert / periods_update  ->  TO authenticated, ANON
--     (WITH CHECK true). So anyone holding the public anon (publishable) key could
--     INSERT/UPDATE accounting periods over the REST API WITHOUT logging in — e.g.
--     flip a closed/locked period back to "open", then post or back-date a journal
--     entry into a period that accounting had closed (bypasses the section 4.3 period
--     lock — the lock trigger only blocks posts to a *locked* period; reopening it
--     via an anon write sidesteps the whole control).
--   deny_customer_accounting_periods (phase505, RESTRICTIVE) does NOT cover this:
--     it is TO authenticated only, so it never applies to the anon role.
--   No later migration removed the anon grant (phase445 only redefined is_accountant();
--     phase505 deny is authenticated-scoped; phase92-46 explicitly skipped this table).
--
-- FIX:
--   * Remove the anon role from every accounting_periods policy (anon then has no
--     permissive policy at all -> fully denied read+write).
--   * Gate WRITES (insert/update) to public.is_accountant() (= role IN
--     ('admin','accountant') — phase445) — the only roles whose ROLE_PAGES include
--     the "ปิดงวดบัญชี" (accounting_periods) page in main.js. modules/accounting/
--     periods.js is the sole writer; cashiers/sales/technicians never write periods.
--   * KEEP SELECT readable by ALL authenticated users — modules/accounting/auto_post.js
--     reads period status during checkout (running as the cashier) to honour the
--     period lock; restricting SELECT to is_accountant() would break checkout posting.
--   * DELETE intentionally keeps no permissive policy (periods are never deleted).
--
-- Idempotent: DROP POLICY IF EXISTS before each CREATE. RLS policy changes take
-- effect immediately — no `NOTIFY pgrst` needed (that is only for schema/column cache).
--
-- Applied to prod: 2026-06-27 (see DB_MIGRATIONS_APPLIED.md). Verified with the
-- pg_policy query at the bottom: every row roles = {authenticated}, writes use
-- is_accountant().

BEGIN;

-- SELECT: authenticated only (anon removed). auto_post checkout read still works.
DROP POLICY IF EXISTS "periods_select" ON public.accounting_periods;
CREATE POLICY "periods_select" ON public.accounting_periods
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: admin/accountant only (anon + authenticated-anyone removed).
DROP POLICY IF EXISTS "periods_insert" ON public.accounting_periods;
CREATE POLICY "periods_insert" ON public.accounting_periods
  FOR INSERT TO authenticated
  WITH CHECK (public.is_accountant());

-- UPDATE: admin/accountant only (closes the flip-locked-period-open hole).
DROP POLICY IF EXISTS "periods_update" ON public.accounting_periods;
CREATE POLICY "periods_update" ON public.accounting_periods
  FOR UPDATE TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());

COMMIT;

-- ── verify (expect: every row roles = {authenticated}; writes check is_accountant()) ──
-- SELECT polname, polcmd, polroles::regrole[] AS roles,
--        pg_get_expr(polqual, polrelid)      AS using_expr,
--        pg_get_expr(polwithcheck, polrelid) AS check_expr
-- FROM pg_policy WHERE polrelid='public.accounting_periods'::regclass ORDER BY polname;
