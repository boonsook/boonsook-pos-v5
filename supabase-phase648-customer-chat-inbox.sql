-- ═══════════════════════════════════════════════════════════
--  Phase 648 — customer chat inbox (เฟส A: รับแชท LINE เข้า POS, อ่านอย่างเดียว)
--  รองรับ Cloudflare Function /api/line-webhook + หน้า "กล่องแชทลูกค้า" (route customer_chat)
-- ═══════════════════════════════════════════════════════════
--  OWNER-RUN ใน Supabase SQL editor "ก่อน" ตั้ง Webhook URL ใน LINE Developers.
--  idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS) — รันซ้ำปลอดภัย.
--
--  Security model:
--   - เขียน (รับข้อความ) ได้ทางเดียว = RPC customer_chat_ingest_line ซึ่ง EXECUTE ได้เฉพาะ
--     service_role (Cloudflare Function หลังตรวจ X-Line-Signature แล้ว). ไม่มี INSERT/UPDATE/
--     DELETE policy ให้ anon/authenticated บนทั้งสองตาราง.
--   - อ่าน = admin + sales เท่านั้น (customer_chat_is_inbox_staff). technician/accountant/
--     customer อ่านไม่ได้. RESTRICTIVE deny is_customer_role() ซ้อนอีกชั้นตาม pattern phase505.
--   - เปลี่ยนสถานะห้อง (อ่านแล้ว / เสร็จ / เปิดใหม่) ผ่าน RPC customer_chat_set_thread_state
--     เท่านั้น → staff แก้ external_user_id (ปลายทางที่จะตอบกลับในเฟส B) ไม่ได้.
--   - ไม่แตะเงิน/สต็อก/บัญชี/ตารางเดิม.
-- ═══════════════════════════════════════════════════════════

-- 1) ห้องแชท (1 แถว ต่อ 1 ลูกค้า ต่อ 1 ช่องทาง)
CREATE TABLE IF NOT EXISTS public.customer_chat_threads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel              text NOT NULL DEFAULT 'line' CHECK (channel IN ('line')),
  external_user_id     text NOT NULL CHECK (length(external_user_id) BETWEEN 1 AND 128),
  display_name         text,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  unread_count         integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  last_message_at      timestamptz,
  last_message_preview text,
  last_inbound_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_chat_threads_channel_user_uniq UNIQUE (channel, external_user_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_chat_threads_last_msg
  ON public.customer_chat_threads (last_message_at DESC NULLS LAST);

-- 2) ข้อความ — external_message_id unique กัน LINE ส่ง webhook ซ้ำ (redelivery) แล้วเกิดข้อความซ้ำ
CREATE TABLE IF NOT EXISTS public.customer_chat_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           uuid NOT NULL REFERENCES public.customer_chat_threads(id) ON DELETE CASCADE,
  channel             text NOT NULL DEFAULT 'line' CHECK (channel IN ('line')),
  external_message_id text,
  direction           text NOT NULL CHECK (direction IN ('in','out')),
  message_type        text NOT NULL DEFAULT 'text',
  body                text,
  sent_at             timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_chat_messages_channel_ext_uniq UNIQUE (channel, external_message_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_chat_messages_thread_sent
  ON public.customer_chat_messages (thread_id, sent_at DESC);

-- 3) helper: ใครอ่านกล่องแชทได้ (admin + sales). SECURITY DEFINER เพื่ออ่าน profiles ได้แน่นอน
CREATE OR REPLACE FUNCTION public.customer_chat_is_inbox_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin','sales')
  );
$$;
REVOKE ALL ON FUNCTION public.customer_chat_is_inbox_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_chat_is_inbox_staff() TO authenticated;

-- 4) RLS
ALTER TABLE public.customer_chat_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_chat_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.customer_chat_threads  FROM anon, authenticated;
REVOKE ALL ON public.customer_chat_messages FROM anon, authenticated;
GRANT SELECT ON public.customer_chat_threads  TO authenticated;
GRANT SELECT ON public.customer_chat_messages TO authenticated;

DROP POLICY IF EXISTS customer_chat_threads_select_staff ON public.customer_chat_threads;
CREATE POLICY customer_chat_threads_select_staff ON public.customer_chat_threads
  FOR SELECT TO authenticated
  USING (public.customer_chat_is_inbox_staff());

DROP POLICY IF EXISTS customer_chat_messages_select_staff ON public.customer_chat_messages;
CREATE POLICY customer_chat_messages_select_staff ON public.customer_chat_messages
  FOR SELECT TO authenticated
  USING (public.customer_chat_is_inbox_staff());

DROP POLICY IF EXISTS deny_customer_customer_chat_threads ON public.customer_chat_threads;
CREATE POLICY deny_customer_customer_chat_threads ON public.customer_chat_threads
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT COALESCE(public.is_customer_role(), false))
  WITH CHECK (NOT COALESCE(public.is_customer_role(), false));

DROP POLICY IF EXISTS deny_customer_customer_chat_messages ON public.customer_chat_messages;
CREATE POLICY deny_customer_customer_chat_messages ON public.customer_chat_messages
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT COALESCE(public.is_customer_role(), false))
  WITH CHECK (NOT COALESCE(public.is_customer_role(), false));

-- 5) RPC รับข้อความเข้า (service_role เท่านั้น) — upsert ห้อง + insert ข้อความ + นับยังไม่อ่าน
--    แบบ atomic. ข้อความซ้ำ (external_message_id เดิม) → ไม่ insert ไม่นับซ้ำ.
CREATE OR REPLACE FUNCTION public.customer_chat_ingest_line(
  p_external_user_id    text,
  p_external_message_id text,
  p_message_type        text,
  p_body                text,
  p_sent_at             timestamptz,
  p_display_name        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread  uuid;
  v_msg     uuid;
  v_sent    timestamptz := COALESCE(p_sent_at, now());
  v_body    text := left(COALESCE(p_body, ''), 5000);
  v_preview text := left(COALESCE(p_body, ''), 120);
  v_name    text := NULLIF(left(btrim(COALESCE(p_display_name, '')), 120), '');
BEGIN
  IF COALESCE(btrim(p_external_user_id), '') = '' OR length(p_external_user_id) > 128 THEN
    RAISE EXCEPTION 'invalid external_user_id' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_external_message_id), '') = '' OR length(p_external_message_id) > 128 THEN
    RAISE EXCEPTION 'invalid external_message_id' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.customer_chat_threads (channel, external_user_id, display_name)
  VALUES ('line', p_external_user_id, v_name)
  ON CONFLICT (channel, external_user_id) DO UPDATE
    SET display_name = COALESCE(EXCLUDED.display_name, public.customer_chat_threads.display_name),
        updated_at   = now()
  RETURNING id INTO v_thread;

  INSERT INTO public.customer_chat_messages
    (thread_id, channel, external_message_id, direction, message_type, body, sent_at)
  VALUES
    (v_thread, 'line', p_external_message_id, 'in',
     left(COALESCE(NULLIF(btrim(p_message_type), ''), 'text'), 32), v_body, v_sent)
  ON CONFLICT (channel, external_message_id) DO NOTHING
  RETURNING id INTO v_msg;

  IF v_msg IS NULL THEN
    RETURN jsonb_build_object('thread_id', v_thread, 'inserted', false);
  END IF;

  -- RHS อ้างค่าเดิมของแถว → preview เปลี่ยนเฉพาะเมื่อข้อความนี้ใหม่กว่าข้อความล่าสุดเดิม
  UPDATE public.customer_chat_threads
     SET unread_count         = unread_count + 1,
         status               = 'open',
         last_message_preview = CASE WHEN last_message_at IS NULL OR v_sent >= last_message_at
                                     THEN v_preview ELSE last_message_preview END,
         last_message_at      = GREATEST(COALESCE(last_message_at, v_sent), v_sent),
         last_inbound_at      = GREATEST(COALESCE(last_inbound_at, v_sent), v_sent),
         updated_at           = now()
   WHERE id = v_thread;

  RETURN jsonb_build_object('thread_id', v_thread, 'inserted', true, 'message_id', v_msg);
END;
$$;
REVOKE ALL ON FUNCTION public.customer_chat_ingest_line(text, text, text, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_chat_ingest_line(text, text, text, text, timestamptz, text)
  TO service_role;

-- 6) RPC เปลี่ยนสถานะห้อง (admin/sales) — อ่านแล้ว / เสร็จ / เปิดใหม่ เท่านั้น
CREATE OR REPLACE FUNCTION public.customer_chat_set_thread_state(
  p_thread_id uuid,
  p_mark_read boolean DEFAULT true,
  p_status    text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.customer_chat_threads%ROWTYPE;
BEGIN
  IF NOT public.customer_chat_is_inbox_staff() OR COALESCE(public.is_customer_role(), false) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('open','done') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.customer_chat_threads
     SET unread_count = CASE WHEN COALESCE(p_mark_read, false) THEN 0 ELSE unread_count END,
         status       = COALESCE(p_status, status),
         updated_at   = now()
   WHERE id = p_thread_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'thread not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status, 'unread_count', v_row.unread_count);
END;
$$;
REVOKE ALL ON FUNCTION public.customer_chat_set_thread_state(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_chat_set_thread_state(uuid, boolean, text) TO authenticated;

-- 7) reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
--  VERIFY (รันหลัง apply — read-only)
-- ═══════════════════════════════════════════════════════════
-- RLS เปิดทั้งสองตาราง (ต้อง true, true):
-- SELECT relname, relrowsecurity FROM pg_class
--   WHERE oid IN ('public.customer_chat_threads'::regclass, 'public.customer_chat_messages'::regclass);
-- policy ครบ 4 ตัว (select_staff ×2 + deny_customer ×2) และไม่มี INSERT/UPDATE/DELETE policy:
-- SELECT polrelid::regclass, polname, polcmd, polpermissive FROM pg_policy
--   WHERE polrelid IN ('public.customer_chat_threads'::regclass, 'public.customer_chat_messages'::regclass);
-- ingest RPC: authenticated/anon ต้อง false, service_role ต้อง true:
-- SELECT has_function_privilege('authenticated', 'public.customer_chat_ingest_line(text,text,text,text,timestamptz,text)', 'EXECUTE') AS auth_exec,
--        has_function_privilege('anon',          'public.customer_chat_ingest_line(text,text,text,text,timestamptz,text)', 'EXECUTE') AS anon_exec,
--        has_function_privilege('service_role',  'public.customer_chat_ingest_line(text,text,text,text,timestamptz,text)', 'EXECUTE') AS svc_exec;
-- authenticated เขียนตารางตรงไม่ได้ (ต้อง false ทั้งหมด):
-- SELECT has_table_privilege('authenticated', 'public.customer_chat_threads', 'INSERT') AS t_ins,
--        has_table_privilege('authenticated', 'public.customer_chat_threads', 'UPDATE') AS t_upd,
--        has_table_privilege('authenticated', 'public.customer_chat_messages', 'INSERT') AS m_ins;
