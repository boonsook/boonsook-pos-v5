-- ═══════════════════════════════════════════════════════════════════════════
--  Phase 551 (audit fix) — Service job: non-admin ห้าม INSERT งานสถานะปิด/ส่งมอบ
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Why: Phase 545 ปิดช่อง UPDATE (non-admin transition → done/delivered/closed → 42501)
--  แต่ **INSERT ไม่ถูก gate**. RLS ของ service_jobs เป็น WITH CHECK(true) สำหรับทุก
--  authenticated user → technician/sales JWT ยิง POST /rest/v1/service_jobs ตรงด้วย
--  status='delivered' + total_cost + items_json ได้เลย → row เป็นงาน "ปิด/ส่งมอบ"
--  โดยไม่ผ่าน app flow (saveServiceJob) → **ไม่มี auto-post JV (รายได้/COGS หาย) +
--  ไม่ตัดสต็อก** = บัญชี/สต็อกเพี้ยน. (residual 4a ที่ HANDOFF phase 545 บันทึกไว้)
--
--  Fix: BEFORE INSERT trigger — reject non-admin ที่ INSERT งานด้วย completion status.
--  งานใหม่ของ non-admin ต้องเริ่มที่สถานะ non-completion (pending/progress) แล้วให้
--  admin เป็นคนปิด (ผ่าน UPDATE guard เดิม ซึ่งรัน JV/stock ใน app flow).
--
--  Policy (mirror phase 545 UPDATE guard):
--    - completion = done | delivered | closed
--    - admin (public.is_admin()) → allowed
--    - service_role / backend (auth.uid() IS NULL) → not gated (trusted; backfill)
--    - non-admin INSERT completion status → 42501
--
--  ROLLBACK / inspect:
--    DROP TRIGGER IF EXISTS trg_service_jobs_insert_close_guard ON public.service_jobs;
--    SELECT pg_get_functiondef('public._guard_service_jobs_insert_close'::regproc);
--
--  Reuses public.is_admin() (phase495). ไม่แตะ column/schema → ไม่ต้อง NOTIFY pgrst.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._guard_service_jobs_insert_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('done', 'delivered', 'closed')
     AND auth.uid() IS NOT NULL          -- service_role (NULL uid) = trusted backend, not gated
     AND NOT public.is_admin()
  THEN
    RAISE EXCEPTION 'service_close_guard: เฉพาะแอดมินเท่านั้นที่สร้างงานสถานะปิด/ส่งมอบได้ (status %)',
      NEW.status
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_jobs_insert_close_guard ON public.service_jobs;
CREATE TRIGGER trg_service_jobs_insert_close_guard
  BEFORE INSERT ON public.service_jobs
  FOR EACH ROW EXECUTE FUNCTION public._guard_service_jobs_insert_close();

-- ───────────────────────────────────────────────────────────
-- Verify — trigger พร้อม (BEFORE INSERT)
-- ───────────────────────────────────────────────────────────
SELECT event_manipulation, action_timing
FROM information_schema.triggers
WHERE trigger_schema = 'public' AND trigger_name = 'trg_service_jobs_insert_close_guard';
-- Expected: INSERT | BEFORE
