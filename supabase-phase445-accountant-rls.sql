-- ═══════════════════════════════════════════════════════════════════════
-- Phase 445 — enable the "accountant" role at the DB layer
-- ═══════════════════════════════════════════════════════════════════════
-- Build 444 added the "accountant" role CLIENT-SIDE only (ROLE_PAGES + the
-- user role dropdown). Two DB gaps blocked it from actually working:
--
--   (1) profiles_role_check CHECK constraint did NOT allow 'accountant'
--       → changeRole() PATCH was rejected → "เปลี่ยนไม่สำเร็จ", role stayed.
--   (2) is_accountant() (supabase-phase88-accounting-foundation.sql) gated
--       'admin' only → accountant's accounting pages (journal_entries,
--       journal_lines, chart_of_accounts, account_mapping, accounting_periods —
--       all RLS USING/WITH CHECK is_accountant()) were blocked/empty.
--       The phase88 comment already anticipated this: "อนาคตอาจเพิ่ม role accountant".
--
-- Operational tables (service_jobs, expenses, receipts, sales, quotations,
-- delivery_invoices, customers, products) use `TO authenticated USING(true)`
-- (supabase-rls-policies.sql) → accountant already has access, no change needed
-- (so GET /api/v1/reports/daily-summary reads service_jobs fine — no 502).
--
-- Run once in Supabase SQL Editor. ✅ APPLIED on prod 2026-06-14 (owner ran;
-- smoked as boonsuk admin1 = accountant: journal_entries 77 / journal_lines 189 /
-- chart_of_accounts 67 / accounting_periods 1 all readable; nav shows accounting/
-- finance/document pages only — no POS/settings/stock-ops/HR).
-- NOTE: period-lock trigger + balance triggers still apply to ALL roles
-- (accountant cannot post into a closed period).
-- ═══════════════════════════════════════════════════════════════════════

-- ── (0) sanity: every role currently in use must be in the (1) list ──────────
--   SELECT DISTINCT role FROM public.profiles ORDER BY role;
--   (expected: admin / technician / sales / customer — add any extra to the ARRAY)

-- ── (1) allow profiles.role = 'accountant' (was admin/technician/sales/customer) ──
--   wrapped in a tx so a failed ADD rolls back rather than leaving no constraint
BEGIN;
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['admin','technician','sales','customer','accountant']::text[]));
COMMIT;

-- ── (2) is_accountant() recognises the 'accountant' role (was 'admin' only) ──
--   identical signature to phase88 — only the role list changes; unblocks all
--   accounting-table RLS (journal_entries/journal_lines/chart_of_accounts/
--   account_mapping/accounting_periods) for both read (USING) and write (WITH CHECK).
CREATE OR REPLACE FUNCTION public.is_accountant()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','accountant')
$$;
-- GRANT EXECUTE ... TO authenticated already exists from phase88 (no re-grant needed)

-- ── (3) verify ──────────────────────────────────────────────────────────────
-- constraint must now include 'accountant':
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_role_check';
-- is_accountant() definition must now list 'accountant':
SELECT pg_get_functiondef('public.is_accountant'::regproc);
-- NOTE: SELECT public.is_accountant() in the SQL Editor returns NULL (auth.uid()
--       is NULL there — no JWT); it returns TRUE for real admin/accountant sessions
--       via PostgREST. To test in-editor:
--   SET LOCAL request.jwt.claims = '{"sub":"<accountant-uuid>","role":"authenticated"}';
--   SELECT public.is_accountant();   -- → true
