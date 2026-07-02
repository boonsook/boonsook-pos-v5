-- ═══════════════════════════════════════════════════════════════════════════
--  Phase 551 (audit fix) — Period lock ต้องกัน DELETE ของ journal_entries ด้วย
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Why: trigger เดิม trg_check_period_locked เป็น BEFORE INSERT OR UPDATE เท่านั้น
--  (phase88-19 + 19b). แต่ void จริงของแอป `voidJvForSource` (modules/accounting/
--  auto_post.js) ทำ **hard DELETE** journal_entries (FK CASCADE ลบ lines) ไม่ใช่
--  soft UPDATE status→void ตามที่ design เดิมสมมติ. ผล: ปิดงวดแล้วยังลบ/แก้เอกสาร
--  ต้นทาง (ลบบิลขาย, unpay ใบเสร็จ, แก้/ลบรายจ่าย, แก้ยอดงานช่างที่ปิด) → DELETE JV
--  ในงวดที่ปิดสำเร็จเงียบ ๆ → trial balance / P&L ของงวดที่ปิดแล้วเปลี่ยนย้อนหลัง
--  (ขัด CLAUDE.md §4.3 "period close ต้องล็อก").
--
--  Fix: ขยาย check_period_not_locked() ให้ handle TG_OP='DELETE' — บล็อกการลบ JV
--  ที่ doc_date อยู่ในงวด locked (RETURN OLD เพื่ออนุญาตในงวด open; RAISE ในงวดปิด).
--  trigger เป็น BEFORE INSERT OR UPDATE OR DELETE.
--
--  Behavior หลังแก้:
--    - งวด open: void/ลบ JV ทำงานปกติ (RETURN OLD) — ไม่กระทบ flow ปัจจุบัน.
--    - งวด locked: DELETE ถูก reject → voidJvForSource ได้ HTTP error → toast เตือน
--      "ตรวจ P&L manually". ต้องปลดล็อกงวด (admin) หรือบันทึกรายการกลับในงวดปัจจุบัน.
--
--  ROLLBACK / inspect:
--    SELECT pg_get_functiondef('public.check_period_not_locked'::regproc);
--    -- คืน trigger เดิม: rerun supabase-phase88-19b-relax-void.sql
--    --                   + CREATE TRIGGER ... BEFORE INSERT OR UPDATE ...
-- ───────────────────────────────────────────────────────────────────────────

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
    RETURN NEW;
  END IF;

  -- กัน update ใน locked period (ยกเว้น void/unvoid status change) — คงพฤติกรรม 88-19b
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
      RAISE EXCEPTION 'PERIOD_LOCKED: ห้ามแก้ JV ในงวด % ที่ปิดแล้ว (อนุญาตเฉพาะ void/unvoid)', TO_CHAR(OLD.doc_date, 'YYYY-MM');
    END IF;

    -- กัน move doc_date เข้า locked period
    IF NEW.doc_date != OLD.doc_date AND public.is_period_locked(NEW.doc_date) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: ห้ามย้าย JV เข้างวด % ที่ปิดแล้ว', TO_CHAR(NEW.doc_date, 'YYYY-MM');
    END IF;
    RETURN NEW;
  END IF;

  -- ★ Audit fix (551): hard DELETE ของ JV ต้องไม่ลบสมุดในงวดที่ปิดแล้ว
  IF TG_OP = 'DELETE' THEN
    IF public.is_period_locked(OLD.doc_date) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: ห้ามลบ JV ในงวด % ที่ปิดแล้ว — ปลดล็อกงวดก่อน หรือบันทึกรายการกลับในงวดปัจจุบัน', TO_CHAR(OLD.doc_date, 'YYYY-MM');
    END IF;
    RETURN OLD;  -- งวด open → อนุญาตลบ (FK CASCADE ลบ lines)
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_period_locked ON public.journal_entries;
CREATE TRIGGER trg_check_period_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.check_period_not_locked();

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────
-- Verify — trigger ครอบ 3 event (INSERT/UPDATE/DELETE)
-- ───────────────────────────────────────────────────────────
SELECT string_agg(event_manipulation, ',' ORDER BY event_manipulation) AS events
FROM information_schema.triggers
WHERE trigger_schema = 'public' AND trigger_name = 'trg_check_period_locked';
-- Expected: DELETE,INSERT,UPDATE
