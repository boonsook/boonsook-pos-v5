-- ═══════════════════════════════════════════════════════════
--  Phase 57 — Activity Log (audit trail)
--  Date: 2026-05-01
-- ═══════════════════════════════════════════════════════════
-- เก็บ event สำคัญ — ใครทำอะไรเมื่อไหร่ — ตรวจย้อนหลังได้
-- (ใครลบใบเสนอราคา, ใครเปลี่ยน role, ใครลบบิล, etc.)

CREATE TABLE IF NOT EXISTS public.activity_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID,
  user_name    TEXT,
  user_role    TEXT,
  action       TEXT NOT NULL,        -- ค่าตัวอย่าง: delete_sale, delete_quotation, change_role, login, ...
  entity_type  TEXT,                 -- sale | quotation | service_job | profile | product | ...
  entity_id    TEXT,                 -- ID ของ entity ที่ถูกกระทำ (text เพราะแต่ละ table ใช้ type ต่างกัน)
  summary      TEXT,                 -- ข้อความสรุปอ่านง่าย เช่น "ลบใบเสนอราคา QT202604123 (45,000 บาท)"
  metadata     JSONB,                -- payload เพิ่มเติม (เช่น old_value/new_value ของ field)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- index สำหรับ query ทั่วไป
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON public.activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id    ON public.activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_action     ON public.activity_log(action);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity     ON public.activity_log(entity_type, entity_id);

-- ───── RLS ─────
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- authenticated INSERT ของ activity ตัวเอง (user_id = auth.uid())
DROP POLICY IF EXISTS "activity_log_insert_self" ON public.activity_log;
CREATE POLICY "activity_log_insert_self" ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- admin อ่านได้ทุก row
DROP POLICY IF EXISTS "activity_log_select_admin" ON public.activity_log;
CREATE POLICY "activity_log_select_admin" ON public.activity_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ───── Grants ─────
GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.activity_log_id_seq TO authenticated;
-- anon: ไม่ให้ใด ๆ — RLS deny + revoke
REVOKE ALL ON public.activity_log FROM anon;

-- ═══════════════════════════════════════════════════════════
-- Verify
-- ═══════════════════════════════════════════════════════════
-- SELECT * FROM public.activity_log ORDER BY created_at DESC LIMIT 20;
-- SELECT COUNT(*), action FROM public.activity_log GROUP BY action ORDER BY count DESC;
