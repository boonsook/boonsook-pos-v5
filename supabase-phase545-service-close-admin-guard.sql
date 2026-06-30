-- ═══════════════════════════════════════════════════════════════════════════
--  Phase 545 — Service job close = admin-only (DB-enforced)
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Why: setting service_jobs.status → done/delivered/closed triggers (client-side)
--  auto-post JV + real stock deduct. The client guard (main.js saveServiceJob +
--  the drawer dropdown) is UX only — a technician/sales user could PATCH
--  service_jobs.status directly via the Supabase REST API with their own JWT and
--  bypass it (and would leave a "delivered" row with NO JV / NO stock deduct =
--  inconsistent accounting, since those side-effects only run in the app flow).
--
--  This BEFORE UPDATE trigger is the REAL boundary: it rejects a transition INTO a
--  completion status by a non-admin. Mirrors the leave-hardening / profiles-role
--  pattern (public.is_admin(), RAISE ... ERRCODE 42501).
--
--  Policy (transition-only — NOT absolute):
--    - block ONLY when OLD.status is non-completion AND NEW.status is completion
--      (= the moment that fires JV/stock). Editing note/fields of an already-closed
--      job (status unchanged, or any non-completion change) is NOT blocked.
--    - completion = done | delivered | closed
--    - admin (public.is_admin()) → always allowed.
--    - service_role / backend (auth.uid() IS NULL) → not gated (trusted; e.g. future
--      backfills). Authenticated users always have auth.uid(), so technicians can't
--      reach this bypass.
--    - non-admin may still submit "รออนุมัติ" (UI pending_review → normalized to
--      status='pending' + note marker) — 'pending' is not a completion status.
--
--  ROLLBACK / inspect:
--    DROP TRIGGER IF EXISTS trg_service_jobs_close_guard ON public.service_jobs;
--    SELECT pg_get_functiondef('public._guard_service_jobs_close'::regproc);
--
--  Reuses public.is_admin() from supabase-phase495-profiles-role-lock.sql
--  (SECURITY DEFINER: role FROM profiles WHERE id = auth.uid() = 'admin').
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._guard_service_jobs_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- transition-only: non-completion → completion, by an authenticated non-admin.
  IF OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status NOT IN ('done', 'delivered', 'closed')
     AND NEW.status IN ('done', 'delivered', 'closed')
     AND auth.uid() IS NOT NULL          -- service_role (NULL uid) = trusted backend, not gated
     AND NOT public.is_admin()
  THEN
    RAISE EXCEPTION 'service_close_guard: เฉพาะแอดมินเท่านั้นที่ปิดงาน/ส่งมอบงานได้ (status % -> %)',
      OLD.status, NEW.status
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_jobs_close_guard ON public.service_jobs;
CREATE TRIGGER trg_service_jobs_close_guard
  BEFORE UPDATE ON public.service_jobs
  FOR EACH ROW EXECUTE FUNCTION public._guard_service_jobs_close();

-- ไม่เปลี่ยน schema/column ที่ PostgREST cache → ไม่ต้อง NOTIFY pgrst.
