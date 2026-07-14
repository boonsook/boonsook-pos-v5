-- ═══════════════════════════════════════════════════════════════════════════
--  supabase-phase606a-service-finance-foundation.sql
--  Phase 606-a (S4.1d) — SERVICE FINANCE V2 **FOUNDATION ONLY** (additive, ยังไม่ activate)
--
--  เป้าหมายของโมเดลใหม่ (จะเปิดใช้จริงใน Phase 606-b เท่านั้น):
--    1) ส่งมอบงาน  = รับรู้รายได้      → Dr 1200 ลูกหนี้การค้า / Cr รายได้บริการ 42xx
--    2) รับเงินจริง = ลดลูกหนี้         → Dr เงินสด/ธนาคาร      / Cr 1200
--
--  ★ ไฟล์นี้ **ไม่มี side effect ทางบัญชี**:
--      - ไม่ INSERT/UPDATE/DELETE journal_entries / journal_lines
--      - ไม่โพสต์ JV, ไม่รับชำระจริง, ไม่แตะ status/closed_at/total_cost/payment_method ของงานเดิม
--      - service_payments ต้องยัง **ว่างเปล่า** หลังรัน (ยังไม่มี caller — runtime ยัง flow v1)
--      - ไม่ซ่อม 6 งาน legacy NO_JV (S4.1c ยังถูกพักด้วย SERVICE_RECOVERY_PAUSED_PAYMENT_TRUTH)
--
--  ★ ทั้งไฟล์รันใน transaction เดียว: ล้มที่ไหน = rollback ทั้งชุด (ห้าม partial schema/backfill)
--  ★ ไม่เดา type/FK: preflight ตรวจของจริงก่อน แล้วสร้าง FK ด้วย type ที่อ่านจาก catalog
--  ★ Backfill rerun ได้ (idempotent) — 606-b จะ rerun อีกครั้งสำหรับ row ที่เกิดระหว่างทาง
--
--  วิธีใช้ (owner):
--    STEP 0  รัน "read-only inspect" ด้านล่างก่อน แล้วส่งผลให้ทีมตรวจ
--    STEP 1  รันไฟล์นี้ทั้งไฟล์ (BEGIN…COMMIT)
--    STEP 2  รัน "VERIFY (count-only)" ด้านล่าง แล้วส่งผล
--    STEP 3  รัน read-only audit: npm run verify:reconcile / npm run verify:service-no-jv
--  ⚠️ ห้าม mark ว่า applied ใน DB_MIGRATIONS_APPLIED.md จนกว่าผล VERIFY จะผ่านครบ
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- STEP 0 — READ-ONLY INSPECT (รันก่อน migration; ไม่เปลี่ยนข้อมูล; ไม่ print PII)
-- ───────────────────────────────────────────────────────────────────────────
/*
-- 0.1 type จริงของ service_jobs.id (FK ของ ledger ต้องตรงตัวนี้)
SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type
FROM pg_attribute a
WHERE a.attrelid = 'public.service_jobs'::regclass AND a.attname = 'id' AND a.attnum > 0;

-- 0.2 metadata columns มีอยู่แล้วหรือยัง
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='service_jobs'
  AND column_name IN ('id','status','closed_at','total_cost','payment_method','source_kind','finance_flow_version','payment_due_date');

-- 0.3 account_mapping columns + FK
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='account_mapping' ORDER BY ordinal_position;

-- 0.4 authority functions
SELECT p.proname, p.prosecdef, pg_get_functiondef(p.oid) LIKE '%search_path%' AS has_search_path
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('is_admin','is_accountant');

-- 0.5 COA 1200 ต้องมีและ active + เป็น asset
SELECT code, name, type, is_active FROM public.chart_of_accounts WHERE code IN ('1110','1200');

-- 0.6 JE source unique index (idempotency ของ writer)
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='idx_je_source_unique';

-- 0.7 service_payments มีอยู่แล้วไหม (ควร "ไม่มี")
SELECT to_regclass('public.service_payments') AS service_payments_exists;

-- 0.8 partition ของ marker (count-only, ไม่ดึง note/PII)
SELECT count(*) AS total,
       count(*) FILTER (WHERE job_no ~ '^(AI|SH)-'
                           OR note LIKE 'AI Sales:%' OR note LIKE 'AC Shop:%'
                           OR note LIKE 'SH-transfer|%' OR note LIKE 'SH-cod_cash|%' OR note LIKE 'SH-cod_transfer|%'
                           OR coalesce(sub_service,'') LIKE '%สั่งซื้อ%') AS marker_web,
       count(*) FILTER (WHERE NOT (job_no ~ '^(AI|SH)-'
                           OR note LIKE 'AI Sales:%' OR note LIKE 'AC Shop:%'
                           OR note LIKE 'SH-transfer|%' OR note LIKE 'SH-cod_cash|%' OR note LIKE 'SH-cod_transfer|%'
                           OR coalesce(sub_service,'') LIKE '%สั่งซื้อ%')) AS marker_service
FROM public.service_jobs;

-- 0.9 RLS policies ปัจจุบันของตารางที่เกี่ยว
SELECT tablename, policyname, cmd, roles FROM pg_policies
WHERE schemaname='public' AND tablename IN ('service_jobs','account_mapping','journal_entries');
*/

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) PREFLIGHT — fail-fast (ผิดข้อใดข้อหนึ่ง = ยกเลิกทั้ง migration)
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_id_type   text;
  v_total_type text;
BEGIN
  -- ตารางที่ต้องมี
  IF to_regclass('public.service_jobs') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: ไม่พบตาราง public.service_jobs';
  END IF;
  IF to_regclass('public.account_mapping') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: ไม่พบตาราง public.account_mapping';
  END IF;
  IF to_regclass('public.chart_of_accounts') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: ไม่พบตาราง public.chart_of_accounts';
  END IF;
  IF to_regclass('public.journal_entries') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: ไม่พบตาราง public.journal_entries';
  END IF;

  -- ★ type ของ service_jobs.id (ห้ามเดา — ledger FK ต้องตรงตัวนี้)
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.service_jobs'::regclass AND a.attname = 'id' AND NOT a.attisdropped;
  IF v_id_type IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: ไม่พบคอลัมน์ service_jobs.id';
  END IF;
  IF v_id_type NOT IN ('bigint', 'integer', 'smallint') THEN
    RAISE EXCEPTION 'PREFLIGHT: service_jobs.id เป็น % — รองรับเฉพาะ integer family (ต้องออกแบบ FK ใหม่ก่อน)', v_id_type;
  END IF;

  -- total_cost ต้องเป็น numeric (RPC จะเทียบยอดค้าง)
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_total_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.service_jobs'::regclass AND a.attname = 'total_cost' AND NOT a.attisdropped;
  IF v_total_type IS NULL OR v_total_type NOT LIKE 'numeric%' THEN
    RAISE EXCEPTION 'PREFLIGHT: service_jobs.total_cost ต้องเป็น numeric (พบ %)', coalesce(v_total_type, 'ไม่มีคอลัมน์');
  END IF;

  -- closed_at ต้องมี (ใช้เป็นวันรับรู้รายได้ใน flow v2)
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = 'public.service_jobs'::regclass AND a.attname = 'closed_at' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: ไม่พบคอลัมน์ service_jobs.closed_at';
  END IF;

  -- authority functions
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: ไม่พบ public.is_admin()';
  END IF;
  IF to_regprocedure('public.is_accountant()') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: ไม่พบ public.is_accountant()';
  END IF;

  -- COA ที่โมเดลใหม่ต้องใช้: 1200 ลูกหนี้ (asset, active)
  IF NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
    WHERE code = '1200' AND is_active AND type = 'asset'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: ต้องมี COA 1200 (asset, active) ก่อน — ยังไม่พบ';
  END IF;

  -- idempotency index ของ JV (writer พึ่งอยู่ — ยืนยันว่ายังอยู่)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_je_source_unique') THEN
    RAISE EXCEPTION 'PREFLIGHT: ไม่พบ idx_je_source_unique (idempotency ของ JV)';
  END IF;

  RAISE NOTICE 'PREFLIGHT ผ่าน: service_jobs.id=% · total_cost=%', v_id_type, v_total_type;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) service_jobs — metadata columns (additive, idempotent)
--    source_kind = "แหล่งกำเนิดงาน" (ไม่ใช่สถานะ) · finance_flow_version = โมเดลบัญชีที่ใช้
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.service_jobs ADD COLUMN IF NOT EXISTS source_kind           TEXT;
ALTER TABLE public.service_jobs ADD COLUMN IF NOT EXISTS finance_flow_version  SMALLINT;
ALTER TABLE public.service_jobs ADD COLUMN IF NOT EXISTS payment_due_date      DATE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_service_jobs_source_kind') THEN
    ALTER TABLE public.service_jobs
      ADD CONSTRAINT chk_service_jobs_source_kind
      CHECK (source_kind IS NULL OR source_kind IN ('service','web_order'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_service_jobs_finance_flow_version') THEN
    ALTER TABLE public.service_jobs
      ADD CONSTRAINT chk_service_jobs_finance_flow_version
      CHECK (finance_flow_version IS NULL OR finance_flow_version IN (1,2));
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) canonical source-kind deriver (anchored markers เท่านั้น)
--    ★ marker ต้อง "ขึ้นต้น" — ห้าม substring กลางประโยค
--      ("ลูกค้าถามผ่าน AI Sales: แต่เป็นงานซ่อม" ต้องยังเป็น service)
--    ★ ห้ามผูกกับ status/cancelled/[ลบแล้ว] — identity ไม่ขึ้นกับวงจรชีวิตงาน
--      (web order ที่ถูกยกเลิก ก็ยังเป็น web_order)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.derive_service_source_kind(
  p_job_no      TEXT,
  p_note        TEXT,
  p_sub_service TEXT
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(p_job_no, '') ~ '^(AI|SH)-'                THEN 'web_order'   -- ai_sales.js / ac_shop.js
    WHEN coalesce(p_note, '')   LIKE 'AI Sales:%'            THEN 'web_order'   -- ai_sales.js
    WHEN coalesce(p_note, '')   LIKE 'AC Shop:%'             THEN 'web_order'   -- ac_shop.js
    WHEN coalesce(p_note, '')   LIKE 'SH-transfer|%'         THEN 'web_order'   -- customer_dashboard.js
    WHEN coalesce(p_note, '')   LIKE 'SH-cod_cash|%'         THEN 'web_order'
    WHEN coalesce(p_note, '')   LIKE 'SH-cod_transfer|%'     THEN 'web_order'
    WHEN coalesce(p_sub_service, '') LIKE '%สั่งซื้อ%'          THEN 'web_order'
    ELSE 'service'
  END
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) triggers — เติม metadata ตอน INSERT + ล็อก metadata ตอน UPDATE
--    ★ ห้าม DEFAULT 'service' เฉย ๆ (client เก่าไม่ส่ง field → web order จะถูกจัดผิดประเภท)
--    ★ trigger ต้องไม่แตะ status/closed_at/total_cost/payment_method
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._service_jobs_metadata_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- source_kind: client ส่งมาได้แต่ต้อง valid; ไม่ส่ง = derive จาก marker
  IF NEW.source_kind IS NULL OR NEW.source_kind NOT IN ('service','web_order') THEN
    NEW.source_kind := public.derive_service_source_kind(NEW.job_no, NEW.note, NEW.sub_service);
  END IF;
  -- finance_flow_version: Phase 606-a ยังไม่มี flow 2 → default 1 เสมอ
  IF NEW.finance_flow_version IS NULL THEN
    NEW.finance_flow_version := 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_service_jobs_metadata_insert ON public.service_jobs;
CREATE TRIGGER trg_service_jobs_metadata_insert
  BEFORE INSERT ON public.service_jobs
  FOR EACH ROW EXECUTE FUNCTION public._service_jobs_metadata_insert();

-- UPDATE guard: non-admin (client) ห้ามแก้ metadata การเงินผ่าน REST ตรง ๆ
--   auth.uid() IS NULL = service_role / migration context → ผ่าน (pattern เดียวกับ guard เดิม)
CREATE OR REPLACE FUNCTION public._service_jobs_metadata_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;   -- service_role / admin
  END IF;
  IF NEW.source_kind IS DISTINCT FROM OLD.source_kind THEN
    RAISE EXCEPTION 'เฉพาะแอดมินเท่านั้นที่แก้ source_kind ได้' USING ERRCODE = '42501';
  END IF;
  IF NEW.finance_flow_version IS DISTINCT FROM OLD.finance_flow_version THEN
    RAISE EXCEPTION 'เฉพาะแอดมินเท่านั้นที่แก้ finance_flow_version ได้' USING ERRCODE = '42501';
  END IF;
  IF NEW.payment_due_date IS DISTINCT FROM OLD.payment_due_date THEN
    RAISE EXCEPTION 'เฉพาะแอดมินเท่านั้นที่แก้ payment_due_date ได้' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_service_jobs_metadata_update_guard ON public.service_jobs;
CREATE TRIGGER trg_service_jobs_metadata_update_guard
  BEFORE UPDATE ON public.service_jobs
  FOR EACH ROW EXECUTE FUNCTION public._service_jobs_metadata_update_guard();

-- ───────────────────────────────────────────────────────────────────────────
-- 5) BACKFILL metadata ของงานเดิม (idempotent · rerun ได้ · เฉพาะ row ที่ยังว่าง)
--    ★ ไม่แตะ status/closed_at/total_cost/payment_method
--    ★ ไม่ใช้ status/cancelled/[ลบแล้ว] ในการตัดสิน source_kind
-- ───────────────────────────────────────────────────────────────────────────
UPDATE public.service_jobs
   SET source_kind = public.derive_service_source_kind(job_no, note, sub_service)
 WHERE source_kind IS NULL;

UPDATE public.service_jobs
   SET finance_flow_version = 1
 WHERE finance_flow_version IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 6) account_mapping — recognition_debit_code (ใช้ตอน "ส่งมอบ" ใน flow v2)
--    ★ ห้ามแตะ debit_account_code / transfer_debit_code / credit_account_code เดิม
--      (writer v1 ยังใช้อยู่ระหว่าง 606-a → 606-b)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.account_mapping
  ADD COLUMN IF NOT EXISTS recognition_debit_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_account_mapping_recognition_coa') THEN
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
-- 7) service_payments — append-only ledger (ยังไม่มี caller ใน Phase 606-a)
--    ★ FK type = type จริงของ service_jobs.id (อ่านจาก catalog — ไม่เดา)
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_id_type text;
BEGIN
  IF to_regclass('public.service_payments') IS NOT NULL THEN
    RAISE NOTICE 'service_payments มีอยู่แล้ว — ข้ามการสร้าง (idempotent)';
    RETURN;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.service_jobs'::regclass AND a.attname = 'id' AND NOT a.attisdropped;

  EXECUTE format($f$
    CREATE TABLE public.service_payments (
      id               BIGSERIAL PRIMARY KEY,
      service_job_id   %s NOT NULL REFERENCES public.service_jobs(id) ON DELETE RESTRICT,
      amount           NUMERIC(14,2) NOT NULL CHECK (amount > 0),
      payment_method   TEXT NOT NULL CHECK (payment_method IN ('cash','transfer')),
      bank_coa_code    TEXT REFERENCES public.chart_of_accounts(code),
      paid_at          TIMESTAMPTZ NOT NULL,
      idempotency_key  UUID NOT NULL,
      slip_url         TEXT,
      note             TEXT,
      created_by       UUID,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- cash ห้ามมีบัญชีธนาคาร · transfer ต้องมี (ห้าม fallback เป็นเงินสด)
      CONSTRAINT chk_service_payments_bank_by_method CHECK (
        (payment_method = 'cash'     AND bank_coa_code IS NULL) OR
        (payment_method = 'transfer' AND bank_coa_code IS NOT NULL)
      ),
      -- งานหนึ่งรับเงินได้หลายงวด → unique ที่ (job, idempotency_key) ไม่ใช่ (job) เดี่ยว
      CONSTRAINT uq_service_payments_job_idem UNIQUE (service_job_id, idempotency_key)
    )
  $f$, v_id_type);

  RAISE NOTICE 'สร้าง service_payments (service_job_id type=%)', v_id_type;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_payments_job     ON public.service_payments(service_job_id);
CREATE INDEX IF NOT EXISTS idx_service_payments_paid_at ON public.service_payments(paid_at);

-- ───────────────────────────────────────────────────────────────────────────
-- 8) RLS — อ่านได้เฉพาะ admin/accountant · เขียนตรงไม่ได้เลย (ต้องผ่าน RPC)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.service_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_payments_select_accountant ON public.service_payments;
CREATE POLICY service_payments_select_accountant
  ON public.service_payments
  FOR SELECT
  TO authenticated
  USING (public.is_accountant());   -- is_accountant() = role IN ('admin','accountant')

-- ★ ไม่มี policy INSERT/UPDATE/DELETE โดยเจตนา → REST เขียนตรงไม่ได้ (ledger append-only ผ่าน RPC)
REVOKE ALL ON public.service_payments FROM PUBLIC;
REVOKE ALL ON public.service_payments FROM anon;
REVOKE ALL ON public.service_payments FROM authenticated;
GRANT SELECT ON public.service_payments TO authenticated;   -- RLS ยังกรองด้วย is_accountant()

-- ───────────────────────────────────────────────────────────────────────────
-- 9) RPC record_service_payment_v2 — บันทึกรับชำระ (ยังไม่มี caller ใน 606-a)
--    ★ ใช้กับงานจริงตอนนี้ไม่ได้: ทุก row เป็น finance_flow_version=1 → RPC จะปฏิเสธ
--    ★ ห้ามโพสต์ JV ใน RPC (canonical writer เท่านั้น — Phase 606-b)
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job        public.service_jobs%ROWTYPE;
  v_amount     NUMERIC(14,2);
  v_paid       NUMERIC(14,2);
  v_existing   public.service_payments%ROWTYPE;
  v_row        public.service_payments%ROWTYPE;
  v_method     TEXT;
BEGIN
  -- (1) authority
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'เฉพาะแอดมินเท่านั้นที่บันทึกรับชำระได้' USING ERRCODE = '42501';
  END IF;

  -- (2) input normalize/validate
  v_method := lower(btrim(coalesce(p_payment_method, '')));
  IF v_method NOT IN ('cash','transfer') THEN
    RAISE EXCEPTION 'payment_method ต้องเป็น cash หรือ transfer (ไม่ระบุ/ไม่รู้จัก = ปฏิเสธ ห้าม default เป็นเงินสด)'
      USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount ต้องมากกว่า 0' USING ERRCODE = '22023';
  END IF;
  v_amount := round(p_amount::numeric, 2);
  IF p_paid_at IS NULL THEN
    RAISE EXCEPTION 'paid_at ต้องระบุ (ห้าม fallback วันสร้างงาน)' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key ต้องระบุ' USING ERRCODE = '22023';
  END IF;
  IF v_method = 'cash' AND p_bank_coa_code IS NOT NULL THEN
    RAISE EXCEPTION 'เงินสดต้องไม่ระบุบัญชีธนาคาร' USING ERRCODE = '22023';
  END IF;
  IF v_method = 'transfer' THEN
    IF p_bank_coa_code IS NULL THEN
      RAISE EXCEPTION 'โอน/QR ต้องระบุบัญชีธนาคาร (bank_coa_code)' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.chart_of_accounts
      WHERE code = p_bank_coa_code AND is_active AND type = 'asset'
    ) THEN
      RAISE EXCEPTION 'bank_coa_code % ไม่ใช่บัญชีสินทรัพย์ที่ active', p_bank_coa_code USING ERRCODE = '23503';
    END IF;
  END IF;

  -- (3) lock งาน + ตรวจสิทธิ์เชิงธุรกิจ
  SELECT * INTO v_job FROM public.service_jobs WHERE id = p_service_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบงาน #%', p_service_job_id USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(v_job.source_kind, 'service') <> 'service' THEN
    RAISE EXCEPTION 'งานนี้เป็น % — รับชำระผ่าน ledger นี้ไม่ได้', v_job.source_kind USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_job.finance_flow_version, 1) <> 2 THEN
    RAISE EXCEPTION 'งานนี้ยังเป็น finance flow v% — ต้อง activate flow v2 (Phase 606-b) ก่อนจึงรับชำระผ่าน ledger ได้',
      coalesce(v_job.finance_flow_version, 1) USING ERRCODE = '22023';
  END IF;
  IF lower(coalesce(v_job.status, '')) NOT IN ('done','delivered','closed') THEN
    RAISE EXCEPTION 'งานยังไม่ส่งมอบ (status=%) — รับชำระไม่ได้', v_job.status USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_job.note, '') LIKE '%[ลบแล้ว]%' THEN
    RAISE EXCEPTION 'งานนี้ถูกลบแล้ว — รับชำระไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF v_job.closed_at IS NULL THEN
    RAISE EXCEPTION 'งานยังไม่มีวันปิดงาน (closed_at) — รับชำระไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF v_job.total_cost IS NULL OR v_job.total_cost <= 0 THEN
    RAISE EXCEPTION 'ยอดงานไม่ถูกต้อง — รับชำระไม่ได้' USING ERRCODE = '22023';
  END IF;

  -- (4) idempotency: key เดิม + payload เดิม = คืนของเดิม · payload ต่าง = conflict (zero writes)
  SELECT * INTO v_existing FROM public.service_payments
   WHERE service_job_id = p_service_job_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.amount = v_amount
       AND v_existing.payment_method = v_method
       AND v_existing.bank_coa_code IS NOT DISTINCT FROM p_bank_coa_code
       AND v_existing.paid_at = p_paid_at THEN
      SELECT coalesce(sum(amount), 0) INTO v_paid FROM public.service_payments WHERE service_job_id = p_service_job_id;
      RETURN jsonb_build_object(
        'payment_id', v_existing.id, 'inserted', false,
        'paid_total', v_paid, 'outstanding_after', round(v_job.total_cost - v_paid, 2)
      );
    END IF;
    RAISE EXCEPTION 'idempotency_key นี้ถูกใช้กับข้อมูลชุดอื่นแล้ว — ปฏิเสธ (ไม่มีการเขียน)' USING ERRCODE = '23505';
  END IF;

  -- (5) over-pay guard (คำนวณใต้ row lock)
  SELECT coalesce(sum(amount), 0) INTO v_paid FROM public.service_payments WHERE service_job_id = p_service_job_id;
  IF v_paid + v_amount > round(v_job.total_cost, 2) + 0.01 THEN
    RAISE EXCEPTION 'รับชำระเกินยอดค้าง (ยอดงาน % · รับแล้ว % · จะรับเพิ่ม %)',
      round(v_job.total_cost, 2), v_paid, v_amount USING ERRCODE = '23514';
  END IF;

  -- (6) insert ledger (append-only) — ★ ไม่แตะ journal_entries/journal_lines และไม่ PATCH service_jobs
  INSERT INTO public.service_payments
    (service_job_id, amount, payment_method, bank_coa_code, paid_at, idempotency_key, slip_url, note, created_by)
  VALUES
    (p_service_job_id, v_amount, v_method, p_bank_coa_code, p_paid_at, p_idempotency_key, p_slip_url, p_note, auth.uid())
  RETURNING * INTO v_row;

  v_paid := v_paid + v_amount;
  RETURN jsonb_build_object(
    'payment_id', v_row.id, 'inserted', true,
    'paid_total', v_paid, 'outstanding_after', round(v_job.total_cost - v_paid, 2)
  );
END $$;

REVOKE ALL ON FUNCTION public.record_service_payment_v2(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_service_payment_v2(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_service_payment_v2(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 10) POST-CHECK ในทรานแซกชัน — ผิด = rollback ทั้งชุด
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_null_kind   bigint;
  v_null_flow   bigint;
  v_flow2       bigint;
  v_payments    bigint;
  v_map_missing bigint;
BEGIN
  SELECT count(*) INTO v_null_kind FROM public.service_jobs WHERE source_kind IS NULL;
  SELECT count(*) INTO v_null_flow FROM public.service_jobs WHERE finance_flow_version IS NULL;
  SELECT count(*) INTO v_flow2     FROM public.service_jobs WHERE finance_flow_version = 2;
  SELECT count(*) INTO v_payments  FROM public.service_payments;
  SELECT count(*) INTO v_map_missing FROM public.account_mapping
    WHERE mapping_key LIKE 'service\_%' AND recognition_debit_code IS DISTINCT FROM '1200';

  IF v_null_kind <> 0 THEN RAISE EXCEPTION 'POST-CHECK: source_kind ยังว่าง % แถว', v_null_kind; END IF;
  IF v_null_flow <> 0 THEN RAISE EXCEPTION 'POST-CHECK: finance_flow_version ยังว่าง % แถว', v_null_flow; END IF;
  IF v_flow2 <> 0 THEN RAISE EXCEPTION 'POST-CHECK: พบงาน flow v2 % แถว — Phase 606-a ห้ามสร้าง flow 2', v_flow2; END IF;
  IF v_payments <> 0 THEN RAISE EXCEPTION 'POST-CHECK: service_payments ต้องว่าง แต่มี % แถว', v_payments; END IF;
  IF v_map_missing <> 0 THEN RAISE EXCEPTION 'POST-CHECK: service mapping ที่ยังไม่มี recognition_debit_code=1200 % แถว', v_map_missing; END IF;

  RAISE NOTICE 'POST-CHECK ผ่าน: metadata ครบ · flow2=0 · payments=0 · recognition mapping ครบ';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFY (count-only — รันหลัง COMMIT แล้วส่งผลให้ทีม; ไม่ print PII)
-- ═══════════════════════════════════════════════════════════════════════════
/*
-- V1 columns + constraints
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='service_jobs'
  AND column_name IN ('source_kind','finance_flow_version','payment_due_date');
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname IN ('chk_service_jobs_source_kind','chk_service_jobs_finance_flow_version','fk_account_mapping_recognition_coa');

-- V2 triggers active
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid='public.service_jobs'::regclass AND NOT tgisinternal
  AND tgname IN ('trg_service_jobs_metadata_insert','trg_service_jobs_metadata_update_guard');

-- V3 source_kind partition (ต้องรวมได้เท่ากับ total; ไม่มี null/invalid)
SELECT count(*) AS total,
       count(*) FILTER (WHERE source_kind='service')   AS service_cnt,
       count(*) FILTER (WHERE source_kind='web_order') AS web_cnt,
       count(*) FILTER (WHERE source_kind IS NULL)     AS null_cnt,
       count(*) FILTER (WHERE source_kind NOT IN ('service','web_order')) AS invalid_cnt
FROM public.service_jobs;

-- V4 marker-derived เทียบกับที่ backfill ลงไป (ต้องตรงกัน 0 mismatch)
SELECT count(*) AS mismatch FROM public.service_jobs
WHERE source_kind IS DISTINCT FROM public.derive_service_source_kind(job_no, note, sub_service);

-- V5 finance_flow_version partition (v2 ต้อง = 0 ในเฟสนี้)
SELECT count(*) FILTER (WHERE finance_flow_version=1) AS v1,
       count(*) FILTER (WHERE finance_flow_version=2) AS v2,
       count(*) FILTER (WHERE finance_flow_version IS NULL) AS null_cnt
FROM public.service_jobs;

-- V6 recognition mapping
SELECT mapping_key, debit_account_code, credit_account_code, transfer_debit_code, recognition_debit_code
FROM public.account_mapping WHERE mapping_key LIKE 'service\_%' ORDER BY mapping_key;

-- V7 ledger ต้องว่าง
SELECT count(*) AS service_payments_rows FROM public.service_payments;

-- V8 RLS + grants
SELECT policyname, cmd, roles, qual FROM pg_policies WHERE schemaname='public' AND tablename='service_payments';
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='service_payments' ORDER BY grantee, privilege_type;

-- V9 RPC hardening
SELECT p.proname, p.prosecdef,
       (SELECT array_agg(x) FROM unnest(p.proconfig) x) AS config
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='record_service_payment_v2';
SELECT grantee, privilege_type FROM information_schema.role_routine_grants
WHERE routine_schema='public' AND routine_name='record_service_payment_v2';

-- V10 บัญชีต้องไม่ขยับจาก migration นี้ (เทียบกับค่าที่จดไว้ก่อนรัน)
SELECT count(*) AS journal_entries, (SELECT count(*) FROM public.journal_lines) AS journal_lines
FROM public.journal_entries;
*/

-- ═══════════════════════════════════════════════════════════════════════════
--  ROLLBACK GUIDANCE (ถ้าจำเป็นต้องถอย — ทำใน transaction เดียวเช่นกัน)
--  ★ ปลอดภัยเพราะเฟสนี้ additive ล้วน: ไม่มีข้อมูลเดิมถูกแก้ (นอกจาก metadata ใหม่ที่เพิ่งเติม)
-- ═══════════════════════════════════════════════════════════════════════════
/*
BEGIN;
  DROP TRIGGER IF EXISTS trg_service_jobs_metadata_update_guard ON public.service_jobs;
  DROP TRIGGER IF EXISTS trg_service_jobs_metadata_insert ON public.service_jobs;
  DROP FUNCTION IF EXISTS public._service_jobs_metadata_update_guard();
  DROP FUNCTION IF EXISTS public._service_jobs_metadata_insert();
  DROP FUNCTION IF EXISTS public.record_service_payment_v2(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT);
  DROP TABLE IF EXISTS public.service_payments;                     -- ต้องว่างอยู่แล้วในเฟสนี้
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
