-- ═══════════════════════════════════════════════════════════
--  Phase 45.x — Bug F: handle_new_user trigger ignores metadata role
--  Date: 2026-04-29
-- ═══════════════════════════════════════════════════════════
--
-- Symptom: ลูกค้า signup ผ่าน OTP → login เป็น "พนักงานขาย"
-- (ไม่ใช่ "ลูกค้า") — sidebar/permissions ขึ้นเป็น sales
--
-- Root cause:
--   Trigger handle_new_user ใน DB (จาก supabase-rls-policies.sql)
--   hardcode role = 'sales' ทุก user ใหม่ — แม้ main.js signUp()
--   จะส่ง raw_user_meta_data->>'role' = 'customer' ก็ตาม
--
--   Order ของเหตุการณ์:
--     1. signUp() insert auth.users + raw_user_meta_data role=customer
--     2. Trigger fires → INSERT profile (role HARDCODED 'sales')
--     3. main.js POST profile (role=customer) → ON CONFLICT DO NOTHING
--        → row เก่าจาก trigger ทับ → role ติด 'sales'
--     4. afterLogin → role=sales → sidebar/UI ของ sales
--
-- Fix:
--   1. Recreate trigger function — ใช้ COALESCE อ่าน metadata role
--      ก่อน fallback 'sales'
--   2. Backfill — UPDATE profiles ที่ role='sales' แต่ auth.users
--      raw_user_meta_data->>'role' = 'customer' (recover users ที่
--      เพิ่ง signup ติด bug นี้)
-- ═══════════════════════════════════════════════════════════


-- ───── 1) Fix trigger function ─────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, phone, created_at)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    COALESCE(new.raw_user_meta_data->>'role', 'sales'),    -- ← prefer metadata
    COALESCE(new.raw_user_meta_data->>'phone', NULL),      -- ← carry phone too
    COALESCE(new.created_at, now())
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;


-- ───── 2) Backfill user ที่ติด bug นี้ ─────
-- เลือก user ที่ profile.role='sales' แต่ auth metadata บอก 'customer'
-- (แสดงว่า trigger ทับ metadata)
UPDATE public.profiles p
SET role = u.raw_user_meta_data->>'role'
FROM auth.users u
WHERE p.id = u.id
  AND p.role = 'sales'
  AND u.raw_user_meta_data->>'role' IN ('customer', 'technician');


-- ═══════════════════════════════════════════════════════════
-- Verify — ดู profile + metadata role ของ user ทุกคน
-- ═══════════════════════════════════════════════════════════

SELECT
  p.id,
  p.full_name,
  p.role AS profile_role,
  u.raw_user_meta_data->>'role' AS metadata_role,
  CASE
    WHEN u.raw_user_meta_data->>'role' IS NOT NULL
     AND u.raw_user_meta_data->>'role' <> p.role
    THEN '⚠️ MISMATCH'
    ELSE '✅ OK'
  END AS status,
  p.created_at
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
ORDER BY p.created_at DESC;
