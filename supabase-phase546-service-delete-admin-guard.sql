-- ═══════════════════════════════════════════════════════════════════════════
--  Phase 546 — Service job delete/cancel = admin-only (DB-enforced)
-- ═══════════════════════════════════════════════════════════════════════════
--
--  "Deleting" a service job in this app is a SOFT-DELETE: status='cancelled' + a
--  '[ลบแล้ว]' marker in note (the list hides those rows). The list "🗑️ ลบ" button +
--  its handler (modules/service_jobs.js) are now admin-only, but that is UX — a
--  technician/sales/accountant/customer could PATCH service_jobs directly via the
--  Supabase REST API with their own JWT and soft-delete (or cancel) a job.
--
--  This BEFORE UPDATE trigger is the REAL boundary. It blocks a non-admin when EITHER:
--    (a) the row transitions INTO status='cancelled' (OLD.status != 'cancelled'), or
--    (b) the '[ลบแล้ว]' delete marker is newly added to note.
--  Mirrors the leave-hardening / profiles-role / Phase 545 pattern (public.is_admin(),
--  RAISE … ERRCODE 42501).
--
--  Does NOT block (so normal technician work is unaffected):
--    - editing note WITHOUT adding the delete marker
--    - setting pending / progress / pending_review (→pending) / done-delivered-closed
--      (the close transition is governed separately by Phase 545's trg_service_jobs_close_guard)
--    - a row that is ALREADY cancelled (OLD.status='cancelled' → no new transition)
--    - service_role / backend (auth.uid() IS NULL — trusted; authenticated users always
--      have auth.uid(), so non-admins can't reach this bypass)
--    - admin (public.is_admin()) → always allowed
--
--  Independent of Phase 545 (separate trigger/function — both BEFORE UPDATE, both just
--  RAISE-or-pass; cancel is not a completion status so 545 never fires on it).
--
--  ROLLBACK / inspect:
--    DROP TRIGGER IF EXISTS trg_service_jobs_delete_guard ON public.service_jobs;
--    SELECT pg_get_functiondef('public._guard_service_jobs_delete'::regproc);
--
--  Reuses public.is_admin() from supabase-phase495-profiles-role-lock.sql.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._guard_service_jobs_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL                 -- service_role (NULL uid) = trusted backend, not gated
     AND NOT public.is_admin()
     AND (
       -- (a) transition INTO cancelled (soft-delete / cancel)
       (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status)
       OR
       -- (b) the '[ลบแล้ว]' delete marker is newly added to note
       (NEW.note LIKE '%[ลบแล้ว]%' AND (OLD.note IS NULL OR OLD.note NOT LIKE '%[ลบแล้ว]%'))
     )
  THEN
    RAISE EXCEPTION 'service_delete_guard: เฉพาะแอดมินเท่านั้นที่ลบ/ยกเลิกใบรับงานได้'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_jobs_delete_guard ON public.service_jobs;
CREATE TRIGGER trg_service_jobs_delete_guard
  BEFORE UPDATE ON public.service_jobs
  FOR EACH ROW EXECUTE FUNCTION public._guard_service_jobs_delete();

-- ไม่เปลี่ยน schema/column ที่ PostgREST cache → ไม่ต้อง NOTIFY pgrst.
-- ไม่แตะ Phase 545 trg_service_jobs_close_guard (independent trigger).
