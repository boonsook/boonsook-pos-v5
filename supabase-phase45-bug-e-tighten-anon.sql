-- ═══════════════════════════════════════════════════════════
--  Phase 45.x — Bug E: tighten anon access (over-grant cleanup)
--  Date: 2026-04-29
-- ═══════════════════════════════════════════════════════════
--
-- Bug B ก่อนหน้านี้ KEEP anon GRANT ไว้บน 3 tables:
--   - profiles      (สำคัญตอนแรกคิดว่า signup ต้องการ)
--   - customers     (เหมือนกัน)
--   - customer_otp  (สำคัญตอนแรกคิดว่า OTP flow ใช้)
--
-- Audit code ใหม่พบ:
--
-- 1) profiles + customers — signUp() flow ที่ main.js:1330-1341 จริงๆ
--    ใช้ JWT authenticated:
--       const token = authData?.session?.access_token || cfg.anonKey;
--    Supabase signUp ใน config phone-based (fake email) ปิด email
--    confirmation → return session ทันที → token = JWT authenticated
--    → POST profiles + customers ในฐานะ authenticated ไม่ใช่ anon
--    → policies "profiles_insert" + "customers_self_insert" (TO authenticated)
--      ครอบคลุมแล้ว
--    → anon GRANT บน 2 tables นี้ "ไม่จำเป็น"
--
-- 2) customer_otp — verify-otp.js เป็น HMAC stateless (ฝั่ง Cloudflare)
--    ไม่ใช้ DB table — table นี้คงค้างจาก code เก่า ไม่มี call path
--    ใน app เลย → DROP policies + REVOKE GRANT ปลอดภัย
--
-- ─────────────────────────────────────────────────────────
-- Risk: 🟢 ต่ำ
--   - profiles/customers — ถ้า edge case signUp() ไม่ return session
--     (Supabase email confirmation = on) → fallback ใช้ anonKey →
--     POST จะ fail หลัง migration นี้
--   - แต่ phone-based fake email "@phone.boonsook.local" ถูกตั้งให้
--     skip email confirm มาตั้งแต่แรก — ถ้า admin ไม่เผลอเปิด confirm
--     ใน Supabase Dashboard → Auth Settings → ปลอดภัย
--
-- Rollback (ถ้า signup break):
--   GRANT ALL ON public.profiles, public.customers TO anon;
--   (ไม่ต้องคืน customer_otp — table ไม่ได้ใช้)
--
-- How to run:
--   1. Supabase SQL Editor → New query → paste → Run
--   2. ดู verify result ปลายไฟล์ — ตารางที่เหลือ anon GRANT ควรเหลือ
--      เฉพาะ store_settings, quotations, quotation_items
--   3. ทดสอบ flow signup ลูกค้าใหม่ในแอป — ต้องสำเร็จ
--      ถ้า fail → run rollback ข้างบน
-- ═══════════════════════════════════════════════════════════


-- ───── 1) profiles — REVOKE anon (signUp ใช้ JWT) ─────
REVOKE ALL ON public.profiles FROM anon;


-- ───── 2) customers — REVOKE anon (เหมือนกัน) ─────
REVOKE ALL ON public.customers FROM anon;


-- ───── 3) customer_otp — DROP policies + REVOKE (table ไม่มีใช้) ─────
DROP POLICY IF EXISTS "Allow anon insert otp" ON public.customer_otp;
DROP POLICY IF EXISTS "Allow anon select otp" ON public.customer_otp;
REVOKE ALL ON public.customer_otp FROM anon;

-- หมายเหตุ: ไม่ DROP TABLE — เผื่ออนาคตอยากใช้กลับ
-- ถ้า user ตรวจ + แน่ใจไม่ใช้ → run แยก:
--   DROP TABLE IF EXISTS public.customer_otp;


-- ═══════════════════════════════════════════════════════════
-- Verify — anon GRANT ที่เหลือบน public schema
-- ═══════════════════════════════════════════════════════════

SELECT
  table_name,
  grantee,
  string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'anon'
GROUP BY table_name, grantee
ORDER BY table_name;

-- ✅ ถ้าผลลัพธ์เหลือเฉพาะ:
--    - store_settings
--    - quotations
--    - quotation_items
--    + table อื่นที่ผม audit ไม่ครบ (เช่น categories ฯลฯ — review หลังจากนี้)
--   → migration สำเร็จ
--
-- ❌ ถ้ายังเห็น profiles/customers/customer_otp → migration fail
--   → check error + rerun
