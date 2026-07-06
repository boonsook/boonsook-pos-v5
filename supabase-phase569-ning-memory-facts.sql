-- ═══════════════════════════════════════════════════════════
--  Phase 569 — ning_memory_facts (Ning long-term memory backing table)
--  รองรับ Cloudflare Function proxy /api/v1/ning-memory/{remember,recall,forget-all}
-- ═══════════════════════════════════════════════════════════
--  OWNER-RUN ใน Supabase SQL editor "ก่อน" smoke test endpoint.
--  ที่มา: เดิม Ning bot (E:\ning-agent-v2) ยิง table นี้ตรงด้วย SUPABASE_SERVICE_ROLE_KEY.
--  Phase 569 ย้าย access ให้ผ่าน POS Cloudflare Function (service-role อยู่ฝั่ง server เท่านั้น).
--  Function ใช้ upsert on_conflict=(user_id,text_hash) → ต้องมี UNIQUE(user_id,text_hash)
--  ไม่งั้น PostgREST ตอบ 42P10. idempotent (CREATE ... IF NOT EXISTS) — รันซ้ำปลอดภัย.
--  Security: ENABLE RLS แบบ deny-by-default (ไม่มี policy ให้ anon/authenticated) →
--  เข้าถึงได้เฉพาะ service-role (ผ่าน Function) ซึ่ง bypass RLS. ห้ามเพิ่ม policy USING(true).
-- ═══════════════════════════════════════════════════════════

-- 1) ตาราง long-term memory ของ Ning
CREATE TABLE IF NOT EXISTS public.ning_memory_facts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL,
  text       text NOT NULL,
  text_hash  text NOT NULL,
  tags       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ning_memory_facts_user_hash_uniq UNIQUE (user_id, text_hash)
);

-- 2) index ช่วย recall (filter user_id + order created_at)
CREATE INDEX IF NOT EXISTS idx_ning_memory_facts_user_created
  ON public.ning_memory_facts (user_id, created_at);

-- 3) RLS: เปิด แต่ "ไม่สร้าง policy" = deny-by-default สำหรับ anon/authenticated.
--    service-role (Cloudflare Function) bypass RLS → เข้าถึงได้ทางเดียวคือผ่าน proxy.
--    🚫 ห้ามเพิ่ม policy ที่ให้ anon/authenticated อ่าน/เขียน memory ทั้งตาราง.
ALTER TABLE public.ning_memory_facts ENABLE ROW LEVEL SECURITY;

-- 4) reload PostgREST schema cache (กัน PGRST205/PGRST204 หลังสร้างตาราง/คอลัมน์)
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
--  VERIFY (รันหลัง apply)
-- ═══════════════════════════════════════════════════════════
-- ตาราง+ คอลัมน์ครบ:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='ning_memory_facts' ORDER BY ordinal_position;
-- UNIQUE constraint มีจริง (ต้องเจอ ning_memory_facts_user_hash_uniq):
-- SELECT conname FROM pg_constraint WHERE conrelid='public.ning_memory_facts'::regclass AND contype='u';
-- RLS เปิด + ไม่มี policy (deny-by-default):
-- SELECT relrowsecurity FROM pg_class WHERE oid='public.ning_memory_facts'::regclass;   -- ต้อง true
-- SELECT polname FROM pg_policy WHERE polrelid='public.ning_memory_facts'::regclass;     -- ต้องว่าง (0 row)
