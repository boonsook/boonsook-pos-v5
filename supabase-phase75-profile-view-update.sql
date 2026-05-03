-- ═══════════════════════════════════════════════════════════
--  Phase 75.2 — Update profiles_with_email view เพิ่ม department_id
--  Date: 2026-05-03
-- ═══════════════════════════════════════════════════════════
-- Issue: หลังจากรัน Phase 71 SQL (departments + profiles.department_id)
-- view profiles_with_email ที่สร้างไว้ Phase 45 ยังไม่มี column นี้
-- ทำให้หน้า /settings/users dropdown แผนก "ดูเหมือน" ไม่เซฟ
-- (จริงๆ เซฟแล้ว — แค่ view อ่านกลับไม่ได้)
--
-- Fix: CREATE OR REPLACE VIEW เพิ่ม p.department_id

DROP VIEW IF EXISTS public.profiles_with_email;

CREATE VIEW public.profiles_with_email AS
SELECT
  p.id,
  p.full_name,
  p.role,
  p.phone,
  p.department_id,    -- ← Phase 75.2: เพิ่ม column นี้
  p.created_at,
  u.email
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE
  public.is_admin()      -- admin เห็นทั้งหมด
  OR p.id = auth.uid();  -- non-admin เห็นเฉพาะตัวเอง

GRANT SELECT ON public.profiles_with_email TO authenticated;
REVOKE ALL ON public.profiles_with_email FROM anon;

-- ═══════════════════════════════════════════════════════════
-- Verify
-- ═══════════════════════════════════════════════════════════
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'profiles_with_email'
-- ORDER BY ordinal_position;
-- → ควรเห็น: id, full_name, role, phone, department_id, created_at, email
