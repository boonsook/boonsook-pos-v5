-- ═══════════════════════════════════════════════════════════
--  Phase 88.19b — Relax trigger: อนุญาต void เสมอใน locked period
--
--  เหตุผล: Trigger เดิม strict ไป (เช็ค description ตรงเป๊ะ)
--          → user ลงให้ void ภายใน locked period → reject
--          → ใช้งานจริงลำบาก
--
--  แก้: อนุญาต UPDATE ใน locked period ถ้า:
--    - status: approved → void (soft delete)
--    - หรือ status: void → approved (unvoid)
--    - doc_date ไม่เปลี่ยน
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_period_not_locked()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- กัน insert ใหม่ใน locked period
  IF TG_OP = 'INSERT' THEN
    IF public.is_period_locked(NEW.doc_date) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: งวด % ถูกปิดแล้ว — ปลดล็อกก่อน', TO_CHAR(NEW.doc_date, 'YYYY-MM');
    END IF;
  END IF;

  -- กัน update ใน locked period (ยกเว้น void/unvoid status change)
  IF TG_OP = 'UPDATE' THEN
    IF public.is_period_locked(OLD.doc_date) THEN
      -- ★ อนุญาต void: approved → void (soft delete)
      IF OLD.status = 'approved' AND NEW.status = 'void'
         AND NEW.doc_date = OLD.doc_date THEN
        RETURN NEW;
      END IF;
      -- ★ อนุญาต unvoid: void → approved
      IF OLD.status = 'void' AND NEW.status = 'approved'
         AND NEW.doc_date = OLD.doc_date THEN
        RETURN NEW;
      END IF;
      -- อื่นๆ: reject
      RAISE EXCEPTION 'PERIOD_LOCKED: ห้ามแก้ JV ในงวด % ที่ปิดแล้ว (อนุญาตเฉพาะ void/unvoid)', TO_CHAR(OLD.doc_date, 'YYYY-MM');
    END IF;

    -- กัน move doc_date เข้า locked period
    IF NEW.doc_date != OLD.doc_date AND public.is_period_locked(NEW.doc_date) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: ห้ามย้าย JV เข้างวด % ที่ปิดแล้ว', TO_CHAR(NEW.doc_date, 'YYYY-MM');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- Verify
SELECT 'Trigger updated successfully' AS status;
