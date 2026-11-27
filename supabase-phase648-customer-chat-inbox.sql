-- ═══════════════════════════════════════════════════════════
--  Phase 648 — customer chat inbox (เฟส A: รับแชท LINE เข้า POS, อ่านอย่างเดียว)
--  รองรับ Cloudflare Function /api/line-webhook + หน้า "กล่องแชทลูกค้า" (route customer_chat)
-- ═══════════════════════════════════════════════════════════
--  OWNER-RUN ใน Supabase SQL editor "ก่อน" ตั้ง Webhook URL ใน LINE Developers.
--  idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS) — รันซ้ำปลอดภัย.
--  ถ้าเคยรันร่างเก่า (ae85ed2, ไม่มีคอลัมน์ inbound_seq) → ไฟล์นี้หยุดเองที่ precheck (ไม่แก้ทับ).
--
--  Security model:
--   - เขียน (รับข้อความ/unsend) ได้ทางเดียว = RPC customer_chat_ingest_line /
--     customer_chat_unsend_line ซึ่ง EXECUTE ได้เฉพาะ service_role (Cloudflare Function หลังตรวจ
--     X-Line-Signature แล้ว). ไม่มี INSERT/UPDATE/DELETE policy ให้ anon/authenticated.
--   - อ่าน = admin + sales เท่านั้น (customer_chat_is_inbox_staff). technician/accountant/
--     customer อ่านไม่ได้. RESTRICTIVE deny is_customer_role() ซ้อนอีกชั้นตาม pattern phase505.
--   - เปลี่ยนสถานะห้อง (อ่านแล้ว / เสร็จ / เปิดใหม่) ผ่าน RPC customer_chat_set_thread_state
--     เท่านั้น → staff แก้ external_user_id (ปลายทางที่จะตอบกลับในเฟส B) ไม่ได้.
--   - ไม่แตะเงิน/สต็อก/บัญชี/ตารางเดิม.
--
--  ลำดับข้อความ (กัน race "ข้อความใหม่เข้าระหว่างเปิดห้องกับกดอ่าน/กดเสร็จ"):
--   - ทุกข้อความขาเข้าได้ inbound_seq ต่อห้อง (1,2,3,…) — ingest ล็อกแถวห้องก่อนออกเลข
--   - ห้องเก็บ inbound_seq (เลขล่าสุด) + read_seq (อ่านถึงเลขไหน); unread_count = GENERATED
--     (inbound_seq − read_seq) → มี writer เดียว ไม่มีทางนับเพี้ยนจาก JS
--   - client ส่ง "อ่านถึง seq ที่แสดงบนจอจริง" เท่านั้น → ข้อความที่มาทีหลังยังนับเป็นยังไม่อ่าน
--   - กด "เสร็จ" ด้วย seq ที่ต่ำกว่าเลขล่าสุด → ไม่ปิดห้อง คืน reason 'new_messages'
-- ═══════════════════════════════════════════════════════════

-- 0) precheck: กันรันทับตารางจากร่างเก่าที่ยังไม่มี seq
DO $$
BEGIN
  IF to_regclass('public.customer_chat_threads') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'customer_chat_threads' AND column_name = 'inbound_seq'
     ) THEN
    RAISE EXCEPTION 'customer_chat_threads exists from an older Phase 648 draft (no inbound_seq) — stop and ask before migrating';
  END IF;
END $$;

-- 1) ห้องแชท (1 แถว ต่อ 1 ลูกค้า ต่อ 1 ช่องทาง)
CREATE TABLE IF NOT EXISTS public.customer_chat_threads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel              text NOT NULL DEFAULT 'line' CHECK (channel IN ('line')),
  external_user_id     text NOT NULL CHECK (length(external_user_id) BETWEEN 1 AND 128),
  display_name         text,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  inbound_seq          bigint NOT NULL DEFAULT 0 CHECK (inbound_seq >= 0),
  read_seq             bigint NOT NULL DEFAULT 0,
  unread_count         bigint GENERATED ALWAYS AS (inbound_seq - read_seq) STORED,
  last_message_at      timestamptz,
  last_message_preview text,
  last_inbound_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_chat_threads_channel_user_uniq UNIQUE (channel, external_user_id),
  CONSTRAINT customer_chat_threads_read_seq_range CHECK (read_seq BETWEEN 0 AND inbound_seq)
);

CREATE INDEX IF NOT EXISTS idx_customer_chat_threads_last_msg
  ON public.customer_chat_threads (last_message_at DESC NULLS LAST, id DESC);
-- คิวค้างตอบ (status open / ยังไม่อ่าน) กรองฝั่ง DB ก่อนแบ่งหน้า
CREATE INDEX IF NOT EXISTS idx_customer_chat_threads_pending
  ON public.customer_chat_threads (last_message_at DESC NULLS LAST, id DESC)
  WHERE status = 'open' OR unread_count > 0;

-- 2) ข้อความ — external_message_id unique กัน LINE ส่ง webhook ซ้ำ (redelivery) แล้วเกิดข้อความซ้ำ
--    unsent_at = ลูกค้ากดยกเลิกข้อความ → body ต้องเป็น NULL (ไม่เก็บเนื้อหาที่ลูกค้าถอนแล้ว)
--    inbound_seq NULL = แถว tombstone (unsend มาถึงก่อนข้อความ) / ขาออก (เฟส B)
CREATE TABLE IF NOT EXISTS public.customer_chat_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           uuid NOT NULL REFERENCES public.customer_chat_threads(id) ON DELETE CASCADE,
  channel             text NOT NULL DEFAULT 'line' CHECK (channel IN ('line')),
  external_message_id text,
  direction           text NOT NULL CHECK (direction IN ('in','out')),
  message_type        text NOT NULL DEFAULT 'text',
  body                text,
  inbound_seq         bigint CHECK (inbound_seq IS NULL OR inbound_seq > 0),
  unsent_at           timestamptz,
  sent_at             timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_chat_messages_channel_ext_uniq UNIQUE (channel, external_message_id),
  CONSTRAINT customer_chat_messages_unsent_no_body CHECK (unsent_at IS NULL OR body IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_customer_chat_messages_thread_sent
  ON public.customer_chat_messages (thread_id, sent_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_chat_messages_thread_seq
  ON public.customer_chat_messages (thread_id, inbound_seq) WHERE inbound_seq IS NOT NULL;

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

-- 5) RPC รับข้อความเข้า (service_role เท่านั้น)
--    upsert ห้อง (ล็อกแถว) → ออก seq ถัดไป → insert ข้อความ → เลื่อน inbound_seq ของห้อง
--    ข้อความซ้ำ หรือเคยถูก unsend (มี tombstone) → ไม่ insert ไม่นับ ไม่เก็บเนื้อหา
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
  v_cur     bigint;
  v_seq     bigint;
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

  -- ON CONFLICT DO UPDATE ล็อกแถวห้องจนจบ transaction → ingest ของห้องเดียวกันเรียงคิวกัน
  INSERT INTO public.customer_chat_threads (channel, external_user_id, display_name)
  VALUES ('line', p_external_user_id, v_name)
  ON CONFLICT (channel, external_user_id) DO UPDATE
    SET display_name = COALESCE(EXCLUDED.display_name, public.customer_chat_threads.display_name),
        updated_at   = now()
  RETURNING id, inbound_seq INTO v_thread, v_cur;

  v_seq := v_cur + 1;

  INSERT INTO public.customer_chat_messages
    (thread_id, channel, external_message_id, direction, message_type, body, inbound_seq, sent_at)
  VALUES
    (v_thread, 'line', p_external_message_id, 'in',
     left(COALESCE(NULLIF(btrim(p_message_type), ''), 'text'), 32), v_body, v_seq, v_sent)
  ON CONFLICT (channel, external_message_id) DO NOTHING
  RETURNING id INTO v_msg;

  IF v_msg IS NULL THEN
    RETURN jsonb_build_object('thread_id', v_thread, 'inserted', false);
  END IF;

  -- RHS อ้างค่าเดิมของแถว → preview เปลี่ยนเฉพาะเมื่อข้อความนี้ใหม่กว่าข้อความล่าสุดเดิม
  UPDATE public.customer_chat_threads
     SET inbound_seq          = v_seq,
         status               = 'open',
         last_message_preview = CASE WHEN last_message_at IS NULL OR v_sent >= last_message_at
                                     THEN v_preview ELSE last_message_preview END,
         last_message_at      = GREATEST(COALESCE(last_message_at, v_sent), v_sent),
         last_inbound_at      = GREATEST(COALESCE(last_inbound_at, v_sent), v_sent),
         updated_at           = now()
   WHERE id = v_thread;

  RETURN jsonb_build_object('thread_id', v_thread, 'inserted', true, 'message_id', v_msg, 'inbound_seq', v_seq);
END;
$$;
REVOKE ALL ON FUNCTION public.customer_chat_ingest_line(text, text, text, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_chat_ingest_line(text, text, text, text, timestamptz, text)
  TO service_role;

-- 6) RPC ลูกค้ายกเลิกข้อความ (LINE unsend event; service_role เท่านั้น)
--    - ข้อความมีอยู่แล้วในห้องของลูกค้าคนนี้ → ลบเนื้อหา (body = NULL) + unsent_at; seq/unread คงเดิม
--    - unsend มาก่อนข้อความ (ลำดับ webhook สลับ/redelivery) → ใส่ tombstone (body NULL, seq NULL)
--      ทำให้ ingest ภายหลังชน unique แล้วไม่เก็บเนื้อหา. ห้องที่เกิดจาก tombstone อย่างเดียว = status done
--    - message id ที่เป็นของห้องอื่น → ไม่แตะ
CREATE OR REPLACE FUNCTION public.customer_chat_unsend_line(
  p_external_user_id    text,
  p_external_message_id text,
  p_unsent_at           timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread  uuid;
  v_hit     uuid;
  v_when    timestamptz := COALESCE(p_unsent_at, now());
  v_latest  record;
BEGIN
  IF COALESCE(btrim(p_external_user_id), '') = '' OR length(p_external_user_id) > 128 THEN
    RAISE EXCEPTION 'invalid external_user_id' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_external_message_id), '') = '' OR length(p_external_message_id) > 128 THEN
    RAISE EXCEPTION 'invalid external_message_id' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.customer_chat_threads (channel, external_user_id, status)
  VALUES ('line', p_external_user_id, 'done')
  ON CONFLICT (channel, external_user_id) DO UPDATE
    SET updated_at = now()
  RETURNING id INTO v_thread;

  UPDATE public.customer_chat_messages
     SET body = NULL,
         unsent_at = COALESCE(unsent_at, v_when)
   WHERE channel = 'line'
     AND external_message_id = p_external_message_id
     AND thread_id = v_thread
     AND direction = 'in'
  RETURNING id INTO v_hit;

  IF v_hit IS NULL THEN
    INSERT INTO public.customer_chat_messages
      (thread_id, channel, external_message_id, direction, message_type, body, inbound_seq, unsent_at, sent_at)
    VALUES
      (v_thread, 'line', p_external_message_id, 'in', 'unsent', NULL, NULL, v_when, v_when)
    ON CONFLICT (channel, external_message_id) DO NOTHING
    RETURNING id INTO v_hit;
  END IF;

  -- preview = ข้อความล่าสุดของห้อง (ถ้าถูกยกเลิกแสดงป้าย ไม่แสดงเนื้อหาเดิม)
  SELECT m.body, m.unsent_at INTO v_latest
    FROM public.customer_chat_messages m
   WHERE m.thread_id = v_thread
   ORDER BY m.sent_at DESC, m.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    UPDATE public.customer_chat_threads
       SET last_message_preview = CASE WHEN v_latest.unsent_at IS NOT NULL
                                       THEN '[ลูกค้ายกเลิกข้อความ]'
                                       ELSE left(COALESCE(v_latest.body, ''), 120) END,
           updated_at = now()
     WHERE id = v_thread;
  END IF;

  RETURN jsonb_build_object('thread_id', v_thread, 'applied', v_hit IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.customer_chat_unsend_line(text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_chat_unsend_line(text, text, timestamptz)
  TO service_role;

-- 7) RPC เปลี่ยนสถานะห้อง (admin/sales) — อ่านแล้ว / เสร็จ / เปิดใหม่ เท่านั้น
--    p_read_through_seq = seq สูงสุดของข้อความขาเข้าที่แสดงบนจอพนักงานจริง
--    - read_seq เลื่อนไปข้างหน้าได้อย่างเดียว และไม่เกินเลขล่าสุดของห้อง
--    - 'done' ปิดห้องได้เฉพาะเมื่อเห็นถึงเลขล่าสุด; ไม่งั้นคงสถานะเดิม + reason 'new_messages'
DROP FUNCTION IF EXISTS public.customer_chat_set_thread_state(uuid, boolean, text);

CREATE OR REPLACE FUNCTION public.customer_chat_set_thread_state(
  p_thread_id        uuid,
  p_read_through_seq bigint,
  p_status           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   public.customer_chat_threads%ROWTYPE;
  v_stale boolean;
BEGIN
  IF NOT public.customer_chat_is_inbox_staff() OR COALESCE(public.is_customer_role(), false) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('open','done') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023';
  END IF;
  IF p_read_through_seq IS NULL OR p_read_through_seq < 0 THEN
    RAISE EXCEPTION 'invalid read_through_seq' USING ERRCODE = '22023';
  END IF;

  -- UPDATE ล็อกแถว; ถ้า ingest commit ก่อน แถวที่ประเมินคือค่าใหม่ (READ COMMITTED re-check)
  UPDATE public.customer_chat_threads
     SET read_seq   = GREATEST(read_seq, LEAST(p_read_through_seq, inbound_seq)),
         status     = CASE
                        WHEN p_status = 'done' AND p_read_through_seq < inbound_seq THEN status
                        WHEN p_status IS NOT NULL THEN p_status
                        ELSE status
                      END,
         updated_at = now()
   WHERE id = p_thread_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'thread not found' USING ERRCODE = 'P0002';
  END IF;

  -- IS NOT DISTINCT FROM: p_status = NULL ต้องได้ false ไม่ใช่ NULL → ok เป็น boolean เสมอ
  v_stale := (p_status IS NOT DISTINCT FROM 'done') AND (p_read_through_seq < v_row.inbound_seq);

  RETURN jsonb_build_object(
    'ok',           NOT v_stale,
    'reason',       CASE WHEN v_stale THEN 'new_messages' ELSE NULL END,
    'id',           v_row.id,
    'status',       v_row.status,
    'inbound_seq',  v_row.inbound_seq,
    'read_seq',     v_row.read_seq,
    'unread_count', v_row.unread_count
  );
END;
$$;
REVOKE ALL ON FUNCTION public.customer_chat_set_thread_state(uuid, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_chat_set_thread_state(uuid, bigint, text) TO authenticated;

-- 8) reload PostgREST schema cache
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
-- ingest/unsend RPC: authenticated/anon ต้อง false, service_role ต้อง true:
-- SELECT p.oid::regprocedure AS fn,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
--        has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
--        has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname LIKE 'customer_chat_%';
-- set_thread_state เหลือ signature เดียว (uuid, bigint, text):
-- SELECT oid::regprocedure FROM pg_proc WHERE proname = 'customer_chat_set_thread_state';
-- authenticated เขียนตารางตรงไม่ได้ (ต้อง false ทั้งหมด):
-- SELECT has_table_privilege('authenticated', 'public.customer_chat_threads', 'INSERT') AS t_ins,
--        has_table_privilege('authenticated', 'public.customer_chat_threads', 'UPDATE') AS t_upd,
--        has_table_privilege('authenticated', 'public.customer_chat_messages', 'INSERT') AS m_ins;
