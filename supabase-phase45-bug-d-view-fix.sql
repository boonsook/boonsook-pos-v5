-- ═══════════════════════════════════════════════════════════
--  Phase 45.x — Bug D: profiles_with_email view 403 hotfix
--  Date: 2026-04-29
-- ═══════════════════════════════════════════════════════════
--
-- Problem (pre-existing, ไม่ใช่ผลจาก Bug A/B/C migrations):
--   GET /rest/v1/profiles_with_email → HTTP 403
--   "permission denied for table users" (code 42501)
--
-- Root cause:
--   View `profiles_with_email` ตั้งค่า security_invoker = on →
--   ใช้สิทธิ์ของ caller. caller (authenticated user) ไม่มีสิทธิ์
--   อ่าน auth.users → JOIN fail → 403
--
--   Display ใน "ตั้งค่าผู้ใช้งาน" page ทำงานได้เพราะ fallback ไป
--   อ่าน profiles table ตรง — แต่ console spam HTTP 403 ทุก fetch
--
-- Fix: DROP view + CREATE ใหม่
--   - security_invoker = off (default) → run as owner (postgres) →
--     bypass auth.users RLS → JOIN ทำได้
--   - WHERE filter ใน view เอง: admin เห็นทุก row, ไม่ใช่ admin
--     เห็นแค่ row ของตัวเอง (defense-in-depth — ไม่พึ่ง grant ของ
--     auth.users)
--   - GRANT SELECT TO authenticated (ไม่ให้ anon)
--
-- ⚠️ Trade-off:
--   - View กลับมาทำงาน, console errors หายหมด
--   - Customer (logged in) เห็นแค่ profile + email ของตัวเอง
--   - Admin เห็นทุกคน (ตรงตามที่ "ตั้งค่าผู้ใช้งาน" ต้องการ)
--   - Non-admin staff (sales, technician) เห็นแค่ตัวเอง — ถ้า
--     sales/technician ต้องเห็น user อื่น ให้บอก จะแก้ให้
--
-- How to run:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. paste ทั้งไฟล์ → Run
--   3. ตรวจ "Success. No rows returned"
--   4. ทดสอบใน app:
--      - Login admin → "ตั้งค่าผู้ใช้งาน" → ต้องเห็น 4 users
--        ครบ + email + ไม่มี HTTP 403 ใน Console
--      - Login non-admin → ถ้า code มีโอกาสเรียก view นี้ →
--        ต้องเห็นแค่ row ของตัวเอง (ไม่ break)
-- ═══════════════════════════════════════════════════════════


DROP VIEW IF EXISTS public.profiles_with_email;

CREATE VIEW public.profiles_with_email AS
SELECT
  p.id,
  p.full_name,
  p.role,
  p.phone,
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

SELECT
  schemaname,
  viewname,
  viewowner,
  definition
FROM pg_views
WHERE schemaname = 'public'
  AND viewname = 'profiles_with_email';
