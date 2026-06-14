-- ═══════════════════════════════════════════════════════════
--  Phase 447b — accountant (สำนักงานบัญชีภายนอก) read access to operational tables
--
--  บริบท (verify-first 2026-06-15, owner รัน pg_policy dump):
--    บทบาท accountant = สำนักงานบัญชีภายนอก ที่ต้องปิดงบ + ส่งสรรพากร → ต้อง "อ่าน"
--    เอกสารดำเนินงานเพื่อปิดงบ แต่ "ห้ามเห็นเงินเดือนรายคน".
--
--    สถานะจริงของ accountant (role≠admin, is_accountant()=true, is_sales_or_admin()=false):
--      ✅ อ่านได้แล้ว (policy USING true): sales · receipts · delivery_invoices · quotations · products
--      ✅ accounting/journals/COA/periods/งบ (je_select/jl_select = is_accountant())
--      ❌ expenses  — policy เดียว `expenses_admin` = is_sales_or_admin() (ไม่รวม accountant) → อ่านไม่ได้เลย
--      ❌ customers — policy `customers_rw_staff` = is_staff() (ไม่รวม accountant) → อ่านไม่ได้
--
--    ⇒ เงินเดือนรายคน "ซ่อนครบแล้ว" (staff_payroll = admin+self · expenses = บล็อก · JV = aggregate 447a).
--      ไฟล์นี้แก้ปัญหา "กลับด้าน": accountant อ่านรายจ่าย/ลูกค้าที่จำเป็นต่อการปิดงบไม่ได้.
--
--  สิ่งที่ทำ (additive · read-only · ไม่แตะ policy เดิม · ไม่เปิดให้เขียน):
--    1) expenses  — accountant อ่านได้ "ยกเว้นหมวดเงินเดือน" (salary/labor_hire/payroll ยังซ่อน)
--    2) customers — accountant อ่านได้ (จำเป็นต่อ AR / ชื่อลูกค้าบนใบเสร็จ-ใบส่ง; ข้อมูลไม่อ่อนไหวเท่าเงินเดือน)
--    ใช้ public.is_accountant() (SECURITY DEFINER — กัน RLS recursion บน profiles).
--    admin ครอบคลุมอยู่แล้วผ่าน policy เดิม (is_sales_or_admin/is_staff) → policy ใหม่ไม่ลดสิทธิ์ใคร.
--
--  ❌ ไม่ทำในไฟล์นี้ (เป็น step แยก ถ้า owner ต้องการ):
--    - "read-only enforcement" บน receipts/quotations/delivery_invoices (policy `*` USING true =
--      authenticated เขียนได้) — การจำกัด write ของ accountant ต้องแก้ policy ที่ share กับ role อื่น
--      = กระทบทุก role → ต้อง design แยก. ฝั่ง UI: ROLE_PAGES + canManage* gate การเขียนอยู่แล้ว.
--    - ไม่แตะ staff_payroll (admin+self ถูกต้องแล้ว) · ไม่แตะ expenses_admin เดิม · ไม่เปลี่ยน is_* helpers.
--
--  How to run: Supabase SQL Editor → paste → Run (re-run safe; DROP IF EXISTS ก่อน CREATE).
--  Smoke หลังรัน: login accountant → หน้า "รายจ่าย" เห็นรายการ "ที่ไม่ใช่เงินเดือน" · ไม่เห็นแถว salary
--                · หน้าใบเสร็จ/ใบส่ง แสดงชื่อลูกค้าได้.
--
--  ✅ APPLIED 2026-06-15 (owner รันใน SQL Editor — ทั้ง 2 policy "Success"):
--     expenses_accountant_read (form COALESCE) + customers_accountant_read. PostgREST reloaded.
--     ⇒ Step 3 privacy = DONE (salary ซ่อนครบ) · Step 4 = accountant อ่าน operational ครบ.
-- ═══════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────
-- 1) expenses — accountant อ่านได้ ยกเว้นหมวดเงินเดือน (salary ยังซ่อน)
-- ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "expenses_accountant_read" ON public.expenses;

CREATE POLICY "expenses_accountant_read" ON public.expenses
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.is_accountant()
    AND COALESCE(category, '') NOT IN ('salary', 'labor_hire', 'payroll')
  );
-- หมายเหตุ: เงินเดือนลงบัญชีผ่าน JV aggregate (5200) ที่ accountant อ่านได้อยู่แล้ว →
--   ยอดเงินเดือน "รวม" ยังอยู่ในงบ P&L; เห็นไม่ได้แค่ "รายแถว/รายคน" ใน expenses.


-- ───────────────────────────────────────────────────────────
-- 2) customers — accountant อ่านได้ (AR / ชื่อลูกค้าบนเอกสาร)
-- ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "customers_accountant_read" ON public.customers;

CREATE POLICY "customers_accountant_read" ON public.customers
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ( public.is_accountant() );


-- ───────────────────────────────────────────────────────────
-- 3) Reload PostgREST schema cache
-- ───────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ───────────────────────────────────────────────────────────
-- 4) VERIFY (รันแล้วดูผล)
-- ───────────────────────────────────────────────────────────
-- (4a) policy ใหม่ต้องโผล่ (cmd=SELECT, permissive)
SELECT polrelid::regclass AS tbl, polname, polcmd::text AS cmd, polpermissive,
       pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polname IN ('expenses_accountant_read', 'customers_accountant_read')
ORDER BY tbl, polname;
-- คาดหวัง:
--   expenses  | expenses_accountant_read  | r | t | (is_accountant() AND COALESCE(category,'') NOT IN (...))
--   customers | customers_accountant_read | r | t | is_accountant()

-- (4b) ยืนยันว่า salary ยังซ่อน — จำลอง accountant context แล้วนับแถว salary ที่เห็น (ควร = 0)
--   (รันใน SQL Editor ปกติ = postgres เห็นหมด; ทดสอบจริงให้ login accountant ในแอปแล้ว smoke)
