-- ═══════════════════════════════════════════════════════════
-- Phase 92.46b — Expression-level diagnostic
--
-- Diag #1 (10 rows) ผ่านทั้งหมด → root cause ไม่ใช่ policy count /
-- grant / RLS forced / role / restrictive.
--
-- Next layer: ตรวจ **expression body** ของ je_insert_auto + simulate
-- predicate eval ด้วย A2 payload values.
--
-- Run: Supabase Dashboard → SQL Editor → paste → Run
-- Output: 5 result tabs (1)(2)(3)(4)(5) — paste กลับให้ Claude
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
-- (1) je_insert_auto WITH CHECK expression VERBATIM
-- ═══════════════════════════════════════════════════════════
SELECT pg_get_expr(polwithcheck, polrelid) AS with_check_expr
FROM pg_policy
WHERE polrelid = 'public.journal_entries'::regclass
  AND polname  = 'je_insert_auto';
-- Expected ขั้นต่ำ:
--   (public.is_accountant() OR
--    ((source_table IS NOT NULL) AND (source_id IS NOT NULL) AND
--     (source_table = ANY (ARRAY['sales'::text, 'expenses'::text, ...]))))


-- ═══════════════════════════════════════════════════════════
-- (2) is_accountant() function definition (in case ถูก override)
-- ═══════════════════════════════════════════════════════════
SELECT pg_get_functiondef('public.is_accountant'::regproc);
-- Expected:
--   LANGUAGE SQL, SECURITY DEFINER, STABLE
--   SELECT (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin')


-- ═══════════════════════════════════════════════════════════
-- (3) Simulate predicate eval — admin context (SQL Editor runs as admin)
--     ★ ค่าจริง: A2 payload ส่ง source_table='sales', source_id=156 (bigint)
--     ★ การ test: ถ้า expression ทำงานปกติ + is_accountant()=true ใน admin
--       → ผลควรเป็น true ทั้ง 2 branches
-- ═══════════════════════════════════════════════════════════
SELECT public.is_accountant() AS admin_is_acct_should_be_true,
       'sales'::text = ANY (ARRAY['sales','expenses','staff_payroll','service_jobs',
                                  'receipts','delivery_invoices','credit_payments','refunds']::text[])
         AS whitelist_match_should_be_true,
       156::bigint IS NOT NULL  AS source_id_not_null_should_be_true,
       'sales'::text IS NOT NULL AS source_table_not_null_should_be_true;
-- Expected: ทั้ง 4 columns = true


-- ═══════════════════════════════════════════════════════════
-- (4) Look-up profile.role ของ test accounts (verify is_accountant() correctness)
--     ★ ใช้ uid จริงจาก script output:
--       non-admin uid: b28a7260-1ece-4fdf-8248-2a32d01d2dbc
--       admin uid:     e1400ebb-3edb-486f-8245-4ad713ebaca0
-- ═══════════════════════════════════════════════════════════
SELECT id, role,
       (SELECT role IN ('admin')) AS would_is_accountant_return_true
FROM public.profiles
WHERE id IN (
  'b28a7260-1ece-4fdf-8248-2a32d01d2dbc'::uuid,
  'e1400ebb-3edb-486f-8245-4ad713ebaca0'::uuid
);
-- Expected: 2 rows
--   non-admin uid → role != 'admin', would=false
--   admin uid     → role = 'admin',  would=true


-- ═══════════════════════════════════════════════════════════
-- (5) Check ALL columns ของ journal_entries — มี column-level GRANT/REVOKE หรือไม่
--     บาง schema มี column-level privilege ที่ block authenticated INSERT
--     เฉพาะ column สำคัญ (เช่น status, approved_at, source_table)
-- ═══════════════════════════════════════════════════════════
SELECT column_name, grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name   = 'journal_entries'
  AND grantee      = 'authenticated'
ORDER BY column_name, privilege_type;
-- Expected: หลาย rows (column×privilege) สำหรับทุก column
-- ถ้าไม่มี row หรือมีเฉพาะบาง column → column-level GRANT จำกัด = root cause
