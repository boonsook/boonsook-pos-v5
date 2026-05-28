-- ═══════════════════════════════════════════════════════════
-- Phase 92.46b — Single text line diagnostic
--
-- Boolean cell rendering issue: Supabase Editor อาจ show t/f เป็น icon
-- ที่ user copy ไม่ได้. ใช้ format() concat เป็น TEXT บรรทัดเดียว
--
-- Output: 1 row, 1 column, 1 text value — paste ตรงๆ
-- ═══════════════════════════════════════════════════════════
SELECT format(
'PRED: st_nn=%s sid_nn=%s in_wl=%s | IS_ACCT_EDITOR=%s | EXPR_LEN=%s | HAS: sales=%s expenses=%s staff_payroll=%s service_jobs=%s receipts=%s delivery_invoices=%s credit_payments=%s refunds=%s is_accountant=%s | EXTRA: created_by=%s auth_uid=%s user_id=%s',
  -- Predicate eval against A2 values (admin context)
  ('sales'::text IS NOT NULL)::text,
  (156::bigint IS NOT NULL)::text,
  ('sales' = ANY (ARRAY['sales','expenses','staff_payroll','service_jobs',
                        'receipts','delivery_invoices','credit_payments','refunds']::text[]))::text,
  -- is_accountant() admin context
  COALESCE(public.is_accountant()::text, 'NULL'),
  -- Expression length
  (SELECT length(pg_get_expr(polwithcheck, polrelid))::text
   FROM pg_policy WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto'),
  -- Each whitelist value present in stored expression?
  (SELECT (pg_get_expr(polwithcheck, polrelid) LIKE '%''sales''%')::text
   FROM pg_policy WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto'),
  (SELECT (pg_get_expr(polwithcheck, polrelid) LIKE '%''expenses''%')::text
   FROM pg_policy WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto'),
  (SELECT (pg_get_expr(polwithcheck, polrelid) LIKE '%''staff_payroll''%')::text
   FROM pg_policy WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto'),
  (SELECT (pg_get_expr(polwithcheck, polrelid) LIKE '%''service_jobs''%')::text
   FROM pg_policy WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto'),
  (SELECT (pg_get_expr(polwithcheck, polrelid) LIKE '%''receipts''%')::text
   FROM pg_policy WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto'),
  (SELECT (pg_get_expr(polwithcheck, polrelid) LIKE '%''delivery_invoices''%')::text
   FROM pg_policy WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto'),
  (SELECT (pg_get_expr(polwithcheck, polrelid) LIKE '%''credit_payments''%')::text
   FROM pg_policy WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto'),
  (SELECT (pg_get_expr(polwithcheck, polrelid) LIKE '%''refunds''%')::text
   FROM pg_policy WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto'),
  (SELECT (pg_get_expr(polwithcheck, polrelid) LIKE '%is_accountant%')::text
   FROM pg_policy WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto'),
  -- Extra clause suspects
  (SELECT (pg_get_expr(polwithcheck, polrelid) LIKE '%created_by%')::text
   FROM pg_policy WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto'),
  (SELECT (pg_get_expr(polwithcheck, polrelid) LIKE '%auth.uid%')::text
   FROM pg_policy WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto'),
  (SELECT (pg_get_expr(polwithcheck, polrelid) LIKE '%user_id%')::text
   FROM pg_policy WHERE polrelid='public.journal_entries'::regclass AND polname='je_insert_auto')
) AS diag_line;
