-- ═══════════════════════════════════════════════════════════
-- Phase 92.46b — Expression dump as ROWS (60 chars each)
--
-- Supabase SQL Editor cell truncates wide columns. ใช้ rows แทน:
--   - Stmt (A): Boolean instant probe (1 row, 15 cols)
--   - Stmt (B): Expression text as N rows × 60 chars (เห็นเต็ม)
--   - Stmt (C): is_accountant() body as N rows × 60 chars
--
-- Run: paste → Run → copy ผลทั้ง 3 tabs (โดยเฉพาะ A + B)
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
-- (A) Boolean instant probe — 1 row, 15 cols
-- ═══════════════════════════════════════════════════════════
WITH e AS (
  SELECT pg_get_expr(polwithcheck, polrelid) AS s
  FROM pg_policy
  WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto'
)
SELECT
  length(s)                          AS expr_len,
  s LIKE '%is_accountant%'           AS has_is_accountant,
  s LIKE '%source_table IS NOT NULL%' AS has_st_not_null,
  s LIKE '%source_id IS NOT NULL%'   AS has_sid_not_null,
  s LIKE '%''sales''%'               AS has_sales,
  s LIKE '%''expenses''%'            AS has_expenses,
  s LIKE '%''staff_payroll''%'       AS has_staff_payroll,
  s LIKE '%''service_jobs''%'        AS has_service_jobs,
  s LIKE '%''receipts''%'            AS has_receipts,
  s LIKE '%''delivery_invoices''%'   AS has_delivery_invoices,
  s LIKE '%''credit_payments''%'     AS has_credit_payments,
  s LIKE '%''refunds''%'             AS has_refunds,
  s LIKE '%created_by%'              AS extra_created_by,
  s LIKE '%auth.uid()%'              AS extra_auth_uid,
  s LIKE '%user_id%'                 AS extra_user_id
FROM e;


-- ═══════════════════════════════════════════════════════════
-- (B) je_insert_auto WITH CHECK — แสดงเป็น rows (60 chars each)
-- ═══════════════════════════════════════════════════════════
WITH e AS (
  SELECT pg_get_expr(polwithcheck, polrelid) AS s
  FROM pg_policy
  WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto'
),
nums AS (
  SELECT generate_series(0, GREATEST(0, (length((SELECT s FROM e)) - 1) / 60)) AS i
)
SELECT
  i + 1                                                  AS line,
  substring((SELECT s FROM e), i * 60 + 1, 60)           AS chunk_60_chars
FROM nums
ORDER BY i;


-- ═══════════════════════════════════════════════════════════
-- (C) is_accountant() function body — rows (60 chars each)
-- ═══════════════════════════════════════════════════════════
WITH f AS (
  SELECT pg_get_functiondef('public.is_accountant'::regproc) AS d
),
nums AS (
  SELECT generate_series(0, GREATEST(0, (length((SELECT d FROM f)) - 1) / 60)) AS i
)
SELECT
  i + 1                                                  AS line,
  substring((SELECT d FROM f), i * 60 + 1, 60)           AS chunk_60_chars
FROM nums
ORDER BY i;
