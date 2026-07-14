-- ═══════════════════════════════════════════════════════════════════════════
--  supabase-phase606a-service-finance-foundation.sql
--  Phase 606-a (S4.1d) — SERVICE FINANCE V2 **FOUNDATION ONLY** (additive · fail-closed)
--
--  โมเดลใหม่ (เปิดใช้จริงใน Phase 606-b เท่านั้น):
--    1) ส่งมอบงาน  = รับรู้รายได้      → Dr 1200 ลูกหนี้การค้า / Cr รายได้บริการ 42xx
--    2) รับเงินจริง = ลดลูกหนี้         → Dr เงินสด/ธนาคาร      / Cr 1200
--
--  ★ กติกาเหล็กของเฟสนี้ — "ฐานพร้อมแต่ยังใช้ไม่ได้":
--      - **ไม่มีทางเปิด flow v2 ได้จากเฟสนี้** (INSERT/UPDATE เป็น 2 ถูกปฏิเสธทุก role รวม admin)
--        → Phase 606-b จะ replace guard นี้ในทรานแซกชัน activation เท่านั้น
--      - service_payments ต้อง **ว่างเปล่า** หลังรัน (RPC มีอยู่แต่ใช้กับงานจริงไม่ได้ เพราะบังคับ v2)
--      - ไม่ INSERT/UPDATE/DELETE journal_entries / journal_lines · ไม่โพสต์ JV
--      - ไม่แตะ status/closed_at/total_cost/payment_method ของงานเดิม
--      - ไม่ซ่อม 6 งาน legacy NO_JV (S4.1c ยังพักด้วย SERVICE_RECOVERY_PAUSED_PAYMENT_TRUTH)
--
--  ★ ทั้งไฟล์รันใน transaction เดียว: ล้มที่ไหน = rollback ทั้งชุด
--  ★ ไม่เดา type/FK: preflight อ่านของจริงจาก catalog แล้วสร้าง FK ด้วย type นั้น
--  ★ Backfill idempotent (rerun ได้ — 606-b จะ rerun อีกครั้งสำหรับ row ที่เกิดระหว่างทาง)
--
--  วิธีใช้ (owner):  STEP 0 inspect → รันไฟล์นี้ → VERIFY (count-only) → read-only audit scripts
--  ⚠️ ห้าม mark applied ใน DB_MIGRATIONS_APPLIED.md จนกว่าผล VERIFY จะผ่านครบ
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- STEP 0 — READ-ONLY INSPECT (รันก่อน migration; ไม่เปลี่ยนข้อมูล; count-only ไม่ print PII)
-- ───────────────────────────────────────────────────────────────────────────
/*
-- 0.1 type จริงของ service_jobs.id (FK ของ ledger ต้องตรงตัวนี้)
SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull
FROM pg_attribute a
WHERE a.attrelid = 'public.service_jobs'::regclass AND a.attname IN ('id','total_cost','closed_at','status') AND a.attnum > 0;

-- 0.2 metadata columns มีอยู่แล้วหรือยัง
SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
WHERE table_schema='public' AND table_name='service_jobs'
  AND column_name IN ('source_kind','finance_flow_version','payment_due_date');

-- 0.3 account_mapping columns
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='account_mapping' ORDER BY ordinal_position;

-- 0.4 authority functions (ต้อง SECURITY DEFINER + search_path)
SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('is_admin','is_accountant');

-- 0.5 COA ที่โมเดลใหม่ใช้ + บัญชีธนาคารที่รับโอนได้ (allowlist 1130-1169)
SELECT code, name, type, is_active FROM public.chart_of_accounts
WHERE code = '1200' OR (type='asset' AND code ~ '^11[3-6][0-9]$') ORDER BY code;

-- 0.6 JE source unique index (idempotency ของ writer)
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='idx_je_source_unique';

-- 0.7 service_payments มีอยู่แล้วไหม (ควร "ไม่มี")
SELECT to_regclass('public.service_payments') AS service_payments_exists;

-- 0.8 marker partition (count-only)
SELECT count(*) AS total,
       count(*) FILTER (WHERE job_no ~* '^(AI|SH)-'
                           OR note ILIKE 'AI Sales:%' OR note ILIKE 'AC Shop:%'
                           OR note ILIKE 'SH-transfer|%' OR note ILIKE 'SH-cod_cash|%' OR note ILIKE 'SH-cod_transfer|%'
                           OR coalesce(sub_service,'') LIKE '%สั่งซื้อ%') AS marker_web
FROM public.service_jobs;

-- 0.9 counts ที่ต้องไม่ขยับจาก migration นี้ (จดไว้เทียบหลังรัน)
SELECT (SELECT count(*) FROM public.journal_entries) AS je, (SELECT count(*) FROM public.journal_lines) AS jl;
*/

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) PREFLIGHT — fail-fast (ผิดข้อใดข้อหนึ่ง = ยกเลิกทั้ง migration)
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_id_type    text;
  v_total_type text;
  v_banks      bigint;
BEGIN
  IF to_regclass('public.service_jobs') IS NULL THEN RAISE EXCEPTION 'PREFLIGHT: ไม่พบตาราง public.service_jobs'; END IF;
  IF to_regclass('public.account_mapping') IS NULL THEN RAISE EXCEPTION 'PREFLIGHT: ไม่พบตาราง public.account_mapping'; END IF;
  IF to_regclass('public.chart_of_accounts') IS NULL THEN RAISE EXCEPTION 'PREFLIGHT: ไม่พบตาราง public.chart_of_accounts'; END IF;
  IF to_regclass('public.journal_entries') IS NULL THEN RAISE EXCEPTION 'PREFLIGHT: ไม่พบตาราง public.journal_entries'; END IF;

  -- ★ type ของ service_jobs.id (ห้ามเดา — ledger FK ต้องตรงตัวนี้)
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.service_jobs'::regclass AND a.attname = 'id' AND NOT a.attisdropped;
  IF v_id_type IS NULL THEN RAISE EXCEPTION 'PREFLIGHT: ไม่พบคอลัมน์ service_jobs.id'; END IF;
  IF v_id_type NOT IN ('bigint','integer','smallint') THEN
    RAISE EXCEPTION 'PREFLIGHT: service_jobs.id เป็น % — รองรับเฉพาะ integer family', v_id_type;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_total_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.service_jobs'::regclass AND a.attname = 'total_cost' AND NOT a.attisdropped;
  IF v_total_type IS NULL OR v_total_type NOT LIKE 'numeric%' THEN
    RAISE EXCEPTION 'PREFLIGHT: service_jobs.total_cost ต้องเป็น numeric (พบ %)', coalesce(v_total_type,'ไม่มีคอลัมน์');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid='public.service_jobs'::regclass AND a.attname='closed_at' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'PREFLIGHT: ไม่พบคอลัมน์ service_jobs.closed_at';
  END IF;

  IF to_regprocedure('public.is_admin()') IS NULL THEN RAISE EXCEPTION 'PREFLIGHT: ไม่พบ public.is_admin()'; END IF;
  IF to_regprocedure('public.is_accountant()') IS NULL THEN RAISE EXCEPTION 'PREFLIGHT: ไม่พบ public.is_accountant()'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE code='1200' AND is_active AND type='asset') THEN
    RAISE EXCEPTION 'PREFLIGHT: ต้องมี COA 1200 (asset, active)';
  END IF;

  -- ★ ต้องมีบัญชีธนาคารรับโอนอย่างน้อย 1 บัญชีใน allowlist (1130-1169) มิฉะนั้น transfer ใช้ไม่ได้เลย
  SELECT count(*) INTO v_banks FROM public.chart_of_accounts
   WHERE is_active AND type='asset' AND code ~ '^11[3-6][0-9]$';
  IF v_banks = 0 THEN
    RAISE EXCEPTION 'PREFLIGHT: ไม่พบบัญชีธนาคารที่รับโอนได้ (asset active code 1130-1169)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_je_source_unique') THEN
    RAISE EXCEPTION 'PREFLIGHT: ไม่พบ idx_je_source_unique';
  END IF;

  RAISE NOTICE 'PREFLIGHT ผ่าน: id=% · total_cost=% · bank accounts=%', v_id_type, v_total_type, v_banks;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) service_jobs metadata columns (additive · idempotent)
--    ★ NOT NULL + CHECK ที่ไม่รับ NULL จะถูกใส่ "หลัง backfill" (ขั้นที่ 6)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.service_jobs ADD COLUMN IF NOT EXISTS source_kind           TEXT;
ALTER TABLE public.service_jobs ADD COLUMN IF NOT EXISTS finance_flow_version  SMALLINT;
ALTER TABLE public.service_jobs ADD COLUMN IF NOT EXISTS payment_due_date      DATE;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) canonical source-kind deriver — anchored + case-insensitive (ตรงกับฝั่ง JS /i)
--    ★ identity ไม่ผูกกับ status/cancelled/[ลบแล้ว] (web order ที่ยกเลิก ก็ยังเป็น web_order)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.derive_service_source_kind(
  p_job_no TEXT, p_note TEXT, p_sub_service TEXT
) RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(p_job_no,'') ~* '^(AI|SH)-'                 THEN 'web_order'   -- ai_sales.js / ac_shop.js
    WHEN coalesce(p_note,'')   ILIKE 'AI Sales:%'             THEN 'web_order'
    WHEN coalesce(p_note,'')   ILIKE 'AC Shop:%'              THEN 'web_order'
    WHEN coalesce(p_note,'')   ILIKE 'SH-transfer|%'          THEN 'web_order'   -- customer_dashboard.js
    WHEN coalesce(p_note,'')   ILIKE 'SH-cod_cash|%'          THEN 'web_order'
    WHEN coalesce(p_note,'')   ILIKE 'SH-cod_transfer|%'      THEN 'web_order'
    WHEN coalesce(p_sub_service,'') LIKE '%สั่งซื้อ%'           THEN 'web_order'
    ELSE 'service'
  END
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) INSERT trigger — fail-closed
--    ★ ไม่เชื่อ source_kind จาก client: derive เสมอ; client ส่งค่าที่ "ขัดกับ marker" = 42501
--    ★ finance_flow_version บังคับเป็น 1 ใน Phase 606-a (ส่งค่าอื่นมา = 42501)
--    ★ non-admin ตั้ง payment_due_date ตอน INSERT ไม่ได้ = 42501
--    ★ ไม่แตะ status/closed_at/total_cost/payment_method
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._service_jobs_metadata_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_derived   TEXT;
  v_is_system BOOLEAN := (auth.uid() IS NULL);                       -- service_role / migration
  v_is_admin  BOOLEAN := COALESCE(public.is_admin(), false);         -- fail-closed
BEGIN
  v_derived := public.derive_service_source_kind(NEW.job_no, NEW.note, NEW.sub_service);

  IF NEW.source_kind IS NOT NULL AND NEW.source_kind <> v_derived THEN
    RAISE EXCEPTION 'source_kind ที่ส่งมา (%) ขัดกับข้อมูลงานจริง (%) — ปฏิเสธ', NEW.source_kind, v_derived
      USING ERRCODE = '42501';
  END IF;
  NEW.source_kind := v_derived;   -- ★ derive เสมอ (ไม่เชื่อ client)

  IF NEW.finance_flow_version IS NOT NULL AND NEW.finance_flow_version <> 1 THEN
    RAISE EXCEPTION 'Phase 606-a: finance_flow_version ต้องเป็น 1 เท่านั้น (flow v2 ยังไม่เปิดใช้)'
      USING ERRCODE = '42501';
  END IF;
  NEW.finance_flow_version := 1;

  IF NEW.payment_due_date IS NOT NULL AND NOT (v_is_system OR v_is_admin) THEN
    RAISE EXCEPTION 'เฉพาะแอดมินเท่านั้นที่กำหนดวันครบกำหนดชำระได้' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_service_jobs_metadata_insert ON public.service_jobs;
CREATE TRIGGER trg_service_jobs_metadata_insert
  BEFORE INSERT ON public.service_jobs
  FOR EACH ROW EXECUTE FUNCTION public._service_jobs_metadata_insert();

-- ───────────────────────────────────────────────────────────────────────────
-- 5) UPDATE guard — fail-closed
--    ★ Phase 606-a: **ห้ามเปลี่ยน finance_flow_version เป็น 2 ทุก role** (รวม admin และ service_role)
--      → 606-b เท่านั้นที่จะ REPLACE guard ตัวนี้ในทรานแซกชัน activation
--    ★ non-admin แก้ source_kind / payment_due_date ไม่ได้
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._service_jobs_metadata_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_system BOOLEAN := (auth.uid() IS NULL);
  v_is_admin  BOOLEAN := COALESCE(public.is_admin(), false);
BEGIN
  -- ★ ล็อกแข็ง: ยกระดับเป็น flow v2 ไม่ได้เลยในเฟสนี้ (ทุก role)
  IF NEW.finance_flow_version IS DISTINCT FROM OLD.finance_flow_version THEN
    IF NEW.finance_flow_version = 2 THEN
      RAISE EXCEPTION 'Phase 606-a: ยังเปิด finance flow v2 ไม่ได้ (ต้องรัน activation migration 606-b ก่อน)'
        USING ERRCODE = '42501';
    END IF;
    IF NOT (v_is_system OR v_is_admin) THEN
      RAISE EXCEPTION 'เฉพาะแอดมินเท่านั้นที่แก้ finance_flow_version ได้' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.source_kind IS DISTINCT FROM OLD.source_kind AND NOT (v_is_system OR v_is_admin) THEN
    RAISE EXCEPTION 'เฉพาะแอดมินเท่านั้นที่แก้ source_kind ได้' USING ERRCODE = '42501';
  END IF;

  IF NEW.payment_due_date IS DISTINCT FROM OLD.payment_due_date AND NOT (v_is_system OR v_is_admin) THEN
    RAISE EXCEPTION 'เฉพาะแอดมินเท่านั้นที่แก้ payment_due_date ได้' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_service_jobs_metadata_update_guard ON public.service_jobs;
CREATE TRIGGER trg_service_jobs_metadata_update_guard
  BEFORE UPDATE ON public.service_jobs
  FOR EACH ROW EXECUTE FUNCTION public._service_jobs_metadata_update_guard();

-- ───────────────────────────────────────────────────────────────────────────
-- 6) BACKFILL (idempotent · rerun ได้) แล้วจึงบังคับ NOT NULL + CHECK ที่ไม่รับ NULL
--    ★ ไม่ใช้ status/cancelled/[ลบแล้ว] ในการตัดสิน source_kind
--    ★ ไม่แตะ status/closed_at/total_cost/payment_method
-- ───────────────────────────────────────────────────────────────────────────
UPDATE public.service_jobs
   SET source_kind = public.derive_service_source_kind(job_no, note, sub_service)
 WHERE source_kind IS NULL;

UPDATE public.service_jobs
   SET finance_flow_version = 1
 WHERE finance_flow_version IS NULL;

ALTER TABLE public.service_jobs ALTER COLUMN source_kind          SET NOT NULL;
ALTER TABLE public.service_jobs ALTER COLUMN finance_flow_version SET NOT NULL;

DO $$
BEGIN
  -- CHECK ต้องรับเฉพาะค่าจริง (ไม่อนุญาต NULL) — drop ของเก่าถ้ามีแล้วสร้างใหม่
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname='chk_service_jobs_source_kind' AND conrelid='public.service_jobs'::regclass) THEN
    ALTER TABLE public.service_jobs DROP CONSTRAINT chk_service_jobs_source_kind;
  END IF;
  ALTER TABLE public.service_jobs
    ADD CONSTRAINT chk_service_jobs_source_kind CHECK (source_kind IN ('service','web_order'));

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname='chk_service_jobs_finance_flow_version' AND conrelid='public.service_jobs'::regclass) THEN
    ALTER TABLE public.service_jobs DROP CONSTRAINT chk_service_jobs_finance_flow_version;
  END IF;
  ALTER TABLE public.service_jobs
    ADD CONSTRAINT chk_service_jobs_finance_flow_version CHECK (finance_flow_version IN (1,2));
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 7) account_mapping — recognition_debit_code (ใช้ตอน "ส่งมอบ" ใน flow v2)
--    ★ ห้ามแตะ debit_account_code / transfer_debit_code / credit_account_code เดิม
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.account_mapping ADD COLUMN IF NOT EXISTS recognition_debit_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname='fk_account_mapping_recognition_coa'
                    AND conrelid='public.account_mapping'::regclass) THEN
    ALTER TABLE public.account_mapping
      ADD CONSTRAINT fk_account_mapping_recognition_coa
      FOREIGN KEY (recognition_debit_code) REFERENCES public.chart_of_accounts(code);
  END IF;
END $$;

UPDATE public.account_mapping
   SET recognition_debit_code = '1200'
 WHERE mapping_key LIKE 'service\_%'
   AND recognition_debit_code IS DISTINCT FROM '1200';

-- ───────────────────────────────────────────────────────────────────────────
-- 8) service_payments — append-only ledger (ยังไม่มี caller ในเฟสนี้)
--    ★ FK type = type จริงของ service_jobs.id (อ่านจาก catalog — ไม่เดา)
--    ★ ถ้าตารางมีอยู่แล้ว: **verify โครงสร้างจริงให้ครบ** (ไม่ใช่ NOTICE แล้วข้าม)
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_id_type text;
  v_col_type text;
  v_missing  text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.service_jobs'::regclass AND a.attname='id' AND NOT a.attisdropped;

  IF to_regclass('public.service_payments') IS NULL THEN
    EXECUTE format($f$
      CREATE TABLE public.service_payments (
        id               BIGSERIAL PRIMARY KEY,
        service_job_id   %s NOT NULL REFERENCES public.service_jobs(id) ON DELETE RESTRICT,
        -- ★ finite guard: numeric NaN "มากกว่า" ทุกจำนวน → CHECK (amount > 0) เพียงอย่างเดียวปล่อย NaN ผ่าน
        amount           NUMERIC(14,2) NOT NULL
                           CONSTRAINT chk_service_payments_amount_finite
                           CHECK (amount > 0 AND lower(amount::text) NOT IN ('nan','infinity','-infinity')),
        payment_method   TEXT NOT NULL CHECK (payment_method IN ('cash','transfer')),
        bank_coa_code    TEXT REFERENCES public.chart_of_accounts(code),
        paid_at          TIMESTAMPTZ NOT NULL,
        idempotency_key  UUID NOT NULL,
        slip_url         TEXT,
        note             TEXT,
        created_by       UUID,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_service_payments_bank_by_method CHECK (
          (payment_method = 'cash'     AND bank_coa_code IS NULL) OR
          (payment_method = 'transfer' AND bank_coa_code IS NOT NULL)
        ),
        CONSTRAINT uq_service_payments_job_idem UNIQUE (service_job_id, idempotency_key)
      )
    $f$, v_id_type);
    RAISE NOTICE 'สร้าง service_payments (service_job_id type=%)', v_id_type;
  ELSE
    -- ★ มีอยู่แล้ว → ตรวจโครงสร้างให้ตรงสัญญา (ผิด = rollback ทั้ง migration)
    FOR v_missing IN
      SELECT c FROM unnest(ARRAY['service_job_id','amount','payment_method','bank_coa_code','paid_at',
                                 'idempotency_key','slip_url','note','created_by','created_at']) AS c
      WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                        WHERE a.attrelid='public.service_payments'::regclass AND a.attname=c AND NOT a.attisdropped)
    LOOP
      RAISE EXCEPTION 'service_payments มีอยู่แล้วแต่ขาดคอลัมน์ %', v_missing;
    END LOOP;

    -- ★ type ของทุกคอลัมน์สำคัญต้องตรงสัญญา (ไม่ใช่แค่มีชื่อ)
    FOR v_missing IN
      SELECT x.c FROM (VALUES
        ('service_job_id',  v_id_type),
        ('amount',          'numeric(14,2)'),
        ('payment_method',  'text'),
        ('bank_coa_code',   'text'),
        ('paid_at',         'timestamp with time zone'),
        ('idempotency_key', 'uuid'),
        ('slip_url',        'text'),
        ('note',            'text'),
        ('created_by',      'uuid'),
        ('created_at',      'timestamp with time zone')
      ) AS x(c, want)
      WHERE (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
              WHERE a.attrelid='public.service_payments'::regclass AND a.attname=x.c) <> x.want
    LOOP
      RAISE EXCEPTION 'service_payments.% มี type ไม่ตรงสัญญา', v_missing;
    END LOOP;

    -- ★ NOT NULL ของคอลัมน์บังคับ
    FOR v_missing IN
      SELECT c FROM unnest(ARRAY['service_job_id','amount','payment_method','paid_at','idempotency_key','created_at']) AS c
      WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                        WHERE a.attrelid='public.service_payments'::regclass AND a.attname=c AND a.attnotnull)
    LOOP
      RAISE EXCEPTION 'service_payments.% ต้องเป็น NOT NULL', v_missing;
    END LOOP;

    -- ★ created_at default now()
    IF NOT EXISTS (
      SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
       WHERE d.adrelid='public.service_payments'::regclass AND a.attname='created_at'
         AND pg_get_expr(d.adbin, d.adrelid) ILIKE '%now()%'
    ) THEN
      RAISE EXCEPTION 'service_payments.created_at ต้องมี DEFAULT now()';
    END IF;

    -- ★ PK ต้องเป็น id
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid='public.service_payments'::regclass AND c.contype='p'
         AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                WHERE attrelid=c.conrelid AND attname='id')]::smallint[]
    ) THEN
      RAISE EXCEPTION 'service_payments ต้องมี PRIMARY KEY (id)';
    END IF;

    -- ★ FK bank_coa_code → chart_of_accounts(code)
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid='public.service_payments'::regclass AND c.contype='f'
         AND c.confrelid='public.chart_of_accounts'::regclass
         AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                WHERE attrelid=c.conrelid AND attname='bank_coa_code')]::smallint[]
    ) THEN
      RAISE EXCEPTION 'service_payments ขาด FK bank_coa_code → chart_of_accounts(code)';
    END IF;
    -- ★ พิสูจน์ constraint จาก "นิยามจริง" ไม่ใช่แค่ชื่อ: conkey (คอลัมน์ที่ผูก) + expression + ON DELETE
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid='public.service_payments'::regclass AND c.contype='u'
         AND c.conkey = ARRAY[
               (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='service_job_id'),
               (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='idempotency_key')
             ]::smallint[]
    ) THEN
      RAISE EXCEPTION 'service_payments ขาด UNIQUE (service_job_id, idempotency_key) ที่ผูกคอลัมน์ถูกต้อง';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid='public.service_payments'::regclass AND c.contype='c'
         AND pg_get_constraintdef(c.oid) ILIKE '%payment_method%cash%bank_coa_code IS NULL%'
    ) THEN
      RAISE EXCEPTION 'service_payments ขาด CHECK cash/transfer ↔ bank_coa_code (ตามนิยามจริง)';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid='public.service_payments'::regclass AND c.contype='c'
         AND pg_get_constraintdef(c.oid) ILIKE '%amount%' AND pg_get_constraintdef(c.oid) ILIKE '%nan%'
    ) THEN
      RAISE EXCEPTION 'service_payments ขาด CHECK กัน NaN/Infinity ของ amount';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid='public.service_payments'::regclass AND c.contype='f'
         AND c.confrelid='public.service_jobs'::regclass
         AND c.confdeltype='r'                                                   -- ON DELETE RESTRICT
         AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                WHERE attrelid=c.conrelid AND attname='service_job_id')]::smallint[]
         AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute                  -- ★ ต้องชี้ service_jobs.id จริง
                                 WHERE attrelid='public.service_jobs'::regclass AND attname='id')]::smallint[]
    ) THEN
      RAISE EXCEPTION 'service_payments ขาด FK service_job_id → service_jobs(id) ON DELETE RESTRICT';
    END IF;
    RAISE NOTICE 'service_payments มีอยู่แล้ว — verify โครงสร้างผ่าน (columns/type/unique/check/FK)';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_payments_job     ON public.service_payments(service_job_id);
CREATE INDEX IF NOT EXISTS idx_service_payments_paid_at ON public.service_payments(paid_at);

-- ───────────────────────────────────────────────────────────────────────────
-- 9) RLS — อ่านเฉพาะ admin/accountant · เขียนตรงไม่ได้ (ต้องผ่าน RPC)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.service_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_payments_select_accountant ON public.service_payments;
CREATE POLICY service_payments_select_accountant
  ON public.service_payments
  FOR SELECT
  TO authenticated
  USING (COALESCE(public.is_accountant(), false));   -- fail-closed

REVOKE ALL ON public.service_payments FROM PUBLIC;
REVOKE ALL ON public.service_payments FROM anon;
REVOKE ALL ON public.service_payments FROM authenticated;
GRANT SELECT ON public.service_payments TO authenticated;   -- RLS ยังกรองด้วย is_accountant()

-- ───────────────────────────────────────────────────────────────────────────
-- 10) RPC record_service_payment_v2 — ยังไม่มี caller (บังคับ flow v2 ซึ่งเปิดไม่ได้ในเฟสนี้)
--     ★ authority fail-closed · money guard exact · idempotency ก่อน business-state
--     ★ transfer ต้องเป็นบัญชี "ธนาคาร" จริง (allowlist 1130-1169) — 1200/1300/1170 ต้องไม่ผ่าน
--     ★ ห้ามโพสต์ JV / ไม่แตะ journal / ไม่ PATCH cache ลง service_jobs
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_service_payment_v2(
  p_service_job_id  BIGINT,
  p_amount          NUMERIC,
  p_payment_method  TEXT,
  p_paid_at         TIMESTAMPTZ,
  p_idempotency_key UUID,
  p_bank_coa_code   TEXT DEFAULT NULL,
  p_slip_url        TEXT DEFAULT NULL,
  p_note            TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job      public.service_jobs%ROWTYPE;
  v_amount   NUMERIC(14,2);
  v_paid     NUMERIC(14,2);
  v_total    NUMERIC(14,2);
  v_existing public.service_payments%ROWTYPE;
  v_row      public.service_payments%ROWTYPE;
  v_method   TEXT;
BEGIN
  -- (1) authority — fail-closed (is_admin() คืน NULL ก็ต้องปฏิเสธ)
  IF NOT COALESCE(public.is_admin(), false) THEN
    RAISE EXCEPTION 'เฉพาะแอดมินเท่านั้นที่บันทึกรับชำระได้' USING ERRCODE = '42501';
  END IF;

  -- (2) input normalize/validate (ก่อนแตะข้อมูลใด ๆ)
  v_method := lower(btrim(coalesce(p_payment_method, '')));
  IF v_method NOT IN ('cash','transfer') THEN
    RAISE EXCEPTION 'payment_method ต้องเป็น cash หรือ transfer (ไม่ระบุ/ไม่รู้จัก = ปฏิเสธ ห้าม default เป็นเงินสด)'
      USING ERRCODE = '22023';
  END IF;
  -- ★ NaN/Infinity: PostgreSQL numeric ถือว่า **NaN = NaN** และ **NaN > ตัวเลขทุกตัว**
  --   → `p_amount <> p_amount` ใช้ตรวจ NaN ไม่ได้ และ CHECK (amount > 0) ก็ปล่อย NaN ผ่าน
  --   → ต้องเทียบด้วยข้อความ (lower(value::text)) ซึ่งครอบทั้ง NaN/Infinity/-Infinity แน่นอน
  IF p_amount IS NULL OR lower(p_amount::text) IN ('nan','infinity','-infinity','+infinity') THEN
    RAISE EXCEPTION 'amount ไม่ใช่ตัวเลขที่ใช้ได้ (NaN/Infinity ถูกปฏิเสธ)' USING ERRCODE = '22023';
  END IF;
  v_amount := round(p_amount::numeric, 2);                         -- ★ ปัดหลังกัน NaN/Inf แล้ว
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'amount ต้องมากกว่า 0 หลังปัดเป็นทศนิยม 2 ตำแหน่ง' USING ERRCODE = '22023';
  END IF;
  IF p_paid_at IS NULL OR p_paid_at = 'infinity'::timestamptz OR p_paid_at = '-infinity'::timestamptz THEN
    RAISE EXCEPTION 'paid_at ต้องเป็นเวลาจริง (ห้าม fallback วันสร้างงาน)' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key ต้องระบุ' USING ERRCODE = '22023';
  END IF;
  IF v_method = 'cash' AND p_bank_coa_code IS NOT NULL THEN
    RAISE EXCEPTION 'เงินสดต้องไม่ระบุบัญชีธนาคาร' USING ERRCODE = '22023';
  END IF;
  IF v_method = 'transfer' AND p_bank_coa_code IS NULL THEN
    RAISE EXCEPTION 'โอน/QR ต้องระบุบัญชีธนาคาร (bank_coa_code)' USING ERRCODE = '22023';
  END IF;
  -- ★ การ "ตรวจว่าบัญชีธนาคารยัง active" ทำ **หลัง** idempotency lookup (ขั้นที่ 4)
  --   เพราะถ้าบัญชีถูกปิดภายหลัง retry ของรายการเดิมต้องยังคืน payment เดิมได้ (ไม่ใช่ error)

  -- (3) lock งาน (row lock ก่อนอ่าน ledger — กัน race)
  SELECT * INTO v_job FROM public.service_jobs WHERE id = p_service_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบงาน #%', p_service_job_id USING ERRCODE = 'P0002';
  END IF;

  -- (3b) ★ total_cost ต้อง finite **ก่อน idempotency lookup** — ไม่งั้น retry path จะคืน
  --      outstanding_after = NaN/Infinity หรือกลืน null เป็น 0 (เส้นทางนี้ไม่ผ่าน business-state)
  IF v_job.total_cost IS NULL
     OR lower(v_job.total_cost::text) IN ('nan','infinity','-infinity','+infinity') THEN
    RAISE EXCEPTION 'ยอดงานไม่ใช่ตัวเลขที่ใช้ได้ (null/NaN/Infinity) — รับชำระ/ยืนยันรายการไม่ได้'
      USING ERRCODE = '22023';
  END IF;
  v_total := round(v_job.total_cost, 2);   -- ★ ใช้ค่านี้ทั้ง retry path และ insert path

  -- (4) ★ idempotency ก่อน business-state: retry ต้องคืนของเดิมได้ แม้สถานะงานเปลี่ยนไปแล้ว
  SELECT * INTO v_existing FROM public.service_payments
   WHERE service_job_id = p_service_job_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.amount = v_amount
       AND v_existing.payment_method = v_method
       AND v_existing.bank_coa_code IS NOT DISTINCT FROM p_bank_coa_code
       AND v_existing.paid_at = p_paid_at
       AND v_existing.slip_url IS NOT DISTINCT FROM p_slip_url
       AND v_existing.note IS NOT DISTINCT FROM p_note THEN
      SELECT coalesce(sum(amount),0) INTO v_paid FROM public.service_payments WHERE service_job_id = p_service_job_id;
      RETURN jsonb_build_object(
        'payment_id', v_existing.id, 'inserted', false,
        'paid_total', v_paid,
        'outstanding_after', greatest(v_total - v_paid, 0)   -- ★ v_total ผ่าน finite guard แล้ว (ขั้น 3b)
      );
    END IF;
    RAISE EXCEPTION 'idempotency_key นี้ถูกใช้กับข้อมูลชุดอื่นแล้ว — ปฏิเสธ (ไม่มีการเขียน)' USING ERRCODE = '23505';
  END IF;

  -- (4b) bank allowlist — ตรวจเฉพาะตอนจะ "insert ใหม่" (retry ของเดิมผ่านได้แม้บัญชีถูกปิดภายหลัง)
  --   ★ asset อย่างเดียวไม่พอ — 1170 ภาษีซื้อ / 1200 ลูกหนี้ / 1300 สินค้า ก็เป็น asset
  IF v_method = 'transfer' AND NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
     WHERE code = p_bank_coa_code AND is_active AND type = 'asset' AND code ~ '^11[3-6][0-9]$'
  ) THEN
    RAISE EXCEPTION 'bank_coa_code % ไม่ใช่บัญชีธนาคารที่รับโอนได้ (ต้องเป็น asset active รหัส 1130-1169)', p_bank_coa_code
      USING ERRCODE = '23503';
  END IF;

  -- (5) business-state (เฉพาะกรณีจะ insert ใหม่)
  IF coalesce(v_job.source_kind, 'service') <> 'service' THEN
    RAISE EXCEPTION 'งานนี้เป็น % — รับชำระผ่าน ledger นี้ไม่ได้', v_job.source_kind USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_job.finance_flow_version, 1) <> 2 THEN
    RAISE EXCEPTION 'งานนี้ยังเป็น finance flow v% — ต้อง activate flow v2 (Phase 606-b) ก่อน',
      coalesce(v_job.finance_flow_version, 1) USING ERRCODE = '22023';
  END IF;
  IF lower(coalesce(v_job.status,'')) NOT IN ('done','delivered','closed') THEN
    RAISE EXCEPTION 'งานยังไม่ส่งมอบ (status=%) — รับชำระไม่ได้', v_job.status USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_job.note,'') LIKE '%[ลบแล้ว]%' THEN
    RAISE EXCEPTION 'งานนี้ถูกลบแล้ว — รับชำระไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF v_job.closed_at IS NULL THEN
    RAISE EXCEPTION 'งานยังไม่มีวันปิดงาน (closed_at) — รับชำระไม่ได้' USING ERRCODE = '22023';
  END IF;
  -- (v_total ถูก validate + คำนวณไว้แล้วที่ขั้น 3b — ก่อน idempotency lookup)
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'ยอดงานไม่ถูกต้อง — รับชำระไม่ได้' USING ERRCODE = '22023';
  END IF;

  -- (6) over-pay guard — exact (ledger เป็น NUMERIC(14,2) → ไม่ต้องมี tolerance)
  SELECT coalesce(sum(amount),0) INTO v_paid FROM public.service_payments WHERE service_job_id = p_service_job_id;
  IF v_paid + v_amount > v_total THEN
    RAISE EXCEPTION 'รับชำระเกินยอดค้าง (ยอดงาน % · รับแล้ว % · จะรับเพิ่ม %)', v_total, v_paid, v_amount
      USING ERRCODE = '23514';
  END IF;

  -- (7) insert ledger (append-only) — ไม่แตะ journal / ไม่ PATCH service_jobs
  INSERT INTO public.service_payments
    (service_job_id, amount, payment_method, bank_coa_code, paid_at, idempotency_key, slip_url, note, created_by)
  VALUES
    (p_service_job_id, v_amount, v_method, p_bank_coa_code, p_paid_at, p_idempotency_key, p_slip_url, p_note, auth.uid())
  RETURNING * INTO v_row;

  v_paid := v_paid + v_amount;
  RETURN jsonb_build_object(
    'payment_id', v_row.id, 'inserted', true,
    'paid_total', v_paid,
    'outstanding_after', greatest(v_total - v_paid, 0)     -- ★ outstanding ห้ามติดลบ
  );
END $$;

REVOKE ALL ON FUNCTION public.record_service_payment_v2(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_service_payment_v2(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_service_payment_v2(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 11) POST-CHECK ในทรานแซกชัน — ผิด = rollback ทั้งชุด
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad_kind bigint; v_bad_flow bigint; v_flow2 bigint; v_payments bigint; v_map bigint;
  v_map_total bigint;
  v_notnull  int;    v_trg int;
BEGIN
  SELECT count(*) INTO v_bad_kind FROM public.service_jobs
   WHERE source_kind IS NULL OR source_kind NOT IN ('service','web_order');
  SELECT count(*) INTO v_bad_flow FROM public.service_jobs
   WHERE finance_flow_version IS NULL OR finance_flow_version NOT IN (1,2);
  SELECT count(*) INTO v_flow2    FROM public.service_jobs WHERE finance_flow_version = 2;
  SELECT count(*) INTO v_payments FROM public.service_payments;
  SELECT count(*) INTO v_map FROM public.account_mapping
   WHERE mapping_key LIKE 'service\_%' AND recognition_debit_code IS DISTINCT FROM '1200';
  SELECT count(*) INTO v_map_total FROM public.account_mapping WHERE mapping_key LIKE 'service\_%';

  IF v_bad_kind <> 0 THEN RAISE EXCEPTION 'POST-CHECK: source_kind ว่าง/ไม่ถูกต้อง % แถว', v_bad_kind; END IF;
  IF v_bad_flow <> 0 THEN RAISE EXCEPTION 'POST-CHECK: finance_flow_version ว่าง/ไม่ถูกต้อง % แถว', v_bad_flow; END IF;
  IF v_flow2 <> 0 THEN RAISE EXCEPTION 'POST-CHECK: พบงาน flow v2 % แถว — Phase 606-a ห้ามมี', v_flow2; END IF;
  IF v_payments <> 0 THEN RAISE EXCEPTION 'POST-CHECK: service_payments ต้องว่าง แต่มี % แถว', v_payments; END IF;
  -- ★ ต้องมี service mapping จริงอย่างน้อย 1 (ไม่งั้น "bad = 0" ผ่านได้ทั้งที่ไม่มี mapping เลย)
  IF v_map_total = 0 THEN RAISE EXCEPTION 'POST-CHECK: ไม่พบ account_mapping ของงานบริการ (service_%%) เลย'; END IF;
  IF v_map <> 0 THEN RAISE EXCEPTION 'POST-CHECK: service mapping ที่ยังไม่มี recognition_debit_code=1200 % แถว', v_map; END IF;

  -- NOT NULL จริงบนคอลัมน์ metadata
  SELECT count(*) INTO v_notnull FROM pg_attribute
   WHERE attrelid='public.service_jobs'::regclass AND attname IN ('source_kind','finance_flow_version') AND attnotnull;
  IF v_notnull <> 2 THEN RAISE EXCEPTION 'POST-CHECK: metadata columns ต้องเป็น NOT NULL (พบ % จาก 2)', v_notnull; END IF;

  -- CHECK constraints ต้องมีจริงและผูกกับตารางที่ถูก
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_service_jobs_source_kind'
                   AND conrelid='public.service_jobs'::regclass) THEN
    RAISE EXCEPTION 'POST-CHECK: ไม่พบ chk_service_jobs_source_kind';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_service_jobs_finance_flow_version'
                   AND conrelid='public.service_jobs'::regclass) THEN
    RAISE EXCEPTION 'POST-CHECK: ไม่พบ chk_service_jobs_finance_flow_version';
  END IF;

  -- triggers ต้อง enabled ทั้งสองตัว
  SELECT count(*) INTO v_trg FROM pg_trigger
   WHERE tgrelid='public.service_jobs'::regclass AND NOT tgisinternal
     AND tgname IN ('trg_service_jobs_metadata_insert','trg_service_jobs_metadata_update_guard')
     AND tgenabled <> 'D';
  IF v_trg <> 2 THEN RAISE EXCEPTION 'POST-CHECK: metadata triggers ต้อง enabled ทั้ง 2 ตัว (พบ %)', v_trg; END IF;

  -- ledger schema: unique + check + FK ต้องมี
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.service_payments'::regclass
                   AND conname='uq_service_payments_job_idem' AND contype='u') THEN
    RAISE EXCEPTION 'POST-CHECK: service_payments ขาด UNIQUE(job, idempotency_key)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.service_payments'::regclass
                   AND conname='chk_service_payments_bank_by_method' AND contype='c') THEN
    RAISE EXCEPTION 'POST-CHECK: service_payments ขาด CHECK cash/transfer ↔ bank';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.service_payments'::regclass
                   AND contype='f' AND confrelid='public.service_jobs'::regclass) THEN
    RAISE EXCEPTION 'POST-CHECK: service_payments ขาด FK ไป service_jobs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid='public.service_payments'::regclass AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION 'POST-CHECK: service_payments ต้องเปิด RLS แบบ ENABLE + FORCE';
  END IF;
  -- ★ amount ต้องมี CHECK กัน NaN/Infinity (numeric NaN > 0 เป็นจริง — CHECK amount > 0 อย่างเดียวไม่พอ)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid='public.service_payments'::regclass AND c.contype='c'
                    AND pg_get_constraintdef(c.oid) ILIKE '%nan%') THEN
    RAISE EXCEPTION 'POST-CHECK: service_payments.amount ขาด CHECK กัน NaN/Infinity';
  END IF;
  -- ★ ห้ามมีสิทธิ์เขียนตรงหลุดไปที่ anon/authenticated
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema='public' AND table_name='service_payments'
                AND grantee IN ('anon','authenticated')
                AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')) THEN
    RAISE EXCEPTION 'POST-CHECK: service_payments ต้องไม่มีสิทธิ์เขียนตรงสำหรับ anon/authenticated';
  END IF;

  RAISE NOTICE 'POST-CHECK ผ่าน: metadata NOT NULL · flow2=0 · ledger ว่าง+schema ครบ · triggers enabled · recognition mapping ครบ';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFY (count-only — รันหลัง COMMIT แล้วส่งผลให้ทีม; ไม่ print PII)
-- ═══════════════════════════════════════════════════════════════════════════
/*
-- V1 columns (ต้อง NOT NULL) + constraints
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='service_jobs'
  AND column_name IN ('source_kind','finance_flow_version','payment_due_date');
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid IN ('public.service_jobs'::regclass,'public.account_mapping'::regclass,'public.service_payments'::regclass)
  AND conname IN ('chk_service_jobs_source_kind','chk_service_jobs_finance_flow_version',
                  'fk_account_mapping_recognition_coa','uq_service_payments_job_idem','chk_service_payments_bank_by_method');

-- V2 triggers enabled
SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='public.service_jobs'::regclass AND NOT tgisinternal
  AND tgname IN ('trg_service_jobs_metadata_insert','trg_service_jobs_metadata_update_guard');

-- V3 source_kind partition (null/invalid ต้อง 0)
SELECT count(*) AS total,
       count(*) FILTER (WHERE source_kind='service') AS service_cnt,
       count(*) FILTER (WHERE source_kind='web_order') AS web_cnt,
       count(*) FILTER (WHERE source_kind IS NULL OR source_kind NOT IN ('service','web_order')) AS bad_cnt
FROM public.service_jobs;

-- V4 backfill ตรงกับ deriver (mismatch ต้อง 0)
SELECT count(*) AS mismatch FROM public.service_jobs
WHERE source_kind IS DISTINCT FROM public.derive_service_source_kind(job_no, note, sub_service);

-- V5 flow version (v2 ต้อง 0 · null ต้อง 0)
SELECT count(*) FILTER (WHERE finance_flow_version=1) AS v1,
       count(*) FILTER (WHERE finance_flow_version=2) AS v2,
       count(*) FILTER (WHERE finance_flow_version IS NULL) AS null_cnt FROM public.service_jobs;

-- V6 recognition mapping (ต้อง 1200 ทุก service_% และ mapping เดิมไม่เปลี่ยน)
SELECT mapping_key, debit_account_code, credit_account_code, transfer_debit_code, recognition_debit_code
FROM public.account_mapping WHERE mapping_key LIKE 'service\_%' ORDER BY mapping_key;

-- V7 ledger ต้องว่าง
SELECT count(*) AS service_payments_rows FROM public.service_payments;

-- V8 RLS + grants (ต้องไม่มีสิทธิ์เขียนตรง)
SELECT policyname, cmd, roles, qual FROM pg_policies WHERE schemaname='public' AND tablename='service_payments';
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='service_payments' ORDER BY grantee, privilege_type;

-- V9 RPC hardening
SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='record_service_payment_v2';
SELECT grantee, privilege_type FROM information_schema.role_routine_grants
WHERE routine_schema='public' AND routine_name='record_service_payment_v2';

-- V10 บัญชีต้องไม่ขยับจาก migration (เทียบกับค่าใน STEP 0.9)
SELECT (SELECT count(*) FROM public.journal_entries) AS je, (SELECT count(*) FROM public.journal_lines) AS jl;
*/

-- ═══════════════════════════════════════════════════════════════════════════
--  ROLLBACK GUIDANCE (additive ล้วน → ถอยได้ปลอดภัยตราบใดที่ ledger ยังว่าง)
-- ═══════════════════════════════════════════════════════════════════════════
/*
BEGIN;
  DROP TRIGGER IF EXISTS trg_service_jobs_metadata_update_guard ON public.service_jobs;
  DROP TRIGGER IF EXISTS trg_service_jobs_metadata_insert ON public.service_jobs;
  DROP FUNCTION IF EXISTS public._service_jobs_metadata_update_guard();
  DROP FUNCTION IF EXISTS public._service_jobs_metadata_insert();
  DROP FUNCTION IF EXISTS public.record_service_payment_v2(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT);
  DROP TABLE IF EXISTS public.service_payments;                       -- ต้องว่างอยู่แล้วในเฟสนี้
  ALTER TABLE public.account_mapping DROP CONSTRAINT IF EXISTS fk_account_mapping_recognition_coa;
  ALTER TABLE public.account_mapping DROP COLUMN IF EXISTS recognition_debit_code;
  ALTER TABLE public.service_jobs DROP CONSTRAINT IF EXISTS chk_service_jobs_source_kind;
  ALTER TABLE public.service_jobs DROP CONSTRAINT IF EXISTS chk_service_jobs_finance_flow_version;
  ALTER TABLE public.service_jobs DROP COLUMN IF EXISTS payment_due_date;
  ALTER TABLE public.service_jobs DROP COLUMN IF EXISTS finance_flow_version;
  ALTER TABLE public.service_jobs DROP COLUMN IF EXISTS source_kind;
  DROP FUNCTION IF EXISTS public.derive_service_source_kind(TEXT, TEXT, TEXT);
COMMIT;
NOTIFY pgrst, 'reload schema';
*/
