-- ═══════════════════════════════════════════════════════════
--  Phase 92.45 — Leave SQL/RLS Hardening + Review RPC
--
--  วัตถุประสงค์ (S3 ปิดช่อง "non-admin spoof reviewer fields"):
--    1) BEFORE INSERT trigger บน staff_leaves:
--       - non-admin ถูกบังคับ user_id = auth.uid(), status = 'pending',
--         reviewed_by/reviewed_at/review_note = NULL (ไม่สนใจค่าใน payload)
--       - admin: validate status ∈ check constraint แล้ว → ปล่อย
--
--    2) BEFORE UPDATE trigger บน staff_leaves:
--       - non-admin:
--           * preserve OLD.user_id, OLD.leave_type, OLD.created_by, OLD.reviewed_by,
--             OLD.reviewed_at, OLD.review_note (ห้ามแก้)
--           * NEW.status ต้องอยู่ใน ('pending','cancelled') เท่านั้น
--           * (RLS WITH CHECK เดิม pending/cancelled อยู่แล้ว — trigger เป็น defense-in-depth)
--       - admin:
--           * ถ้า status เปลี่ยน จาก != approved/rejected → approved/rejected
--             → auto-set NEW.reviewed_by = auth.uid(), NEW.reviewed_at = now()
--           * ถ้า status เปลี่ยน เป็น pending/cancelled → ล้าง reviewed_by/reviewed_at/review_note
--           * (admin ยังสามารถส่ง review_note ตอน approve/reject ได้)
--
--    3) RPC public.review_staff_leave(p_leave_id, p_status, p_note)
--       - admin-only (is_accountant)
--       - p_status ∈ ('approved','rejected','cancelled')
--       - UPDATE row → trigger auto-set reviewer
--       - คืน updated row (jsonb) ให้ client cache
--
--  ขอบเขต (additive only):
--    - ★ ไม่แตะ staff_attendance / staff_payroll / accounting / money math
--    - ★ ไม่ลบ/แก้ RLS policies เดิมของ staff_leaves (จาก phase 92.32)
--    - ★ trigger เป็น defense-in-depth ทับ RLS เดิม (ไม่ relax)
--
--  How to run:
--    Supabase Dashboard → SQL Editor → paste → Run → ตรวจ VERIFY ที่ท้ายไฟล์
--    Re-run safe: CREATE OR REPLACE / DROP TRIGGER IF EXISTS / DROP FUNCTION IF EXISTS
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  1) BEFORE INSERT trigger — guard non-admin payload
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._guard_staff_leaves_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_accountant() THEN
    -- non-admin: lock identity + reviewer fields
    NEW.user_id     := auth.uid();
    NEW.status      := 'pending';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.review_note := NULL;
    -- created_by: trust client (ปกติ = self) แต่บังคับให้ตรง auth.uid()
    NEW.created_by  := auth.uid();
  END IF;
  -- admin: ปล่อยตามที่ส่งมา (CHECK constraint cover เรื่อง status enum)
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_leaves_guard_insert ON public.staff_leaves;
CREATE TRIGGER trg_staff_leaves_guard_insert
  BEFORE INSERT ON public.staff_leaves
  FOR EACH ROW EXECUTE FUNCTION public._guard_staff_leaves_insert();


-- ═══════════════════════════════════════════════════════════
--  2) BEFORE UPDATE trigger — guard non-admin + auto-set admin reviewer
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._guard_staff_leaves_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := public.is_accountant();
BEGIN
  IF NOT v_is_admin THEN
    -- non-admin: preserve immutable / privileged fields
    NEW.user_id     := OLD.user_id;
    NEW.leave_type  := OLD.leave_type;  -- ห้ามเปลี่ยน type ตอน edit
    NEW.created_by  := OLD.created_by;
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.reviewed_at := OLD.reviewed_at;
    NEW.review_note := OLD.review_note;
    -- status: allow เฉพาะ pending หรือ cancelled (defense-in-depth ทับ RLS WITH CHECK)
    IF NEW.status NOT IN ('pending','cancelled') THEN
      RAISE EXCEPTION 'leave_guard: non-admin cannot set status=% (allowed: pending,cancelled)', NEW.status
        USING ERRCODE = '42501';
    END IF;
    -- ถ้า OLD เคย approved/rejected/cancelled → ห้าม non-admin ยุ่งต่อ
    IF OLD.status IN ('approved','rejected','cancelled') THEN
      RAISE EXCEPTION 'leave_guard: non-admin cannot modify row in terminal status=%', OLD.status
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- admin: auto-manage reviewer fields ตามทิศทาง status change
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      IF NEW.status IN ('approved','rejected') THEN
        NEW.reviewed_by := auth.uid();
        NEW.reviewed_at := now();
        -- review_note: ปล่อยตามที่ caller ส่ง
      ELSIF NEW.status IN ('pending','cancelled') THEN
        -- revert / cancel → ล้าง reviewer trail
        NEW.reviewed_by := NULL;
        NEW.reviewed_at := NULL;
        NEW.review_note := NULL;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_leaves_guard_update ON public.staff_leaves;
CREATE TRIGGER trg_staff_leaves_guard_update
  BEFORE UPDATE ON public.staff_leaves
  FOR EACH ROW EXECUTE FUNCTION public._guard_staff_leaves_update();


-- ═══════════════════════════════════════════════════════════
--  3) RPC review_staff_leave(p_leave_id, p_status, p_note)
--     - admin-only clean path สำหรับ approve/reject/cancel
--     - trigger จัดการ reviewer fields ให้เอง (defense-in-depth)
--     - คืน updated row เป็น jsonb เพื่อ client cache
-- ═══════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.review_staff_leave(bigint, text, text);
CREATE OR REPLACE FUNCTION public.review_staff_leave(
  p_leave_id bigint,
  p_status   text,
  p_note     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.staff_leaves;
BEGIN
  IF NOT public.is_accountant() THEN
    RAISE EXCEPTION 'review_staff_leave: admin only' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('approved','rejected','cancelled') THEN
    RAISE EXCEPTION 'review_staff_leave: invalid status % (allowed: approved,rejected,cancelled)', p_status
      USING ERRCODE = '22023';
  END IF;
  IF p_leave_id IS NULL THEN
    RAISE EXCEPTION 'review_staff_leave: p_leave_id required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.staff_leaves
     SET status      = p_status,
         review_note = NULLIF(btrim(COALESCE(p_note, '')), '')
   WHERE id = p_leave_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'review_staff_leave: leave_id % not found', p_leave_id USING ERRCODE = 'P0002';
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_staff_leave(bigint, text, text) TO authenticated;


-- ═══════════════════════════════════════════════════════════
--  4) Reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════
--  5) VERIFY queries (รันทีละชุดตรวจหลัง apply)
-- ═══════════════════════════════════════════════════════════

-- (a) Triggers — Expected: 3 ตัว (updated_at + guard_insert + guard_update)
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.staff_leaves'::regclass AND NOT tgisinternal
ORDER BY tgname;

-- (b) Functions — Expected: 3 (_bump_..., _guard_..._insert, _guard_..._update, review_staff_leave)
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    '_bump_staff_leaves_updated_at',
    '_guard_staff_leaves_insert',
    '_guard_staff_leaves_update',
    'review_staff_leave'
  )
ORDER BY p.proname;

-- (c) RPC grant — Expected: review_staff_leave มี EXECUTE สำหรับ authenticated
SELECT r.routine_name, p.privilege_type, p.grantee
FROM information_schema.routine_privileges p
JOIN information_schema.routines r
  ON r.specific_name = p.specific_name
WHERE r.routine_schema = 'public'
  AND r.routine_name = 'review_staff_leave'
ORDER BY p.grantee;

-- (d) RLS policies เดิม (จาก phase 92.32) — Expected: 4 ตัว (ไม่ถูกแตะ)
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public' AND tablename='staff_leaves'
ORDER BY cmd, policyname;

-- (e) Smoke ฝั่ง DB (รันใน session admin จริง — ตรวจ trigger ทำงาน)
--     หลัง INSERT ปลอม reviewed_by → ค่าจะถูก strip ถ้ารัน session ของ non-admin
--     สำหรับ admin session ค่ายังคงอยู่
-- SELECT auth.uid(), public.is_accountant();
