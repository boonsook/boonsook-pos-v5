-- ═══════════════════════════════════════════════════════════
--  Phase 88.1 HOTFIX — RLS เปิด INSERT auto-post ให้ทำงาน
--  Date: 2026-05-08
--
--  ปัญหา (Phase 88.0):
--    RLS "je_admin" / "jl_admin" ใช้ FOR ALL → INSERT ถูก block
--    เมื่อ user ที่ไม่ใช่ admin (cashier/owner) ทำขาย/รายจ่าย →
--    auto-post JV ตกที่ HTTP 403 → ตาราง journal_entries ว่างเปล่า
--
--  วิธีแก้:
--    Split policy เป็น SELECT/UPDATE/DELETE/INSERT
--    - SELECT/UPDATE/DELETE: เฉพาะ accountant (เหมือนเดิม)
--    - INSERT: accountant OR auto-post ที่ source_table NOT NULL
--      (กัน manual JV ที่มาจาก client โดยไม่มี source — ยังต้อง accountant)
--
--  Pre-req: รัน supabase-phase88-accounting-foundation.sql +
--           supabase-phase88-auto-post.sql ไปแล้ว
-- ═══════════════════════════════════════════════════════════


-- 1) journal_entries — split policy
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

-- ★ INSERT: accountant ใส่ได้ทุกอัน, ส่วน user อื่น (cashier/owner) ใส่ได้
--   เฉพาะ auto-post (มี source_table + source_id)
CREATE POLICY "je_insert_auto" ON public.journal_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_accountant()
    OR (source_table IS NOT NULL AND source_id IS NOT NULL)
  );


-- 2) journal_lines — split policy
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

-- ★ INSERT lines: accountant OR ผูกกับ entry ที่มาจาก auto-post (มี source)
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


-- 3) account_mapping — เปิด SELECT ให้ทุก authenticated user
--    (เพราะ auto_post.js ฝั่ง client ต้องอ่าน mapping เพื่อตัดสินใจ debit/credit)
--    Write/manage ยังเฉพาะ accountant
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


-- 4) Verify policies
SELECT tablename, policyname, cmd, permissive
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('journal_entries','journal_lines','account_mapping')
ORDER BY tablename, cmd;

-- Expected:
--   journal_entries × 4 (SELECT, UPDATE, DELETE, INSERT)
--   journal_lines   × 4 (SELECT, UPDATE, DELETE, INSERT)
--   account_mapping × 2 (SELECT, ALL)
