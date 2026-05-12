-- ═══════════════════════════════════════════════════════════
-- Phase 89.14 (M7) — Global rate limit ของ error_log INSERT
-- ═══════════════════════════════════════════════════════════
-- เหตุผล:
--   error_reporter.js ใหม่ POST ผ่าน /api/log-error (CF proxy ที่ rate limit 60/min/IP)
--   แต่ publishable anon key public อ่านได้ → attacker bypass proxy โดย POST direct ไป
--   /rest/v1/error_log ด้วย anon key → spam ตรง DB ได้
--
--   Trigger นี้เป็น "last line of defense":
--     - global cap 500 inserts/นาที (สำหรับทั้ง app — burst-tolerant)
--     - ถ้าเกิน → RAISE EXCEPTION → INSERT ล้มเหลว
--     - ไม่กระทบ legit traffic (real error rate << 500/min)
--
--   เพิ่ม per-fingerprint cap 100/ชม → ป้องกัน same-error burst ที่ client cap หลุด
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- 1. function check rate limit (global + per fingerprint)
CREATE OR REPLACE FUNCTION public.error_log_rate_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  global_count int;
  fp_count int;
BEGIN
  -- 1a. global cap: 500 rows / 1 min — กัน worldwide spam burst
  SELECT count(*) INTO global_count
  FROM error_log
  WHERE ts > now() - interval '1 minute';

  IF global_count >= 500 THEN
    RAISE EXCEPTION 'error_log global rate limit exceeded (500/min) — drop INSERT'
      USING HINT = 'app should already have client-side throttle; investigate burst source';
  END IF;

  -- 1b. per-fingerprint cap: 100 rows / 1 hr — กัน same-error spam ที่ client dedup หลุด
  IF NEW.fingerprint IS NOT NULL THEN
    SELECT count(*) INTO fp_count
    FROM error_log
    WHERE fingerprint = NEW.fingerprint
      AND ts > now() - interval '1 hour';

    IF fp_count >= 100 THEN
      -- ไม่ throw — เงียบๆ drop เพราะ same error ซ้ำๆ ไม่ใช่ malicious แค่ pollution
      RAISE NOTICE 'error_log fingerprint % exceeded 100/hr — silently dropping', NEW.fingerprint;
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. attach trigger (replace if exists)
DROP TRIGGER IF EXISTS error_log_rate_check ON error_log;

CREATE TRIGGER error_log_rate_check
BEFORE INSERT ON error_log
FOR EACH ROW
EXECUTE FUNCTION public.error_log_rate_check();

-- 3. กรณีไม่อยากเปลี่ยน RLS แต่อยาก audit ใครยิงเข้ามาบ่อย — view ช่วย:
CREATE OR REPLACE VIEW public.error_log_recent_summary AS
SELECT
  date_trunc('minute', ts) AS bucket,
  count(*) AS row_count,
  count(DISTINCT user_id) AS unique_users,
  count(DISTINCT fingerprint) AS unique_fingerprints
FROM error_log
WHERE ts > now() - interval '1 hour'
GROUP BY 1
ORDER BY 1 DESC;

COMMENT ON VIEW public.error_log_recent_summary IS
  'Phase 89.14: ใช้ดูว่า error_log มี traffic burst หรือไม่. Admin query เพื่อตรวจ pattern attacker.';

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- หลังรัน — ไม่จำเป็นต้อง NOTIFY pgrst เพราะไม่ได้ ALTER TABLE
-- Test:
--   INSERT INTO error_log (severity, message, fingerprint) VALUES ('error', 'test', 'x');
--   (ทำ 501 ครั้งใน 1 นาที — รอบที่ 501 จะ fail)
-- ═══════════════════════════════════════════════════════════
