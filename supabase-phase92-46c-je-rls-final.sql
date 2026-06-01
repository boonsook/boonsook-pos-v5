-- ═══════════════════════════════════════════════════════════
--  Phase 92.46c — REAL root cause fix: je_select blocks the SELECT-back
--
--  ★ DECISIVE EVIDENCE (scripts/diag_je_rest.js, post-restart):
--      [1] ADMIN  insert return=representation  -> 201, source cols persisted OK
--      [2] non-admin insert return=representation -> 403 "violates RLS"
--      [3] non-admin insert return=MINIMAL        -> 201 PASS  ✅
--    ต่างกันแค่ Prefer header => การ INSERT ผ่าน! je_insert_auto whitelist ไม่เคยพัง.
--
--  ROOT CAUSE:
--    `return=representation` ทำให้ PostgREST SELECT row กลับหลัง insert.
--    `je_select` = USING (is_accountant()) (admin-only) => non-admin อ่าน row
--    ตัวเองกลับไม่ได้ => PostgREST คืน 403 "new row violates row-level security
--    policy". ทั้ง auto_post.js (line ~228) และ verify:accounting A2 ใช้
--    return=representation เพราะต้องการ entry.id ไปใส่ journal_lines.
--
--    je_select admin-only ตัวเดียวกันนี้ยังบล็อก jl_insert_auto EXISTS subquery
--    (lines insert ของ non-admin) => fix ที่ je_select จุดเดียว ปิดทั้งสองอาการ.
--
--  FIX (additive, ไม่แตะ auto_post.js / whitelist / period close):
--    เพิ่ม PERMISSIVE SELECT policy ให้ non-admin อ่าน journal_entries เฉพาะที่เป็น
--    auto-post source (ที่ตัวเองมีสิทธิ์ insert อยู่แล้ว) — EXCLUDE 'staff_payroll'
--    เพื่อกัน leak ยอดเงินเดือน. admin/accountant ยังเห็นทุก row ผ่าน je_select เดิม.
--
--  ★ Confidentiality trade-off (โปรดยืนยัน):
--    non-admin (sales/cashier ฯลฯ) จะอ่าน journal_entries header ของ
--    sales/expenses/service/receipts/delivery/credit/refunds ได้ (ไม่ใช่ payroll,
--    ไม่ใช่ line detail — jl_select ยัง admin-only). ถ้าต้องการ ZERO exposure ให้ใช้
--    ทางเลือก RPC (SECURITY DEFINER post_journal_entry) แทน — แจ้งมาได้.
--
--  How to run: Supabase SQL Editor -> paste -> Run (re-run safe).
--  Verify:     npm run verify:accounting   (A2 ควรเป็น 201) แล้ว
--              npm run verify:je            (เช็ค entry+lines ครบ)
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  1) Add non-admin SELECT for auto-source entries (payroll excluded)
--     PERMISSIVE => OR กับ je_select เดิม (admin เห็นทุกอย่างเหมือนเดิม)
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "je_select_auto" ON public.journal_entries;

CREATE POLICY "je_select_auto" ON public.journal_entries
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    source_table IS NOT NULL
    AND source_id IS NOT NULL
    AND source_table IN (
      'sales',
      'expenses',
      'service_jobs',
      'receipts',
      'delivery_invoices',
      'credit_payments',
      'refunds'
    )
    -- หมายเหตุ: ตั้งใจไม่รวม 'staff_payroll' เพื่อไม่ให้ non-admin เห็นยอด payroll
  );


-- ═══════════════════════════════════════════════════════════
--  2) Reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════
--  3) VERIFY
-- ═══════════════════════════════════════════════════════════

-- (3a) All policies on journal_entries — ต้องเห็น je_select + je_select_auto (cmd=SELECT)
SELECT polname,
       polcmd::text                                    AS cmd,
       polpermissive                                   AS is_permissive,
       LEFT(pg_get_expr(polqual, polrelid)::text, 160) AS using_expr
FROM pg_policy
WHERE polrelid = 'public.journal_entries'::regclass
ORDER BY polcmd, polname;
-- คาดหวัง row: je_select_auto | r (SELECT) | t | (source_table IN (...) non-payroll)

-- (3b) นับ SELECT policies — Expected: je_select + je_select_auto
SELECT count(*) AS select_policies
FROM pg_policy
WHERE polrelid = 'public.journal_entries'::regclass
  AND polname IN ('je_select','je_select_auto');
