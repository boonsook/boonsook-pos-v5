-- ═══════════════════════════════════════════════════════════
-- Phase 92.46b — Expression chunked + whitelist boolean probe
--
-- q1 ถูก truncate ในจอ SQL Editor. ใช้ 2 statements:
--   (A) Boolean checks — มี whitelist value ครบ 8 ตัวหรือไม่?
--   (B) Chunked substring — แสดง expression ทีละ 300 chars (ไม่ truncate)
--
-- Run: paste → Run → copy ผลทั้ง 2 tabs
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
-- (A) Whitelist presence — boolean per value
-- ═══════════════════════════════════════════════════════════
WITH expr AS (
  SELECT pg_get_expr(polwithcheck, polrelid) AS e
  FROM pg_policy
  WHERE polrelid='public.journal_entries'::regclass
    AND polname='je_insert_auto'
)
SELECT
  length(e)                                        AS expr_length,
  e LIKE '%is_accountant%'                         AS has_is_accountant,
  e LIKE '%source_table IS NOT NULL%'              AS has_source_table_not_null,
  e LIKE '%source_id IS NOT NULL%'                 AS has_source_id_not_null,
  e LIKE '%''sales''%'                             AS has_sales,
  e LIKE '%''expenses''%'                          AS has_expenses,
  e LIKE '%''staff_payroll''%'                     AS has_staff_payroll,
  e LIKE '%''service_jobs''%'                      AS has_service_jobs,
  e LIKE '%''receipts''%'                          AS has_receipts,
  e LIKE '%''delivery_invoices''%'                 AS has_delivery_invoices,
  e LIKE '%''credit_payments''%'                   AS has_credit_payments,
  e LIKE '%''refunds''%'                           AS has_refunds,
  -- Suspect: extra clause ที่ผมไม่รู้
  e LIKE '%created_by%'                            AS has_created_by_clause,
  e LIKE '%auth.uid()%'                            AS has_auth_uid_clause,
  e LIKE '%user_id%'                               AS has_user_id_clause
FROM expr;


-- ═══════════════════════════════════════════════════════════
-- (B) Chunked substring — paste แต่ละ column ต่อกันได้ full text
-- ═══════════════════════════════════════════════════════════
WITH expr AS (
  SELECT pg_get_expr(polwithcheck, polrelid) AS e
  FROM pg_policy
  WHERE polrelid='public.journal_entries'::regclass
    AND polname='je_insert_auto'
)
SELECT
  substring(e,    1, 300) AS chunk_1_chars_1_300,
  substring(e,  301, 300) AS chunk_2_chars_301_600,
  substring(e,  601, 300) AS chunk_3_chars_601_900,
  substring(e,  901, 300) AS chunk_4_chars_901_1200,
  substring(e, 1201, 300) AS chunk_5_chars_1201_1500
FROM expr;
