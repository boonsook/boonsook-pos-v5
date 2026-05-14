-- ═══════════════════════════════════════════════════════════
--  Phase 89.25 — Fix journal_entries / journal_lines INSERT RLS
--  สำหรับ auto-post จาก POS sale (role ≠ admin)
--
--  Symptom:
--    ช่าง / sales role login → ขายเงินสดผ่าน POS → bill บันทึกได้
--    แต่ console error: HTTP 403 "new row violates row-level security
--    policy for table journal_entries" → JV ไม่ลง → P&L ขาด
--
--  Root cause:
--    Phase 88.0 ตั้ง je_admin/jl_admin "FOR ALL → admin only"
--    Phase 88.1a-fix (supabase-phase88-hotfix-rls.sql) ตั้งใจ split
--    policy ให้ INSERT ผ่านได้ถ้ามี source_table + source_id
--    แต่ไฟล์นั้นไม่ได้รัน / ถูก revert / production ยังอยู่ที่ Phase 88.0
--
--  Fix:
--    DROP all existing policies on journal_entries + journal_lines
--    CREATE ใหม่: SELECT/UPDATE/DELETE admin-only, INSERT allow non-admin
--    เฉพาะกรณี auto-post (source_table + source_id ไม่ null)
--
--  How to run:
--    1. Supabase Dashboard → SQL Editor → New query
--    2. Paste ทั้งไฟล์ → Run
--    3. ตรวจ "Success. No rows returned"
--    4. ลอง POS sale อีกครั้ง — console ต้องไม่มี HTTP 403 อีก
--
--  Re-run safe: ใช้ DROP IF EXISTS ทุกตัว
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  1) journal_entries — split policy (admin-only ทุกอย่าง ยกเว้น INSERT)
-- ═══════════════════════════════════════════════════════════

-- Drop ทั้ง legacy + ที่อาจมีจาก hotfix-rls.sql รอบก่อน
DROP POLICY IF EXISTS "je_admin"        ON public.journal_entries;
DROP POLICY IF EXISTS "je_select"       ON public.journal_entries;
DROP POLICY IF EXISTS "je_update"       ON public.journal_entries;
DROP POLICY IF EXISTS "je_delete"       ON public.journal_entries;
DROP POLICY IF EXISTS "je_insert_auto"  ON public.journal_entries;

CREATE POLICY "je_select" ON public.journal_entries
  FOR SELECT TO authenticated
  USING (public.is_accountant());

CREATE POLICY "je_update" ON public.journal_entries
  FOR UPDATE TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());

CREATE POLICY "je_delete" ON public.journal_entries
  FOR DELETE TO authenticated
  USING (public.is_accountant());

-- ★ INSERT: admin/accountant ใส่ได้ทุกอัน
--   user อื่น (cashier/technician/sales) ใส่ได้เฉพาะ auto-post
--   (มี source_table + source_id) — กัน manual JV จาก non-admin
CREATE POLICY "je_insert_auto" ON public.journal_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_accountant()
    OR (source_table IS NOT NULL AND source_id IS NOT NULL)
  );


-- ═══════════════════════════════════════════════════════════
--  2) journal_lines — split policy (เหมือนกับ entries)
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "jl_admin"        ON public.journal_lines;
DROP POLICY IF EXISTS "jl_select"       ON public.journal_lines;
DROP POLICY IF EXISTS "jl_update"       ON public.journal_lines;
DROP POLICY IF EXISTS "jl_delete"       ON public.journal_lines;
DROP POLICY IF EXISTS "jl_insert_auto"  ON public.journal_lines;

CREATE POLICY "jl_select" ON public.journal_lines
  FOR SELECT TO authenticated
  USING (public.is_accountant());

CREATE POLICY "jl_update" ON public.journal_lines
  FOR UPDATE TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());

CREATE POLICY "jl_delete" ON public.journal_lines
  FOR DELETE TO authenticated
  USING (public.is_accountant());

-- ★ INSERT lines: accountant ใส่ทุกอัน
--   user อื่น ใส่ได้เฉพาะ lines ที่ผูกกับ entry ที่มาจาก auto-post
CREATE POLICY "jl_insert_auto" ON public.journal_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_accountant()
    OR EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = entry_id
        AND je.source_table IS NOT NULL
        AND je.source_id IS NOT NULL
    )
  );


-- ═══════════════════════════════════════════════════════════
--  3) account_mapping — SELECT เปิดให้ทุก authenticated
--     (auto_post.js ต้องอ่าน mapping ฝั่ง client ก่อน decide debit/credit)
--     Write ยังจำกัด admin/accountant
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "am_admin"   ON public.account_mapping;
DROP POLICY IF EXISTS "am_select"  ON public.account_mapping;
DROP POLICY IF EXISTS "am_write"   ON public.account_mapping;

CREATE POLICY "am_select" ON public.account_mapping
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "am_write" ON public.account_mapping
  FOR ALL TO authenticated
  USING (public.is_accountant())
  WITH CHECK (public.is_accountant());


-- ═══════════════════════════════════════════════════════════
--  4) Reload PostgREST schema cache (กัน PGRST204)
-- ═══════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════
--  5) Verify — list policies ที่ active บน 2 ตาราง
-- ═══════════════════════════════════════════════════════════
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  permissive
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('journal_entries', 'journal_lines', 'account_mapping')
ORDER BY tablename, cmd;

-- Expected (9 rows):
--   account_mapping  | am_select       | SELECT | PERMISSIVE
--   account_mapping  | am_write        | ALL    | PERMISSIVE
--   journal_entries  | je_delete       | DELETE | PERMISSIVE
--   journal_entries  | je_insert_auto  | INSERT | PERMISSIVE
--   journal_entries  | je_select       | SELECT | PERMISSIVE
--   journal_entries  | je_update       | UPDATE | PERMISSIVE
--   journal_lines    | jl_delete       | DELETE | PERMISSIVE
--   journal_lines    | jl_insert_auto  | INSERT | PERMISSIVE
--   journal_lines    | jl_select       | SELECT | PERMISSIVE
--   journal_lines    | jl_update       | UPDATE | PERMISSIVE
