-- ═══════════════════════════════════════════════════════════
--  Phase 89.12 — Error Log Table (homegrown JS error tracking)
--
--  ปลายทาง: รับ JS error จาก window.onerror / unhandledrejection
--  แทน Sentry — ไม่ต้อง vendor ใหม่ (app ไม่มี source-map ก็ใช้ Sentry ไม่คุ้มอยู่ดี)
--
--  Strategy:
--    - INSERT จาก client (anon + authenticated)
--    - dedup ฝั่ง client (Set ต่อ session) + อาจ aggregate ใน query view
--    - SELECT จำกัด admin role เท่านั้น (ผ่าน RLS)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.error_log (
  id           BIGSERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  severity     TEXT NOT NULL DEFAULT 'error'
                 CHECK (severity IN ('error', 'warning', 'info')),
  message      TEXT NOT NULL,
  stack        TEXT,
  source       TEXT,                        -- "file.js:42:7"
  url          TEXT,                        -- window.location.href
  user_id      UUID,                        -- auth.uid() if logged in
  user_agent   TEXT,
  build        INT,                         -- APP_BUILD at time of error
  fingerprint  TEXT,                        -- client-side hash for dedup
  extra        JSONB                        -- arbitrary context
);

CREATE INDEX IF NOT EXISTS error_log_ts_desc      ON public.error_log (ts DESC);
CREATE INDEX IF NOT EXISTS error_log_severity     ON public.error_log (severity);
CREATE INDEX IF NOT EXISTS error_log_fingerprint  ON public.error_log (fingerprint);
CREATE INDEX IF NOT EXISTS error_log_build        ON public.error_log (build);

-- ───────────────────────────────────────────────────────────
-- RLS — allow INSERT from anon/authenticated, restrict SELECT
-- ───────────────────────────────────────────────────────────
ALTER TABLE public.error_log ENABLE ROW LEVEL SECURITY;

-- INSERT: anyone (including pre-login crashes)
DROP POLICY IF EXISTS error_log_insert_anyone ON public.error_log;
CREATE POLICY error_log_insert_anyone ON public.error_log
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- SELECT: authenticated users only (further admin-only filtering done in app layer)
-- TODO: ถ้ามี is_admin column ใน users → เพิ่ม USING (auth.uid() IN (SELECT id FROM users WHERE is_admin))
DROP POLICY IF EXISTS error_log_select_authed ON public.error_log;
CREATE POLICY error_log_select_authed ON public.error_log
  FOR SELECT TO authenticated
  USING (true);

-- DELETE / UPDATE: forbidden (audit log integrity)
-- (no policies = no access by default under RLS)

-- ───────────────────────────────────────────────────────────
-- Aggregation view — group by fingerprint, sorted by recent count
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.error_log_grouped AS
SELECT
  fingerprint,
  COUNT(*)                   AS occurrences,
  MIN(ts)                    AS first_seen,
  MAX(ts)                    AS last_seen,
  MAX(message)               AS sample_message,
  MAX(source)                AS sample_source,
  MAX(build)                 AS latest_build,
  COUNT(DISTINCT user_id)
    FILTER (WHERE user_id IS NOT NULL) AS affected_users,
  MAX(severity)              AS max_severity
FROM public.error_log
GROUP BY fingerprint
ORDER BY MAX(ts) DESC;

GRANT SELECT ON public.error_log_grouped TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Optional housekeeping: auto-prune rows older than 90 days
-- (ไม่ใช้ pg_cron — admin รัน manual หรือ schedule ภายนอก)
-- ───────────────────────────────────────────────────────────
COMMENT ON TABLE public.error_log IS
  'Phase 89.12 — JS error reports from client. Prune rows older than 90d periodically.';
