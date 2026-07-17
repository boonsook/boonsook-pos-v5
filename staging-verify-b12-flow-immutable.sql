-- STAGING ONLY — ห้ามรันบน production เด็ดขาด
-- ============================================================================
-- Phase 606-B12 — staging behavioral verify: flow v2 immutable + activation gates
-- ============================================================================
-- พิสูจน์ด้วยการรันจริง (บน STAGING ที่ clone schema จาก production) ว่า guard
-- ที่ apply แล้ว (606-a / 606-b1 / 606-b1.1) ทำงานตามสัญญา 5 กรณี:
--   B12a  งาน v2 (ไม่มี JV)  UPDATE flow 2→1    → 42501 จาก v2_freeze + zero writes
--   B12b  งาน v2 (มี JV)     UPDATE flow 2→1    → 42501 เหมือนกัน (clause ไม่ขึ้นกับ JV)
--   B12c  งาน v2             UPDATE flow 2→NULL → 42501 (ไม่ใช่ 23502 — BEFORE trigger ยิงก่อน NOT NULL)
--   B12d  freeze matrix: note ผ่าน · total_cost block · delivered→done block · delivered→closed ผ่าน
--   B12e  งานใหม่ (flow ถูกบังคับ = 1) UPDATE 1→2 → 42501 จาก guard 606-a
--
-- กติกาการเขียนไฟล์นี้ (ตาม runbook STAGING_B12_RUNBOOK.md):
--   • Supabase SQL Editor ไม่คง transaction/temp object ข้าม statement (บทเรียน 606-b1.1)
--     → ทุก test case = DO block เดี่ยวจบในตัว · ล้มไม่พาตัวอื่นล้ม
--   • ทุก DO block เริ่มด้วย PRODUCTION INTERLOCK สองชั้น (ตาราง sentinel + confirm_text
--     ตรงวันนี้เป๊ะ) — default = ปฏิเสธ; sentinel สร้างด้วยมือบน staging เท่านั้น (อยู่ใน runbook)
--   • ห้าม disable trigger ฝั่ง journal ทุกกรณี (นั่นคือของที่กำลังพิสูจน์)
--   • expected-exception จับเฉพาะ insufficient_privilege (SQLSTATE 42501) — ห้าม WHEN OTHERS
--     และ assert SQLERRM substring เพื่อพิสูจน์ว่า 42501 มาจาก guard ตัวที่คาด
--     (BEFORE UPDATE ยิงเรียงชื่อ: trg_service_job_v2_freeze ('_'=0x5F) มาก่อน
--      trg_service_jobs_metadata_update_guard ('s'=0x73))
--   • snapshot ก่อนกระทำ = flow/status/total_cost/note (คอลัมน์ที่ยืนยันว่ามี) +
--     count(je)/count(jl) — journal_entries/journal_lines มี DDL ในรีโป
--     (supabase-phase88-accounting-foundation.sql). ห้ามอ้าง updated_at:
--     service_jobs ไม่มี DDL ในรีโป และไม่มีโค้ด/SQL ใดอ้าง service_jobs.updated_at
--     (grep = 0 hit เฉพาะ service_jobs; ตารางอื่นมีใช้ปกติ) → ไม่มีหลักฐานว่า
--     คอลัมน์นี้มีอยู่บนตารางนี้
--   • job_no ขึ้นต้น B12TEST- : derive_service_source_kind จับเฉพาะ ^(AI|SH)- →
--     ได้ source_kind='service' ไม่ชน web_order
--   • ผลทุก case ลงตาราง _staging_b12_results (สร้างใน SEED · อ่านสรุปที่ STEP ท้าย)
--
-- ลำดับการรัน: STEP 0 → SEED S1.1→S1.3 → B12a→B12e → TEARDOWN → REPORT
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 0 — read-only environment check (SELECT เดียว · ไม่เขียนอะไร)
--   runbook: ทุกแถวต้อง found=true ก่อนไปต่อ — ขาดตัวใด = staging clone ไม่ครบ
-- ────────────────────────────────────────────────────────────────────────────
SELECT x.obj, EXISTS (
         SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = 'public.service_jobs'::regclass
            AND t.tgname = x.obj AND NOT t.tgisinternal AND t.tgenabled = 'O'
       ) AS found
  FROM (VALUES ('trg_service_jobs_metadata_insert'),
               ('trg_service_jobs_metadata_update_guard'),
               ('trg_service_job_v2_freeze'),
               ('trg_service_jobs_insert_close_guard'),
               ('trg_service_jobs_close_guard')) AS x(obj)
UNION ALL
SELECT 'trg_je_lines_balance (journal_lines)', EXISTS (
         SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = 'public.journal_lines'::regclass
            AND t.tgname = 'trg_je_lines_balance' AND NOT t.tgisinternal)
UNION ALL
SELECT 'coa 1200 active', EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE code = '1200' AND is_active)
UNION ALL
SELECT 'coa 4220 active', EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE code = '4220' AND is_active)
UNION ALL
SELECT 'idx_je_source_unique', EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_je_source_unique')
UNION ALL
SELECT 'sentinel _staging_b12_sentinel', (to_regclass('public._staging_b12_sentinel') IS NOT NULL);


-- ────────────────────────────────────────────────────────────────────────────
-- SEED S1.1 — สร้างงานทดสอบ J1 (progress · ไม่มี JV) + J2 (delivered · จะมี JV)
--   หมายเหตุ: status ใช้ 'progress' (ไม่ใช่ 'in_progress') — DB constraint รับ 6 ค่า
--   pending/progress/done/delivered/closed/cancelled (Phase 383/551; 'in_progress' = 400)
--   INSERT ปกติ → trg_service_jobs_metadata_insert บังคับ flow=1 + derive source_kind เอง
--   (insert_close_guard 551 ไม่ gate system — SQL Editor = auth.uid() IS NULL)
-- ────────────────────────────────────────────────────────────────────────────
DO $b12s1$
DECLARE
  v_staging_ok boolean := false;
  v_f1 int; v_f2 int;
BEGIN
  -- [B12-INTERLOCK] staging เท่านั้น — default = ปฏิเสธ
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM public._staging_b12_sentinel
       WHERE confirm_text = 'B12-STAGING-' || to_char(current_date, 'YYYY-MM-DD')
    ) INTO v_staging_ok;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B12 INTERLOCK: ไม่พบตาราง _staging_b12_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT v_staging_ok THEN
    RAISE EXCEPTION 'B12 INTERLOCK: confirm_text ต้องเป็น B12-STAGING-% (วันนี้เป๊ะ) — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  EXECUTE 'CREATE TABLE IF NOT EXISTS public._staging_b12_results (
             case_id text PRIMARY KEY, ok boolean NOT NULL, detail text, at timestamptz DEFAULT now())';

  IF EXISTS (SELECT 1 FROM public.service_jobs WHERE job_no LIKE 'B12TEST-%') THEN
    RAISE EXCEPTION 'B12 SEED: มี B12TEST-* ค้างอยู่ — รัน TEARDOWN ก่อนแล้วค่อย seed ใหม่';
  END IF;

  INSERT INTO public.service_jobs (job_no, customer_name, customer_phone, description, status, job_type, total_cost, note)
  VALUES ('B12TEST-J1', 'B12 Staging Test', '0800000001', 'B12 J1 — v2 no JV', 'progress',  'other', 500.00,  'B12TEST seed')
  RETURNING finance_flow_version INTO v_f1;

  INSERT INTO public.service_jobs (job_no, customer_name, customer_phone, description, status, job_type, total_cost, note)
  VALUES ('B12TEST-J2', 'B12 Staging Test', '0800000002', 'B12 J2 — v2 with JV', 'delivered', 'other', 1000.00, 'B12TEST seed')
  RETURNING finance_flow_version INTO v_f2;

  -- trg_service_jobs_metadata_insert ต้องบังคับ flow=1 ทั้งคู่ (606a:182-189)
  IF v_f1 IS DISTINCT FROM 1 OR v_f2 IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'B12 SEED: insert trigger ไม่บังคับ flow=1 (J1=% J2=%) — schema clone ผิดรุ่น', v_f1, v_f2;
  END IF;
  RAISE NOTICE 'B12 SEED S1.1 OK: J1(progress,500) + J2(delivered,1000) · flow=1 ทั้งคู่';
END $b12s1$;


-- ────────────────────────────────────────────────────────────────────────────
-- SEED S1.2 — บังคับ flow=2 ให้ J1,J2
--   ⚠️ ขั้นเดียวในไฟล์ที่แตะ trigger: DISABLE เฉพาะ trg_service_jobs_metadata_update_guard
--   (ตัวที่ block 1→2) ชั่วคราวใน "transaction เดียวกัน" — ล้มตรงไหน = rollback ทั้งบล็อก
--   = trigger กลับมา enabled เอง; จบบล็อกด้วย VERIFY tgenabled='O'
--   ไม่ต้องแตะ trg_service_job_v2_freeze — early return เมื่อ OLD.flow≠2 (b1.1:131-133)
--   ห้ามแตะ trigger ฝั่ง journal ทุกกรณี
-- ────────────────────────────────────────────────────────────────────────────
DO $b12s2$
DECLARE
  v_staging_ok boolean := false;
  v_enabled "char";
  v_n int;
BEGIN
  -- [B12-INTERLOCK] staging เท่านั้น — default = ปฏิเสธ
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM public._staging_b12_sentinel
       WHERE confirm_text = 'B12-STAGING-' || to_char(current_date, 'YYYY-MM-DD')
    ) INTO v_staging_ok;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B12 INTERLOCK: ไม่พบตาราง _staging_b12_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT v_staging_ok THEN
    RAISE EXCEPTION 'B12 INTERLOCK: confirm_text ต้องเป็น B12-STAGING-% (วันนี้เป๊ะ) — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  EXECUTE 'ALTER TABLE public.service_jobs DISABLE TRIGGER trg_service_jobs_metadata_update_guard';

  UPDATE public.service_jobs SET finance_flow_version = 2 WHERE job_no IN ('B12TEST-J1','B12TEST-J2');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'B12 SEED S1.2: UPDATE flow=2 โดน % แถว (คาด 2) — ยกเลิกทั้งบล็อก', v_n;
  END IF;

  EXECUTE 'ALTER TABLE public.service_jobs ENABLE TRIGGER trg_service_jobs_metadata_update_guard';

  -- VERIFY trigger กลับมา enabled ('O') ก่อนไปต่อ — ไม่ใช่ = ล้มทั้งบล็อก (rollback ทุกอย่าง)
  SELECT t.tgenabled INTO v_enabled FROM pg_trigger t
   WHERE t.tgrelid = 'public.service_jobs'::regclass
     AND t.tgname = 'trg_service_jobs_metadata_update_guard';
  IF v_enabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'B12 SEED S1.2: trigger ยังไม่ enabled (tgenabled=%) — ยกเลิกทั้งบล็อก', v_enabled;
  END IF;
  RAISE NOTICE 'B12 SEED S1.2 OK: J1,J2 → flow=2 · metadata_update_guard กลับมา enabled=O แล้ว';
END $b12s2$;


-- ────────────────────────────────────────────────────────────────────────────
-- SEED S1.3 — recognition JV ให้ J2 (Dr 1200 / Cr 4220 = total_cost) ใน DO block เดียว
--   trg_je_lines_balance เป็น CONSTRAINT TRIGGER DEFERRED — เช็คตอน COMMIT:
--   header totals ต้องเท่า Σ lines เป๊ะ และ header+lines ต้องอยู่ transaction เดียวกัน
--   idx_je_source_unique: seed ต่อ source ได้ใบเดียว (จงใจ — ตรง invariant จริง)
-- ────────────────────────────────────────────────────────────────────────────
DO $b12s3$
DECLARE
  v_staging_ok boolean := false;
  v_job_id bigint; v_total numeric(14,2);
  v_je_id bigint;
BEGIN
  -- [B12-INTERLOCK] staging เท่านั้น — default = ปฏิเสธ
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM public._staging_b12_sentinel
       WHERE confirm_text = 'B12-STAGING-' || to_char(current_date, 'YYYY-MM-DD')
    ) INTO v_staging_ok;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B12 INTERLOCK: ไม่พบตาราง _staging_b12_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT v_staging_ok THEN
    RAISE EXCEPTION 'B12 INTERLOCK: confirm_text ต้องเป็น B12-STAGING-% (วันนี้เป๊ะ) — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  SELECT id, total_cost INTO v_job_id, v_total FROM public.service_jobs WHERE job_no = 'B12TEST-J2';
  IF v_job_id IS NULL THEN RAISE EXCEPTION 'B12 SEED S1.3: ไม่พบ B12TEST-J2 — รัน S1.1/S1.2 ก่อน'; END IF;

  INSERT INTO public.journal_entries (doc_no, doc_type, doc_date, description, status,
                                      total_debit, total_credit, source_table, source_id)
  VALUES ('B12TEST-JV1', 'SV', date_trunc('month', current_date)::date + 14, 'B12 recognition JV (staging)',
          'approved', v_total, v_total, 'service_jobs', v_job_id)
  RETURNING id INTO v_je_id;

  INSERT INTO public.journal_lines (entry_id, line_no, account_code, debit, credit, description) VALUES
    (v_je_id, 1, '1200', v_total, 0, 'B12 Dr ลูกหนี้การค้า'),
    (v_je_id, 2, '4220', 0, v_total, 'B12 Cr รายได้บริการ');

  RAISE NOTICE 'B12 SEED S1.3 OK: JV % (Dr1200/Cr4220 = %) ผูก J2 — balance check จะยืนยันตอน COMMIT', v_je_id, v_total;
END $b12s3$;


-- ────────────────────────────────────────────────────────────────────────────
-- B12a — J1 (v2 · ไม่มี JV): UPDATE flow 2→1 ต้อง 42501 จาก v2_freeze + zero writes
--   message ต้องมี 'เปลี่ยน finance_flow_version ไม่ได้' (b1.1:126) — พิสูจน์ guard ตัวถูก
--   (metadata_update_guard ปล่อย 2→1 สำหรับ system! — 606a:221-223)
-- ────────────────────────────────────────────────────────────────────────────
DO $b12a$
DECLARE
  v_staging_ok boolean := false;
  v_job_id bigint; v_flow int; v_status text; v_cost numeric; v_note text;
  v_je bigint; v_jl bigint; v_je2 bigint; v_jl2 bigint;
  v_caught boolean := false; v_msg text := '';
BEGIN
  -- [B12-INTERLOCK] staging เท่านั้น — default = ปฏิเสธ
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM public._staging_b12_sentinel
       WHERE confirm_text = 'B12-STAGING-' || to_char(current_date, 'YYYY-MM-DD')
    ) INTO v_staging_ok;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B12 INTERLOCK: ไม่พบตาราง _staging_b12_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT v_staging_ok THEN
    RAISE EXCEPTION 'B12 INTERLOCK: confirm_text ต้องเป็น B12-STAGING-% (วันนี้เป๊ะ) — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  SELECT id, finance_flow_version, status, total_cost, note
    INTO v_job_id, v_flow, v_status, v_cost, v_note
    FROM public.service_jobs WHERE job_no = 'B12TEST-J1';
  IF v_job_id IS NULL OR v_flow IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'B12a: J1 ไม่พร้อม (id=% flow=%) — รัน SEED ก่อน', v_job_id, v_flow;
  END IF;
  SELECT count(*) INTO v_je FROM public.journal_entries;
  SELECT count(*) INTO v_jl FROM public.journal_lines;

  BEGIN
    UPDATE public.service_jobs SET finance_flow_version = 1 WHERE id = v_job_id;
  EXCEPTION WHEN insufficient_privilege THEN   -- SQLSTATE 42501 เท่านั้น
    v_caught := true; v_msg := SQLERRM;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'B12a FAIL: downgrade 2->1 ผ่านได้ — guard v2_freeze ไม่ทำงาน';
  END IF;
  IF position('เปลี่ยน finance_flow_version ไม่ได้' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'B12a FAIL: 42501 มาจาก guard อื่น (msg=%)', v_msg;
  END IF;

  -- zero writes: flow/status/cost/note เดิม + je/jl count เดิม
  PERFORM 1 FROM public.service_jobs
   WHERE id = v_job_id AND finance_flow_version = 2
     AND status = v_status AND total_cost = v_cost AND note IS NOT DISTINCT FROM v_note;
  IF NOT FOUND THEN RAISE EXCEPTION 'B12a FAIL: row J1 ถูกแก้ทั้งที่ 42501'; END IF;
  SELECT count(*) INTO v_je2 FROM public.journal_entries;
  SELECT count(*) INTO v_jl2 FROM public.journal_lines;
  IF v_je2 <> v_je OR v_jl2 <> v_jl THEN RAISE EXCEPTION 'B12a FAIL: je/jl count ขยับ (%/% -> %/%)', v_je, v_jl, v_je2, v_jl2; END IF;

  INSERT INTO public._staging_b12_results (case_id, ok, detail)
  VALUES ('B12a', true, '2->1 (no JV) blocked 42501 by v2_freeze: ' || left(v_msg, 120))
  ON CONFLICT (case_id) DO UPDATE SET ok = EXCLUDED.ok, detail = EXCLUDED.detail, at = now();
  RAISE NOTICE 'B12a PASS: % ', v_msg;
END $b12a$;


-- ────────────────────────────────────────────────────────────────────────────
-- B12b — J2 (v2 · มี JV approved): UPDATE flow 2→1 ต้อง 42501 เหมือน B12a
--   (พิสูจน์ว่า clause ไม่ขึ้นกับ v_recognized/v_has_money — ทั้งสองกิ่ง)
-- ────────────────────────────────────────────────────────────────────────────
DO $b12b$
DECLARE
  v_staging_ok boolean := false;
  v_job_id bigint; v_flow int; v_status text; v_cost numeric; v_note text;
  v_je bigint; v_jl bigint; v_je2 bigint; v_jl2 bigint;
  v_caught boolean := false; v_msg text := '';
BEGIN
  -- [B12-INTERLOCK] staging เท่านั้น — default = ปฏิเสธ
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM public._staging_b12_sentinel
       WHERE confirm_text = 'B12-STAGING-' || to_char(current_date, 'YYYY-MM-DD')
    ) INTO v_staging_ok;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B12 INTERLOCK: ไม่พบตาราง _staging_b12_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT v_staging_ok THEN
    RAISE EXCEPTION 'B12 INTERLOCK: confirm_text ต้องเป็น B12-STAGING-% (วันนี้เป๊ะ) — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  SELECT id, finance_flow_version, status, total_cost, note
    INTO v_job_id, v_flow, v_status, v_cost, v_note
    FROM public.service_jobs WHERE job_no = 'B12TEST-J2';
  IF v_job_id IS NULL OR v_flow IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'B12b: J2 ไม่พร้อม (id=% flow=%) — รัน SEED ก่อน', v_job_id, v_flow;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.journal_entries
                  WHERE source_table = 'service_jobs' AND source_id = v_job_id
                    AND lower(coalesce(status,'')) = 'approved') THEN
    RAISE EXCEPTION 'B12b: J2 ยังไม่มี recognition JV — รัน SEED S1.3 ก่อน (เคสนี้ต้องทดสอบกิ่ง "มี JV")';
  END IF;
  SELECT count(*) INTO v_je FROM public.journal_entries;
  SELECT count(*) INTO v_jl FROM public.journal_lines;

  BEGIN
    UPDATE public.service_jobs SET finance_flow_version = 1 WHERE id = v_job_id;
  EXCEPTION WHEN insufficient_privilege THEN   -- SQLSTATE 42501 เท่านั้น
    v_caught := true; v_msg := SQLERRM;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'B12b FAIL: downgrade 2->1 (มี JV) ผ่านได้ — guard v2_freeze ไม่ทำงาน';
  END IF;
  IF position('เปลี่ยน finance_flow_version ไม่ได้' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'B12b FAIL: 42501 มาจาก guard อื่น (msg=%)', v_msg;
  END IF;

  PERFORM 1 FROM public.service_jobs
   WHERE id = v_job_id AND finance_flow_version = 2
     AND status = v_status AND total_cost = v_cost AND note IS NOT DISTINCT FROM v_note;
  IF NOT FOUND THEN RAISE EXCEPTION 'B12b FAIL: row J2 ถูกแก้ทั้งที่ 42501'; END IF;
  SELECT count(*) INTO v_je2 FROM public.journal_entries;
  SELECT count(*) INTO v_jl2 FROM public.journal_lines;
  IF v_je2 <> v_je OR v_jl2 <> v_jl THEN RAISE EXCEPTION 'B12b FAIL: je/jl count ขยับ (%/% -> %/%)', v_je, v_jl, v_je2, v_jl2; END IF;

  INSERT INTO public._staging_b12_results (case_id, ok, detail)
  VALUES ('B12b', true, '2->1 (with JV) blocked 42501 by v2_freeze: ' || left(v_msg, 120))
  ON CONFLICT (case_id) DO UPDATE SET ok = EXCLUDED.ok, detail = EXCLUDED.detail, at = now();
  RAISE NOTICE 'B12b PASS: %', v_msg;
END $b12b$;


-- ────────────────────────────────────────────────────────────────────────────
-- B12c — J1: UPDATE flow 2→NULL ต้อง 42501 (ไม่ใช่ 23502 not_null_violation)
--   v2_freeze เป็น BEFORE trigger — RAISE ก่อนถึงชั้น NOT NULL constraint
--   (จับเฉพาะ insufficient_privilege: ถ้า 23502 หลุดมา = ทั้งบล็อกล้ม = FAIL ดังตามต้องการ)
-- ────────────────────────────────────────────────────────────────────────────
DO $b12c$
DECLARE
  v_staging_ok boolean := false;
  v_job_id bigint; v_flow int; v_status text; v_cost numeric; v_note text;
  v_je bigint; v_jl bigint; v_je2 bigint; v_jl2 bigint;
  v_caught boolean := false; v_msg text := '';
BEGIN
  -- [B12-INTERLOCK] staging เท่านั้น — default = ปฏิเสธ
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM public._staging_b12_sentinel
       WHERE confirm_text = 'B12-STAGING-' || to_char(current_date, 'YYYY-MM-DD')
    ) INTO v_staging_ok;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B12 INTERLOCK: ไม่พบตาราง _staging_b12_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT v_staging_ok THEN
    RAISE EXCEPTION 'B12 INTERLOCK: confirm_text ต้องเป็น B12-STAGING-% (วันนี้เป๊ะ) — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  SELECT id, finance_flow_version, status, total_cost, note
    INTO v_job_id, v_flow, v_status, v_cost, v_note
    FROM public.service_jobs WHERE job_no = 'B12TEST-J1';
  IF v_job_id IS NULL OR v_flow IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'B12c: J1 ไม่พร้อม (id=% flow=%) — รัน SEED ก่อน', v_job_id, v_flow;
  END IF;
  SELECT count(*) INTO v_je FROM public.journal_entries;
  SELECT count(*) INTO v_jl FROM public.journal_lines;

  BEGIN
    UPDATE public.service_jobs SET finance_flow_version = NULL WHERE id = v_job_id;
  EXCEPTION WHEN insufficient_privilege THEN   -- SQLSTATE 42501 เท่านั้น (23502 = ปล่อยล้มทั้งบล็อก)
    v_caught := true; v_msg := SQLERRM;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'B12c FAIL: 2->NULL ไม่โดน 42501 — guard v2_freeze ไม่ทำงาน (หรือโดน 23502 ซึ่งบล็อกนี้จะล้มไปก่อนถึงบรรทัดนี้)';
  END IF;
  IF position('เปลี่ยน finance_flow_version ไม่ได้' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'B12c FAIL: 42501 มาจาก guard อื่น (msg=%)', v_msg;
  END IF;

  PERFORM 1 FROM public.service_jobs
   WHERE id = v_job_id AND finance_flow_version = 2
     AND status = v_status AND total_cost = v_cost AND note IS NOT DISTINCT FROM v_note;
  IF NOT FOUND THEN RAISE EXCEPTION 'B12c FAIL: row J1 ถูกแก้ทั้งที่ 42501'; END IF;
  SELECT count(*) INTO v_je2 FROM public.journal_entries;
  SELECT count(*) INTO v_jl2 FROM public.journal_lines;
  IF v_je2 <> v_je OR v_jl2 <> v_jl THEN RAISE EXCEPTION 'B12c FAIL: je/jl count ขยับ (%/% -> %/%)', v_je, v_jl, v_je2, v_jl2; END IF;

  INSERT INTO public._staging_b12_results (case_id, ok, detail)
  VALUES ('B12c', true, '2->NULL blocked 42501 (not 23502) by v2_freeze: ' || left(v_msg, 120))
  ON CONFLICT (case_id) DO UPDATE SET ok = EXCLUDED.ok, detail = EXCLUDED.detail, at = now();
  RAISE NOTICE 'B12c PASS: %', v_msg;
END $b12c$;


-- ────────────────────────────────────────────────────────────────────────────
-- B12d — freeze matrix ของงาน v2:
--   d1 J1 (ไม่มี JV) แก้ note                → ผ่าน (early return NOT(recognized OR money))
--   d2 J2 (มี JV) แก้ note (status เดิม→เดิม) → ผ่าน (matrix: เดิม→เดิม)
--   d3 J2 แก้ total_cost                     → 42501 'แก้ยอดเงินไม่ได้' (b1.1:155-157)
--   d4 J2 delivered→done                     → 42501 'เปลี่ยนสถานะงานที่ลงบัญชี' (b1.1:163-168;
--        guard 545 ไม่ block completion→completion และไม่ gate system — 42501 มาจาก matrix แน่)
--   d5 J2 delivered→closed                   → ผ่าน (matrix explicit; 545 ไม่ gate system)
--   ★ d4 ต้องมาก่อน d5 — หลัง d5 สถานะ J2 = closed แล้ว (closed→done = คนละเคส)
-- ────────────────────────────────────────────────────────────────────────────
DO $b12d$
DECLARE
  v_staging_ok boolean := false;
  v_j1 bigint; v_j2 bigint; v_cost numeric;
  v_caught boolean; v_msg text; v_status text;
BEGIN
  -- [B12-INTERLOCK] staging เท่านั้น — default = ปฏิเสธ
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM public._staging_b12_sentinel
       WHERE confirm_text = 'B12-STAGING-' || to_char(current_date, 'YYYY-MM-DD')
    ) INTO v_staging_ok;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B12 INTERLOCK: ไม่พบตาราง _staging_b12_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT v_staging_ok THEN
    RAISE EXCEPTION 'B12 INTERLOCK: confirm_text ต้องเป็น B12-STAGING-% (วันนี้เป๊ะ) — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  SELECT id INTO v_j1 FROM public.service_jobs WHERE job_no = 'B12TEST-J1' AND finance_flow_version = 2;
  SELECT id, total_cost INTO v_j2, v_cost FROM public.service_jobs WHERE job_no = 'B12TEST-J2' AND finance_flow_version = 2 AND status = 'delivered';
  IF v_j1 IS NULL OR v_j2 IS NULL THEN
    RAISE EXCEPTION 'B12d: J1/J2 ไม่พร้อม (ต้อง v2 + J2 ยัง delivered) — รัน SEED และอย่ารัน d ซ้ำหลัง d5';
  END IF;

  -- d1: J1 note → ผ่าน
  UPDATE public.service_jobs SET note = 'B12TEST seed + d1' WHERE id = v_j1;
  PERFORM 1 FROM public.service_jobs WHERE id = v_j1 AND note = 'B12TEST seed + d1';
  IF NOT FOUND THEN RAISE EXCEPTION 'B12d FAIL(d1): แก้ note งาน v2 ไม่มี JV ต้องผ่าน'; END IF;

  -- d2: J2 note (status เดิม→เดิม) → ผ่าน
  UPDATE public.service_jobs SET note = 'B12TEST seed + d2' WHERE id = v_j2;
  PERFORM 1 FROM public.service_jobs WHERE id = v_j2 AND note = 'B12TEST seed + d2';
  IF NOT FOUND THEN RAISE EXCEPTION 'B12d FAIL(d2): แก้ note งาน v2 มี JV (status เดิม) ต้องผ่าน'; END IF;

  -- d3: J2 total_cost → 42501 'แก้ยอดเงินไม่ได้'
  v_caught := false; v_msg := '';
  BEGIN
    UPDATE public.service_jobs SET total_cost = v_cost + 111 WHERE id = v_j2;
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true; v_msg := SQLERRM;
  END;
  IF NOT v_caught THEN RAISE EXCEPTION 'B12d FAIL(d3): แก้ total_cost งานที่มี JV ผ่านได้'; END IF;
  IF position('แก้ยอดเงินไม่ได้' IN v_msg) = 0 THEN RAISE EXCEPTION 'B12d FAIL(d3): msg ไม่ตรง freeze (%)', v_msg; END IF;
  PERFORM 1 FROM public.service_jobs WHERE id = v_j2 AND total_cost = v_cost;
  IF NOT FOUND THEN RAISE EXCEPTION 'B12d FAIL(d3): total_cost ถูกแก้ทั้งที่ 42501'; END IF;

  -- d4: J2 delivered→done → 42501 'เปลี่ยนสถานะงานที่ลงบัญชี' (ต้องมาก่อน d5)
  v_caught := false; v_msg := '';
  BEGIN
    UPDATE public.service_jobs SET status = 'done' WHERE id = v_j2;
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true; v_msg := SQLERRM;
  END;
  IF NOT v_caught THEN RAISE EXCEPTION 'B12d FAIL(d4): delivered->done งานที่ลงบัญชีแล้วผ่านได้'; END IF;
  IF position('เปลี่ยนสถานะงานที่ลงบัญชี' IN v_msg) = 0 THEN RAISE EXCEPTION 'B12d FAIL(d4): msg ไม่ตรง matrix (%)', v_msg; END IF;
  -- ★ exact transition: message ของ matrix มี from/to ในตัว — พิสูจน์ว่า block เกิดที่
  --   delivered->done จริง (ไม่พึ่งลำดับ sub-test)
  IF position('จาก delivered เป็น done' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'B12d FAIL(d4): transition ใน msg ไม่ใช่ delivered->done (%)', v_msg;
  END IF;
  SELECT status INTO v_status FROM public.service_jobs WHERE id = v_j2;
  IF v_status IS DISTINCT FROM 'delivered' THEN
    RAISE EXCEPTION 'B12d FAIL(d4): status ต้องยัง delivered หลังโดน block (ได้ %)', v_status;
  END IF;

  -- d5: J2 delivered→closed → ผ่าน
  UPDATE public.service_jobs SET status = 'closed' WHERE id = v_j2;
  SELECT status INTO v_status FROM public.service_jobs WHERE id = v_j2;
  IF v_status IS DISTINCT FROM 'closed' THEN RAISE EXCEPTION 'B12d FAIL(d5): delivered->closed ต้องผ่าน (ได้ %)', v_status; END IF;

  INSERT INTO public._staging_b12_results (case_id, ok, detail)
  VALUES ('B12d', true, 'd1 note(no-JV) pass · d2 note(JV) pass · d3 total_cost 42501 · d4 delivered->done 42501 · d5 delivered->closed pass')
  ON CONFLICT (case_id) DO UPDATE SET ok = EXCLUDED.ok, detail = EXCLUDED.detail, at = now();
  RAISE NOTICE 'B12d PASS: matrix ครบ 5 ข้อ (J2 ตอนนี้ closed)';
END $b12d$;


-- ────────────────────────────────────────────────────────────────────────────
-- B12e — งานใหม่ J3: INSERT ปกติ (trigger บังคับ flow=1) → UPDATE 1→2 ต้อง 42501
--   จาก guard 606-a — message 'ยังเปิด finance flow v2 ไม่ได้' (606a:216-219;
--   v2_freeze ไม่เกี่ยว — early return เมื่อ OLD.flow=1)
-- ────────────────────────────────────────────────────────────────────────────
DO $b12e$
DECLARE
  v_staging_ok boolean := false;
  v_job_id bigint; v_flow int;
  v_je bigint; v_jl bigint; v_je2 bigint; v_jl2 bigint;
  v_caught boolean := false; v_msg text := '';
BEGIN
  -- [B12-INTERLOCK] staging เท่านั้น — default = ปฏิเสธ
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM public._staging_b12_sentinel
       WHERE confirm_text = 'B12-STAGING-' || to_char(current_date, 'YYYY-MM-DD')
    ) INTO v_staging_ok;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B12 INTERLOCK: ไม่พบตาราง _staging_b12_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT v_staging_ok THEN
    RAISE EXCEPTION 'B12 INTERLOCK: confirm_text ต้องเป็น B12-STAGING-% (วันนี้เป๊ะ) — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  INSERT INTO public.service_jobs (job_no, customer_name, customer_phone, description, status, job_type, total_cost, note)
  VALUES ('B12TEST-J3', 'B12 Staging Test', '0800000003', 'B12 J3 — new job stays v1', 'pending', 'other', 300.00, 'B12TEST seed')
  RETURNING id, finance_flow_version INTO v_job_id, v_flow;

  IF v_flow IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'B12e FAIL: INSERT ใหม่ flow=% (ต้องถูก trigger บังคับ = 1)', v_flow;
  END IF;
  SELECT count(*) INTO v_je FROM public.journal_entries;
  SELECT count(*) INTO v_jl FROM public.journal_lines;

  BEGIN
    UPDATE public.service_jobs SET finance_flow_version = 2 WHERE id = v_job_id;
  EXCEPTION WHEN insufficient_privilege THEN   -- SQLSTATE 42501 เท่านั้น
    v_caught := true; v_msg := SQLERRM;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'B12e FAIL: 1->2 ผ่านได้ — activation gate 606-a ไม่ทำงาน';
  END IF;
  IF position('ยังเปิด finance flow v2 ไม่ได้' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'B12e FAIL: 42501 มาจาก guard อื่น (msg=%)', v_msg;
  END IF;

  PERFORM 1 FROM public.service_jobs WHERE id = v_job_id AND finance_flow_version = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'B12e FAIL: flow ของ J3 ถูกแก้ทั้งที่ 42501'; END IF;
  SELECT count(*) INTO v_je2 FROM public.journal_entries;
  SELECT count(*) INTO v_jl2 FROM public.journal_lines;
  IF v_je2 <> v_je OR v_jl2 <> v_jl THEN RAISE EXCEPTION 'B12e FAIL: je/jl count ขยับ (%/% -> %/%)', v_je, v_jl, v_je2, v_jl2; END IF;

  INSERT INTO public._staging_b12_results (case_id, ok, detail)
  VALUES ('B12e', true, 'new job forced flow=1 · 1->2 blocked 42501 by 606-a gate: ' || left(v_msg, 120))
  ON CONFLICT (case_id) DO UPDATE SET ok = EXCLUDED.ok, detail = EXCLUDED.detail, at = now();
  RAISE NOTICE 'B12e PASS: %', v_msg;
END $b12e$;


-- ────────────────────────────────────────────────────────────────────────────
-- TEARDOWN — ลบเฉพาะ B12TEST-* ตามลำดับ FK (lines → entries → jobs)
--   trg_je_lines_balance ตอน COMMIT: header ถูกลบแล้ว → RETURN NULL (ข้าม — phase498:76-79)
--   period lock: staging ไม่มี row ใน accounting_periods = open (phase88-19-period-close:71-72)
--   ตาราง _staging_b12_results + sentinel เก็บไว้ให้ owner อ่าน/ลบเองตาม runbook
-- ────────────────────────────────────────────────────────────────────────────
DO $b12t$
DECLARE
  v_staging_ok boolean := false;
  v_jl int; v_je int; v_sj int;
BEGIN
  -- [B12-INTERLOCK] staging เท่านั้น — default = ปฏิเสธ
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM public._staging_b12_sentinel
       WHERE confirm_text = 'B12-STAGING-' || to_char(current_date, 'YYYY-MM-DD')
    ) INTO v_staging_ok;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'B12 INTERLOCK: ไม่พบตาราง _staging_b12_sentinel — นี่ไม่ใช่ staging ห้ามรันเด็ดขาด';
  END;
  IF NOT v_staging_ok THEN
    RAISE EXCEPTION 'B12 INTERLOCK: confirm_text ต้องเป็น B12-STAGING-% (วันนี้เป๊ะ) — หยุดทุกกรณี',
      to_char(current_date, 'YYYY-MM-DD');
  END IF;

  DELETE FROM public.journal_lines
   WHERE entry_id IN (SELECT id FROM public.journal_entries WHERE doc_no LIKE 'B12TEST-%');
  GET DIAGNOSTICS v_jl = ROW_COUNT;
  DELETE FROM public.journal_entries WHERE doc_no LIKE 'B12TEST-%';
  GET DIAGNOSTICS v_je = ROW_COUNT;
  DELETE FROM public.service_jobs WHERE job_no LIKE 'B12TEST-%';
  GET DIAGNOSTICS v_sj = ROW_COUNT;

  -- trigger ทุกตัวบน service_jobs ต้องยัง enabled = 'O' หลังจบทุกอย่าง
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = 'public.service_jobs'::regclass
                AND NOT t.tgisinternal AND t.tgenabled IS DISTINCT FROM 'O') THEN
    RAISE EXCEPTION 'B12 TEARDOWN FAIL: มี trigger บน service_jobs ที่ tgenabled != O — ตรวจ S1.2 ด่วน';
  END IF;

  INSERT INTO public._staging_b12_results (case_id, ok, detail)
  VALUES ('TEARDOWN', true, format('deleted jl=%s je=%s service_jobs=%s · triggers ทุกตัว enabled=O', v_jl, v_je, v_sj))
  ON CONFLICT (case_id) DO UPDATE SET ok = EXCLUDED.ok, detail = EXCLUDED.detail, at = now();
  RAISE NOTICE 'B12 TEARDOWN OK: jl=% je=% jobs=% · triggers O ครบ', v_jl, v_je, v_sj;
END $b12t$;


-- ────────────────────────────────────────────────────────────────────────────
-- REPORT — สรุปผลทุก case ตารางเดียว (คาด: B12a-e + TEARDOWN = 6 แถว ok=true)
--   + สถานะ trigger ปัจจุบัน (ต้อง 'O' ทุกตัว)
-- ────────────────────────────────────────────────────────────────────────────
SELECT case_id, ok, detail, at FROM public._staging_b12_results ORDER BY case_id;

SELECT t.tgname, t.tgenabled
  FROM pg_trigger t
 WHERE t.tgrelid = 'public.service_jobs'::regclass AND NOT t.tgisinternal
 ORDER BY t.tgname;
