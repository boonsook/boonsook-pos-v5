-- ═══════════════════════════════════════════════════════════
-- Phase 92.46b — Final diagnostic (3 focused queries)
--
-- Diag #1 (10-row) all PASS · Column grants PASS · Force-reset applied
-- → Remaining unknowns: actual expression text + is_accountant() body
--   + profile.role + hidden triggers
--
-- Run: Supabase Dashboard → SQL Editor → paste → Run
-- Output: 4 result tabs — paste กลับให้ Claude
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
-- (Q1) je_insert_auto WITH CHECK expression VERBATIM
--      ★ ผมต้องเห็น text จริงเพื่อ confirm ว่าตรงกับที่เขียนใน SQL file
-- ═══════════════════════════════════════════════════════════
SELECT pg_get_expr(polwithcheck, polrelid) AS expression
FROM pg_policy
WHERE polrelid = 'public.journal_entries'::regclass
  AND polname  = 'je_insert_auto';


-- ═══════════════════════════════════════════════════════════
-- (Q2) is_accountant() function definition (กัน override)
-- ═══════════════════════════════════════════════════════════
SELECT pg_get_functiondef('public.is_accountant'::regproc) AS fn_def;


-- ═══════════════════════════════════════════════════════════
-- (Q3) profile.role ของ test uids + simulate predicate eval
--      ★ ถ้า non-admin role != 'sales'/'technician'/etc. หรือ
--        ไม่มี row → is_accountant() จะคืน NULL → debug here
-- ═══════════════════════════════════════════════════════════
SELECT
  (SELECT role FROM public.profiles
   WHERE id = 'b28a7260-1ece-4fdf-8248-2a32d01d2dbc'::uuid) AS non_admin_profile_role,
  (SELECT role FROM public.profiles
   WHERE id = 'e1400ebb-3edb-486f-8245-4ad713ebaca0'::uuid) AS admin_profile_role,
  -- ตอน admin (Editor) เรียก is_accountant() → ควรคืน true (เพราะ auth.uid() = admin)
  public.is_accountant() AS is_accountant_in_editor_should_be_true_or_null,
  -- Whitelist eval ที่ admin runs (น่าจะ true เพราะ 'sales' อยู่ใน list)
  ('sales'::text = ANY (ARRAY['sales','expenses','staff_payroll','service_jobs',
                              'receipts','delivery_invoices','credit_payments','refunds']::text[])) AS whitelist_match_should_be_true;


-- ═══════════════════════════════════════════════════════════
-- (Q4) Triggers on journal_entries (ตรวจ trigger ใหม่/ซ่อน ที่ raise 42501)
--      ★ ที่รู้: trg_check_period_locked (Phase 88.19) — raise PERIOD_LOCKED ไม่ใช่ 42501
--      ★ ถ้ามี trigger อื่นที่ check user/role → อาจ raise 42501
-- ═══════════════════════════════════════════════════════════
SELECT tgname,
       tgenabled,                                                                 -- 'O'=enabled, 'D'=disabled
       pg_get_triggerdef(t.oid) AS trigger_def
FROM pg_trigger t
WHERE t.tgrelid = 'public.journal_entries'::regclass
  AND NOT t.tgisinternal
ORDER BY tgname;
-- Expected: เห็น trg_check_period_locked เป็นอย่างน้อย
-- ★ ถ้าเจอ trigger อื่นที่ผมไม่รู้ → อาจเป็น root cause
