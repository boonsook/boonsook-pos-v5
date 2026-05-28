-- ═══════════════════════════════════════════════════════════
--  Phase 92.46b — Diagnostic ONLY (v2 — read-only inspection)
--
--  Apply: Supabase Dashboard → SQL Editor → paste ทั้งไฟล์ → Run
--  Output: 5 result tabs (A)(B)(C)(D)(E) — paste กลับมาให้ Claude วิเคราะห์
--
--  Most likely suspects (PostgreSQL RLS combine = PERMISSIVE OR + RESTRICTIVE AND):
--    #1 RESTRICTIVE policy ค้าง → ตรวจ (A) column polpermissive
--    #2 Table-level GRANT INSERT หาย → ตรวจ (B)
--    #3 Policy role target mismatch → ตรวจ (A) column roles
--    #4 FORCE RLS + owner mismatch → ตรวจ (C)
--    #5 is_accountant() logic ผิด → ตรวจ (D)
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  (A) ALL policies on journal_entries + journal_lines
--      ★ MOST LIKELY SUSPECT — สแกน column polpermissive
--        false = RESTRICTIVE policy (AND-combined → block sales)
-- ═══════════════════════════════════════════════════════════
SELECT n.nspname                                  AS schema,
       c.relname                                  AS table_name,
       p.polname,
       p.polcmd,
       p.polpermissive,                                  -- ★ false = RESTRICTIVE
       p.polroles::regrole[]                      AS roles,
       pg_get_expr(p.polqual,      p.polrelid)    AS using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid)    AS check_expr
FROM pg_policy p
JOIN pg_class     c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('journal_entries', 'journal_lines')
ORDER BY c.relname, p.polpermissive ASC, p.polname;
-- Expected: polpermissive=true ทุก row
-- หาเจอ polpermissive=false = root cause #1


-- ═══════════════════════════════════════════════════════════
--  (B) Table-level GRANTs — authenticated/anon/PUBLIC
-- ═══════════════════════════════════════════════════════════
SELECT table_name, grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('journal_entries', 'journal_lines')
  AND grantee IN ('authenticated', 'anon', 'PUBLIC')
ORDER BY table_name, grantee, privilege_type;
-- Expected: authenticated มี INSERT + SELECT บนทั้ง 2 ตาราง
-- ถ้าไม่มี INSERT → root cause #2 (GRANT หาย → 403 ก่อนเข้า RLS)


-- ═══════════════════════════════════════════════════════════
--  (C) FORCE RLS flag + table owner
-- ═══════════════════════════════════════════════════════════
SELECT n.nspname                                   AS schema,
       c.relname                                   AS table_name,
       c.relrowsecurity                            AS rls_enabled,
       c.relforcerowsecurity                       AS rls_forced,
       pg_get_userbyid(c.relowner)                 AS owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('journal_entries', 'journal_lines');
-- Expected: rls_enabled=t, owner=postgres (or service_role)
-- rls_forced=t + admin owner → admin path อาจมี edge case (sales ไม่กระทบ)


-- ═══════════════════════════════════════════════════════════
--  (D) is_accountant() function — full definition
-- ═══════════════════════════════════════════════════════════
SELECT pg_get_functiondef('public.is_accountant'::regproc);
-- ตรวจว่า function อ้าง claim/role ตรงกับ JWT ที่ Supabase Auth ส่งมา
-- (เช่น auth.uid() vs auth.role() vs profile.role)


-- ═══════════════════════════════════════════════════════════
--  (E) Admin session context (sanity)
--      sales session probe ต้องดูที่ console log ของ app/script แทน
-- ═══════════════════════════════════════════════════════════
SELECT 'admin_session'                                         AS who,
       current_user,
       current_setting('request.jwt.claims', true)::jsonb      AS jwt;
-- Expected: current_user = postgres/supabase_admin
-- jwt อาจเป็น NULL ใน SQL Editor (no JWT context) — OK
