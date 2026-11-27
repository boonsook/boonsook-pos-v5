-- Phase 648A — behavioral checks for supabase-phase648-customer-chat-inbox.sql.
-- Runs ONLY in an isolated, owner-approved test database after tests/phase648_chat_pg_fixture.sql
-- and the migration (applied twice by the runner to prove re-run safety). psql ON_ERROR_STOP=1:
-- any RAISE stops the run. Expected final line: PHASE648 PG CHECKS PASS
-- Users: a1 admin · a2 sales · a3 technician · a4 accountant · a5 customer

-- ── K1 catalog after two applies ───────────────────────────────────────────
DO $k1$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'customer_chat_set_thread_state') <> 1 THEN
    RAISE EXCEPTION 'K1 set_thread_state must have exactly one signature';
  END IF;
  IF to_regprocedure('public.customer_chat_set_thread_state(uuid,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'K1 set_thread_state(uuid,bigint,text) missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.customer_chat_threads'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.customer_chat_messages'::regclass) THEN
    RAISE EXCEPTION 'K1 RLS must be enabled on both tables';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid IN ('public.customer_chat_threads'::regclass, 'public.customer_chat_messages'::regclass)) <> 4 THEN
    RAISE EXCEPTION 'K1 expected exactly 4 policies';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN ('public.customer_chat_threads'::regclass, 'public.customer_chat_messages'::regclass)
             AND polpermissive AND polcmd <> 'r') THEN
    RAISE EXCEPTION 'K1 permissive non-SELECT policy found';
  END IF;
  IF (SELECT attgenerated FROM pg_attribute WHERE attrelid = 'public.customer_chat_threads'::regclass AND attname = 'unread_count') <> 's' THEN
    RAISE EXCEPTION 'K1 unread_count must be GENERATED STORED';
  END IF;
END $k1$;

-- ── K2 privilege matrix (catalog) ───────────────────────────────────────────
DO $k2$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('anon', 'public.customer_chat_ingest_line(text,text,text,text,timestamptz,text)', false),
    ('authenticated', 'public.customer_chat_ingest_line(text,text,text,text,timestamptz,text)', false),
    ('service_role', 'public.customer_chat_ingest_line(text,text,text,text,timestamptz,text)', true),
    ('anon', 'public.customer_chat_unsend_line(text,text,timestamptz)', false),
    ('authenticated', 'public.customer_chat_unsend_line(text,text,timestamptz)', false),
    ('service_role', 'public.customer_chat_unsend_line(text,text,timestamptz)', true),
    ('anon', 'public.customer_chat_set_thread_state(uuid,bigint,text)', false),
    ('authenticated', 'public.customer_chat_set_thread_state(uuid,bigint,text)', true),
    ('anon', 'public.customer_chat_is_inbox_staff()', false)
  ) v(role_name, fn, expected) LOOP
    IF has_function_privilege(r.role_name, r.fn, 'EXECUTE') <> r.expected THEN
      RAISE EXCEPTION 'K2 EXECUTE % on % expected %', r.role_name, r.fn, r.expected;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES ('anon'), ('authenticated')) v(role_name) LOOP
    IF has_table_privilege(r.role_name, 'public.customer_chat_threads', 'INSERT')
       OR has_table_privilege(r.role_name, 'public.customer_chat_threads', 'UPDATE')
       OR has_table_privilege(r.role_name, 'public.customer_chat_threads', 'DELETE')
       OR has_table_privilege(r.role_name, 'public.customer_chat_messages', 'INSERT')
       OR has_table_privilege(r.role_name, 'public.customer_chat_messages', 'UPDATE')
       OR has_table_privilege(r.role_name, 'public.customer_chat_messages', 'DELETE') THEN
      RAISE EXCEPTION 'K2 % has a write privilege on chat tables', r.role_name;
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.customer_chat_threads', 'SELECT') THEN
    RAISE EXCEPTION 'K2 anon must not SELECT threads';
  END IF;
END $k2$;

-- ── seed via the real ingest RPC as service_role ────────────────────────────
SET ROLE service_role;
DO $seed$
DECLARE j jsonb;
BEGIN
  j := public.customer_chat_ingest_line('Ucust1', 'm-1', 'text', 'สวัสดีครับ', '2026-11-27 10:00+07', 'ลูกค้าหนึ่ง');
  IF NOT (j->>'inserted')::boolean OR (j->>'inbound_seq')::bigint <> 1 THEN RAISE EXCEPTION 'K3 first ingest %', j; END IF;
  -- K3 duplicate (LINE redelivery) → not inserted, not counted
  j := public.customer_chat_ingest_line('Ucust1', 'm-1', 'text', 'สวัสดีครับ', '2026-11-27 10:00+07', NULL);
  IF (j->>'inserted')::boolean THEN RAISE EXCEPTION 'K3 duplicate inserted'; END IF;
  j := public.customer_chat_ingest_line('Ucust1', 'm-2', 'text', 'แอร์ราคาเท่าไหร่', '2026-11-27 10:01+07', NULL);
  IF (j->>'inbound_seq')::bigint <> 2 THEN RAISE EXCEPTION 'K3 second seq %', j; END IF;
  -- late delivery: newer seq, older sent_at → preview unchanged, seq 3
  j := public.customer_chat_ingest_line('Ucust1', 'm-late', 'text', 'ข้อความมาช้า', '2026-11-27 09:00+07', NULL);
  IF (j->>'inbound_seq')::bigint <> 3 THEN RAISE EXCEPTION 'K3 late seq %', j; END IF;
END $seed$;
RESET ROLE;

DO $k3$
DECLARE t public.customer_chat_threads%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.customer_chat_threads WHERE external_user_id = 'Ucust1';
  IF t.inbound_seq <> 3 OR t.read_seq <> 0 OR t.unread_count <> 3 OR t.status <> 'open' THEN
    RAISE EXCEPTION 'K3 thread counters %/%/% %', t.inbound_seq, t.read_seq, t.unread_count, t.status;
  END IF;
  IF t.last_message_preview <> 'แอร์ราคาเท่าไหร่' OR t.display_name <> 'ลูกค้าหนึ่ง' THEN
    RAISE EXCEPTION 'K3 preview/name % / %', t.last_message_preview, t.display_name;
  END IF;
  IF (SELECT count(*) FROM public.customer_chat_messages WHERE thread_id = t.id) <> 3 THEN
    RAISE EXCEPTION 'K3 message count';
  END IF;
END $k3$;

-- ── K4 RLS reads per role ──────────────────────────────────────────────────
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
DO $$ BEGIN IF (SELECT count(*) FROM public.customer_chat_messages) <> 3 THEN RAISE EXCEPTION 'K4 admin must see messages'; END IF; END $$;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
DO $$ BEGIN IF (SELECT count(*) FROM public.customer_chat_threads) <> 1 THEN RAISE EXCEPTION 'K4 sales must see thread'; END IF; END $$;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
DO $$ BEGIN IF (SELECT count(*) FROM public.customer_chat_threads) + (SELECT count(*) FROM public.customer_chat_messages) <> 0 THEN RAISE EXCEPTION 'K4 technician must see nothing'; END IF; END $$;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
DO $$ BEGIN IF (SELECT count(*) FROM public.customer_chat_threads) + (SELECT count(*) FROM public.customer_chat_messages) <> 0 THEN RAISE EXCEPTION 'K4 accountant must see nothing'; END IF; END $$;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a5';
DO $$ BEGIN IF (SELECT count(*) FROM public.customer_chat_threads) + (SELECT count(*) FROM public.customer_chat_messages) <> 0 THEN RAISE EXCEPTION 'K4 customer must see nothing'; END IF; END $$;
-- K5 direct writes + service RPCs denied for every authenticated user (sales shown; privilege is role-wide)
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
DO $k5$
BEGIN
  BEGIN INSERT INTO public.customer_chat_threads (external_user_id) VALUES ('Uforged'); RAISE EXCEPTION 'K5 insert thread allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.customer_chat_threads SET external_user_id = 'Uhijack'; RAISE EXCEPTION 'K5 update thread allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.customer_chat_messages; RAISE EXCEPTION 'K5 delete messages allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.customer_chat_ingest_line('Ux', 'mx', 'text', 'x', now(), NULL); RAISE EXCEPTION 'K5 ingest allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.customer_chat_unsend_line('Ucust1', 'm-1', now()); RAISE EXCEPTION 'K5 unsend allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $k5$;
RESET ROLE;
SET ROLE anon;
DO $k5anon$
BEGIN
  BEGIN PERFORM count(*) FROM public.customer_chat_threads; RAISE EXCEPTION 'K5 anon select allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.customer_chat_set_thread_state(gen_random_uuid(), 0, NULL); RAISE EXCEPTION 'K5 anon set_state allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $k5anon$;
RESET ROLE;

-- ── K6 set_thread_state semantics (sales) ──────────────────────────────────
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
DO $k6$
DECLARE tid uuid; j jsonb;
BEGIN
  SELECT id INTO tid FROM public.customer_chat_threads WHERE external_user_id = 'Ucust1';
  -- read only what was shown (2 of 3)
  j := public.customer_chat_set_thread_state(tid, 2, NULL);
  IF jsonb_typeof(j->'ok') <> 'boolean' OR NOT (j->>'ok')::boolean THEN RAISE EXCEPTION 'K6 ok must be boolean true for p_status NULL: %', j; END IF;
  IF (j->>'read_seq')::bigint <> 2 OR (j->>'unread_count')::bigint <> 1 THEN RAISE EXCEPTION 'K6 partial read %', j; END IF;
  -- read_seq never moves backwards
  j := public.customer_chat_set_thread_state(tid, 1, NULL);
  IF (j->>'read_seq')::bigint <> 2 THEN RAISE EXCEPTION 'K6 read_seq went backwards %', j; END IF;
  -- done with stale seq → not closed
  j := public.customer_chat_set_thread_state(tid, 2, 'done');
  IF jsonb_typeof(j->'ok') <> 'boolean' OR (j->>'ok')::boolean OR j->>'reason' <> 'new_messages' OR j->>'status' <> 'open' THEN
    RAISE EXCEPTION 'K6 stale done must be rejected %', j;
  END IF;
  -- client claims beyond inbound → capped
  j := public.customer_chat_set_thread_state(tid, 999, NULL);
  IF (j->>'read_seq')::bigint <> 3 OR (j->>'unread_count')::bigint <> 0 THEN RAISE EXCEPTION 'K6 cap %', j; END IF;
  j := public.customer_chat_set_thread_state(tid, 3, 'done');
  IF NOT (j->>'ok')::boolean OR j->>'status' <> 'done' THEN RAISE EXCEPTION 'K6 done %', j; END IF;
  j := public.customer_chat_set_thread_state(tid, 3, 'open');
  IF NOT (j->>'ok')::boolean OR j->>'status' <> 'open' THEN RAISE EXCEPTION 'K6 reopen %', j; END IF;
  BEGIN PERFORM public.customer_chat_set_thread_state(tid, NULL, NULL); RAISE EXCEPTION 'K6 NULL seq accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.customer_chat_set_thread_state(tid, -1, NULL); RAISE EXCEPTION 'K6 negative seq accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.customer_chat_set_thread_state(tid, 3, 'closed'); RAISE EXCEPTION 'K6 bad status accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.customer_chat_set_thread_state(gen_random_uuid(), 0, NULL); RAISE EXCEPTION 'K6 unknown thread accepted';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL; END;
END $k6$;
-- K6b non-inbox roles rejected by the RPC itself
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
DO $$ BEGIN BEGIN PERFORM public.customer_chat_set_thread_state((SELECT gen_random_uuid()), 0, NULL); RAISE EXCEPTION 'K6b technician allowed'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END; END $$;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
DO $$ BEGIN BEGIN PERFORM public.customer_chat_set_thread_state((SELECT gen_random_uuid()), 0, NULL); RAISE EXCEPTION 'K6b accountant allowed'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END; END $$;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a5';
DO $$ BEGIN BEGIN PERFORM public.customer_chat_set_thread_state((SELECT gen_random_uuid()), 0, NULL); RAISE EXCEPTION 'K6b customer allowed'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END; END $$;
RESET ROLE;

-- ── K7 unsend after / before the message, and cross-user scope ──────────────
SET ROLE service_role;
DO $k7$
DECLARE j jsonb; m public.customer_chat_messages%ROWTYPE; t public.customer_chat_threads%ROWTYPE;
BEGIN
  -- after: latest-by-time message m-2 → body wiped, seq kept, preview label
  j := public.customer_chat_unsend_line('Ucust1', 'm-2', '2026-11-27 10:05+07');
  IF NOT (j->>'applied')::boolean THEN RAISE EXCEPTION 'K7 unsend after not applied %', j; END IF;
  SELECT * INTO m FROM public.customer_chat_messages WHERE external_message_id = 'm-2';
  IF m.body IS NOT NULL OR m.unsent_at IS NULL OR m.inbound_seq <> 2 THEN RAISE EXCEPTION 'K7 unsent row %', row_to_json(m); END IF;
  SELECT * INTO t FROM public.customer_chat_threads WHERE external_user_id = 'Ucust1';
  IF t.last_message_preview <> '[ลูกค้ายกเลิกข้อความ]' OR t.inbound_seq <> 3 THEN RAISE EXCEPTION 'K7 preview/seq %', row_to_json(t); END IF;
  -- cross-user: Ucust2 cannot unsend Ucust1's m-1
  j := public.customer_chat_unsend_line('Ucust2', 'm-1', now());
  IF (SELECT body FROM public.customer_chat_messages WHERE external_message_id = 'm-1') IS DISTINCT FROM 'สวัสดีครับ' THEN
    RAISE EXCEPTION 'K7 cross-user unsend changed another customer message';
  END IF;
  IF (SELECT status FROM public.customer_chat_threads WHERE external_user_id = 'Ucust2') <> 'done'
     OR (SELECT inbound_seq FROM public.customer_chat_threads WHERE external_user_id = 'Ucust2') <> 0 THEN
    RAISE EXCEPTION 'K7 tombstone-only thread must be done with seq 0';
  END IF;
  -- before: unsend arrives first → tombstone; late message never stores content nor counts
  j := public.customer_chat_unsend_line('Ucust3', 'm-ghost', '2026-11-27 11:00+07');
  j := public.customer_chat_ingest_line('Ucust3', 'm-ghost', 'text', 'เนื้อหาที่ถูกยกเลิก', '2026-11-27 10:59+07', NULL);
  IF (j->>'inserted')::boolean THEN RAISE EXCEPTION 'K7 ingest after tombstone inserted'; END IF;
  IF EXISTS (SELECT 1 FROM public.customer_chat_messages WHERE body = 'เนื้อหาที่ถูกยกเลิก') THEN
    RAISE EXCEPTION 'K7 unsent content stored';
  END IF;
  IF (SELECT unread_count FROM public.customer_chat_threads WHERE external_user_id = 'Ucust3') <> 0 THEN
    RAISE EXCEPTION 'K7 tombstone counted as unread';
  END IF;
  -- unsend replay is idempotent
  j := public.customer_chat_unsend_line('Ucust1', 'm-2', now());
  IF (SELECT count(*) FROM public.customer_chat_messages WHERE external_message_id = 'm-2') <> 1 THEN RAISE EXCEPTION 'K7 replay duplicated'; END IF;
END $k7$;
RESET ROLE;

-- ── K8 CHECK: unsent rows can never regain a body ───────────────────────────
DO $k8$
BEGIN
  BEGIN
    UPDATE public.customer_chat_messages SET body = 'กลับมา' WHERE external_message_id = 'm-2';
    RAISE EXCEPTION 'K8 unsent body restored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.customer_chat_threads SET read_seq = inbound_seq + 1 WHERE external_user_id = 'Ucust1';
    RAISE EXCEPTION 'K8 read_seq beyond inbound accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $k8$;

-- ── K9 server-side pending filter + exact count (what PostgREST or=() / count=exact compile to) ──
DO $k9$
DECLARE i int;
BEGIN
  SET LOCAL ROLE service_role;
  FOR i IN 1..205 LOOP
    PERFORM public.customer_chat_ingest_line('Unew' || i, 'nm' || i, 'text', 'ใหม่', now() - (i || ' seconds')::interval, NULL);
  END LOOP;
  RESET ROLE;
  UPDATE public.customer_chat_threads SET read_seq = inbound_seq, status = 'done' WHERE external_user_id LIKE 'Unew%';
  IF (SELECT count(*) FROM public.customer_chat_threads WHERE status = 'open' OR unread_count > 0) <> 1 THEN
    RAISE EXCEPTION 'K9 pending count expected 1 (Ucust1), got %', (SELECT count(*) FROM public.customer_chat_threads WHERE status = 'open' OR unread_count > 0);
  END IF;
  IF (SELECT external_user_id FROM public.customer_chat_threads WHERE status = 'open' OR unread_count > 0
      ORDER BY last_message_at DESC NULLS LAST, id DESC LIMIT 1) <> 'Ucust1' THEN
    RAISE EXCEPTION 'K9 old pending thread not first page of pending queue';
  END IF;
END $k9$;

SELECT 'PHASE648 PG CHECKS PASS';
