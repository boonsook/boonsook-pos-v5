-- Phase 536 - error_log hardening (audit S2+S3)
-- Apply after Phase 89.12 error_log table exists.
-- Fixes:
--   S2: direct REST inserts may not spoof another user_id.
--   S3: authenticated customer OTP sessions may not read error_log rows/aggregates.

BEGIN;

ALTER TABLE public.error_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS error_log_insert_anyone ON public.error_log;
CREATE POLICY error_log_insert_anyone ON public.error_log
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS error_log_select_authed ON public.error_log;
DROP POLICY IF EXISTS error_log_select_admin ON public.error_log;
CREATE POLICY error_log_select_admin ON public.error_log
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Keep UPDATE / DELETE forbidden by absence of policies.

ALTER VIEW public.error_log_grouped SET (security_invoker = true);
GRANT SELECT ON public.error_log_grouped TO authenticated;

COMMENT ON TABLE public.error_log IS
  'Phase 536 - JS error reports. INSERT cannot spoof user_id; SELECT is admin-only through RLS.';

NOTIFY pgrst, 'reload schema';

COMMIT;
