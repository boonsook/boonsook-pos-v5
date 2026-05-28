-- ═══════════════════════════════════════════════════════════
-- Phase 92.46b — Direct predicate evaluation (no long-text paste)
--
-- 3 statements:
--   (A) Eval EXPECTED predicate components with A2 values (admin context)
--       → ทุก column ต้อง true; ยืนยันว่า predicate spec ที่ผมเขียน "ถ้า apply"
--          ควรจะ match
--
--   (B) Simulate sales user context (SET LOCAL JWT + ROLE authenticated)
--       → test is_accountant() result + try INSERT ด้วย A2 payload
--       → ROLLBACK ทันที (no commit)
--       → ถ้า INSERT throw 42501 ใน context นี้ = policy แอ็คทีฟ + reject จริง
--         ดู error message ใน "Results" / "Messages" tab
--
--   (C) Verify ว่า session restore เป็น admin หลัง rollback
--
-- Run: paste → Run → copy ผลทั้ง 3 + error message ของ (B)
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
-- (A) Eval EXPECTED predicate with A2 values (admin/Editor context)
--     ถ้าทุก column = true → predicate spec ผมถูก
-- ═══════════════════════════════════════════════════════════
WITH a2 AS (
  SELECT 'sales'::text AS source_table,
         156::bigint   AS source_id
)
SELECT
  -- Predicate components
  source_table IS NOT NULL                                              AS p1_st_not_null,
  source_id   IS NOT NULL                                               AS p2_sid_not_null,
  source_table IN ('sales','expenses','staff_payroll','service_jobs',
                   'receipts','delivery_invoices','credit_payments','refunds') AS p3_in_whitelist,
  -- Combined whitelist branch
  (source_table IS NOT NULL
   AND source_id IS NOT NULL
   AND source_table IN ('sales','expenses','staff_payroll','service_jobs',
                        'receipts','delivery_invoices','credit_payments','refunds')) AS whitelist_branch,
  -- is_accountant() in editor (admin) — should be true
  public.is_accountant()                                                AS is_acct_admin_editor,
  -- Full expression simulation (with admin is_accountant)
  (public.is_accountant()
   OR (source_table IS NOT NULL
       AND source_id IS NOT NULL
       AND source_table IN ('sales','expenses','staff_payroll','service_jobs',
                            'receipts','delivery_invoices','credit_payments','refunds'))) AS full_expr_admin
FROM a2;
-- Expected: ทุก column = true


-- ═══════════════════════════════════════════════════════════
-- (B) Simulate sales user context — eval is_accountant() + try INSERT
--     ★ ใช้ BEGIN/ROLLBACK + SET LOCAL → ไม่กระทบ data
--     ★ ถ้า INSERT throw 42501 = active policy reject ใน sales JWT context
--        (DIRECT proof — ไม่ต้อง paste long expression text)
-- ═══════════════════════════════════════════════════════════
BEGIN;

-- Set JWT claims เป็น sales user (ตรง uid script ใช้)
SET LOCAL request.jwt.claims = '{"sub":"b28a7260-1ece-4fdf-8248-2a32d01d2dbc","role":"authenticated"}';

-- Switch role เป็น authenticated (RLS applies — postgres superuser ปกติ bypass RLS)
SET LOCAL ROLE authenticated;

-- (B.1) Eval is_accountant() ใน sales context — expected: false
SELECT 'sales_ctx_is_accountant' AS check_name, public.is_accountant() AS value;

-- (B.2) Try INSERT ด้วย A2 payload (จะ throw 42501 ถ้า RLS reject)
INSERT INTO public.journal_entries (
  doc_no, doc_type, doc_date, description, status,
  total_debit, total_credit, source_table, source_id, approved_at
) VALUES (
  'DIAG-92-46-EVAL-' || (extract(epoch from now())::bigint)::text,
  'SV',
  current_date,
  'diag insert as sales context',
  'approved',
  10, 10,
  'sales',
  999999,
  now()
);

-- If INSERT succeeded เราจะเห็น row returned (1 row affected)
-- ถ้า INSERT throw — SQL Editor จะแสดง error ทันที + rollback อัตโนมัติ

ROLLBACK;
-- Rollback ไม่ commit ทั้งหมด (รวม INSERT ถ้าผ่าน)


-- ═══════════════════════════════════════════════════════════
-- (C) Verify session restore เป็น admin หลัง rollback
-- ═══════════════════════════════════════════════════════════
SELECT current_user                       AS post_rollback_user,
       public.is_accountant()             AS post_rollback_is_acct;
-- Expected: current_user back to postgres/admin, is_acct = true
