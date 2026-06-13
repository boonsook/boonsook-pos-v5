-- ═══════════════════════════════════════════════════════════
--  Phase 433 — Payroll double-pay GUARD (server-side)
--
--  วัตถุประสงค์ (ปิด race "จ่ายเงินเดือนซ้ำข้ามเครื่อง" ระดับ DB — defense-in-depth):
--    ปัญหา: สองเครื่อง/สองแท็บกด "จ่าย" แถวเดียวกันพร้อมกัน
--      → เดิม PATCH ไม่มีเงื่อนไข สำเร็จทั้งคู่ → expense + JV ถูกสร้างซ้ำ 2 ชุด
--    ชั้นที่ 1 (client, Phase 433 ใน modules/payroll.js): PATCH แบบ CAS
--      `?id=eq.{id}&paid_at=is.null` + Prefer return=representation
--      → เครื่องที่แพ้ได้แถวว่าง → ไม่ยิง side-effects ต่อ
--    ชั้นที่ 2 (ไฟล์นี้): BEFORE UPDATE trigger บน public.staff_payroll
--      → ถ้าแถว "จ่ายแล้ว" (OLD.paid_at IS NOT NULL) แล้วมีใครพยายาม
--        เปลี่ยนค่า paid_at (จ่ายทับ / ล้างเป็น NULL จาก state เก่า) → RAISE EXCEPTION
--      → กันทุก client/ทุก path รวมถึงเครื่องที่ยังรันโค้ดเก่า และกัน
--        edit-แถวจ่ายแล้วจาก state ค้าง (payload เก่า paid_at=null) ล้างวันจ่ายโดยไม่ตั้งใจ
--
--  พฤติกรรมที่ "ผ่านได้" (ไม่กระทบ flow ปกติ):
--    - จ่ายครั้งแรก: OLD.paid_at IS NULL → ผ่าน
--    - แก้ไขรายการที่ยังไม่จ่าย: OLD.paid_at IS NULL → ผ่าน
--    - แก้ไขรายการจ่ายแล้วโดยส่ง paid_at ค่าเดิมกลับมา (flow แก้ไขปัจจุบัน): NEW = OLD → ผ่าน
--    - ลบแถว (DELETE): trigger เป็น UPDATE-only → ไม่เกี่ยว
--
--  พฤติกรรมที่ "โดนบล็อก":
--    - เปลี่ยน paid_at ของแถวที่จ่ายแล้วเป็นเวลาใหม่ (จ่ายทับ/จ่ายซ้ำ)
--    - ล้าง paid_at เป็น NULL (un-pay) — ถ้าวันหน้าต้องการ un-pay จริง
--      ให้ owner รัน UPDATE ตรงใน SQL Editor หลัง DISABLE trigger ชั่วคราว
--
--  ขอบเขต (additive only):
--    - ★ ไม่ลบ/แก้ RLS policy เดิมของ staff_payroll
--    - ★ ไม่แตะคอลัมน์อื่น (แก้ field อื่นของแถวจ่ายแล้ว ยังทำได้เท่าเดิม —
--        ปัญหา edit-paid-row ไม่ sync expense/JV เป็นงานแยกคนละเฟส)
--    - ★ ไม่แตะคอลัมน์ยอดรวมที่ DB คำนวณเอง (GENERATED column เดิม)
--
--  How to run:
--    Supabase Dashboard → SQL Editor → paste ทั้งไฟล์ → Run → ตรวจ VERIFY ท้ายไฟล์
--    Re-run safe: CREATE OR REPLACE / DROP TRIGGER IF EXISTS
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  1) Guard function
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._guard_payroll_paid_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- แถวที่จ่ายแล้ว: ห้ามเปลี่ยนค่า paid_at ทุกกรณี (จ่ายทับ / ล้างเป็น NULL)
  IF OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    RAISE EXCEPTION 'Phase433: staff_payroll id=% already paid at % — paid_at is locked (double-pay / stale-edit blocked)',
      OLD.id, OLD.paid_at;
  END IF;
  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════
--  2) Trigger (re-run safe)
-- ═══════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_guard_payroll_double_pay ON public.staff_payroll;
CREATE TRIGGER trg_guard_payroll_double_pay
  BEFORE UPDATE ON public.staff_payroll
  FOR EACH ROW
  WHEN (OLD.paid_at IS NOT NULL)
  EXECUTE FUNCTION public._guard_payroll_paid_lock();

-- schema cache refresh (ไม่จำเป็นกับ trigger แต่ปลอดภัยไว้ก่อน — กติกาเดิมของโปรเจ็กต์)
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
--  VERIFY (รันดูผลทีละก้อน)
-- ═══════════════════════════════════════════════════════════
-- (a) trigger ต้องปรากฏ 1 แถว
SELECT tgname, tgrelid::regclass, tgenabled
FROM pg_trigger
WHERE tgname = 'trg_guard_payroll_double_pay';

-- (b) function ต้องปรากฏ 1 แถว
SELECT proname FROM pg_proc WHERE proname = '_guard_payroll_paid_lock';

-- (c) ทดสอบบล็อกจริง (เลือก id แถวที่จ่ายแล้ว 1 แถวมาแทน <PAID_ID> — คาดหวัง ERROR Phase433):
-- UPDATE public.staff_payroll SET paid_at = now() WHERE id = <PAID_ID>;
-- UPDATE public.staff_payroll SET paid_at = NULL  WHERE id = <PAID_ID>;

-- (d) ทดสอบว่า edit ปกติยังผ่าน (ส่ง paid_at ค่าเดิม — คาดหวังสำเร็จ 1 แถว):
-- UPDATE public.staff_payroll SET note = COALESCE(note,'') WHERE id = <PAID_ID>;
