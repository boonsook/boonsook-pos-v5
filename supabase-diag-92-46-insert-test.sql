-- ═══════════════════════════════════════════════════════════
-- Phase 92.46b — DECISIVE INSERT test (DB layer vs REST/cache)
--
-- Goal: simulate sales user POST /journal_entries ที่ DB level เลย
--   - ถ้า INSERT throw 42501 → DB policy reject → policy ใน DB ไม่ตรง spec
--   - ถ้า INSERT succeed → DB OK → ปัญหาที่ PostgREST/cache (NOTIFY pgrst ไม่ทำงาน)
--
-- Run: paste → Run → 2 result tabs + maybe error message
-- ROLLBACK ทันที — ไม่กระทบ data
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- Set JWT claims เป็น sales test user
SET LOCAL request.jwt.claims = '{"sub":"b28a7260-1ece-4fdf-8248-2a32d01d2dbc","role":"authenticated"}';

-- Switch role เป็น authenticated (RLS applies)
SET LOCAL ROLE authenticated;

-- (1) Verify context: is_accountant() ควรคืน false สำหรับ sales
SELECT 'sales_context' AS label,
       current_user                                                AS db_user,
       public.is_accountant()                                      AS is_acct,
       (current_setting('request.jwt.claims', true)::jsonb)->>'sub' AS jwt_sub;

-- (2) ★ DECISIVE TEST: try INSERT A2 payload เป็น sales
--     ถ้า throw 42501 = policy ที่ active ใน DB reject (confirm root cause)
--     ถ้า succeed = policy OK ใน DB (ปัญหาที่ REST/cache)
INSERT INTO public.journal_entries (
  doc_no,
  doc_type,
  doc_date,
  description,
  status,
  total_debit,
  total_credit,
  source_table,
  source_id,
  approved_at
) VALUES (
  'DIAG-FOCUSED-' || (extract(epoch from now())::bigint)::text,
  'SV',
  current_date,
  'focused insert test',
  'approved',
  10,
  10,
  'sales',
  999999,
  now()
);

-- ถ้า INSERT throw — ROLLBACK auto. ถ้าผ่าน — ROLLBACK explicit ด้านล่าง
ROLLBACK;
