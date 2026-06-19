-- ════════════════════════════════════════════════════════════════════════
-- Phase 498 — บังคับที่ DB ว่า journal_lines ของแต่ละ entry ต้องบาลานซ์ + ตรง header
-- (ACCOUNTING §4.3 · audit #A · severity HIGH · ก่อน go-live บัญชี 1 ก.ค. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- ปัญหา (audit รอบ4 #A, verified):
--   `je_balanced CHECK (total_debit = total_credit)` (phase88-accounting-foundation.sql:69)
--   เช็คแค่ "header" สองช่องเท่ากันเอง — ไม่การันตีว่า SUM(journal_lines) ตรงกับ header
--   หรือ debit รวม = credit รวม. JV ที่ lines ไม่ครบ/ไม่ตรง header จึง commit หลุดได้
--   → งบทดลอง (Dr≠Cr) / งบดุลไม่บาลานซ์ / P&L เพี้ยน "เงียบ ๆ".
--
-- Invariant ที่บังคับ:
--   ทุก entry ที่ "มี" journal_lines ≥1 แถว →
--     SUM(debit) = SUM(credit)               (รายการบาลานซ์)
--     AND SUM(debit) = journal_entries.total_debit
--     AND SUM(credit) = journal_entries.total_credit   (lines ตรง header)
--   เปรียบเทียบแบบ NUMERIC(14,2) exact (ไม่มี float tolerance).
--   entry ที่ "ยังไม่มี" lines (header-first transient ระหว่าง 2 transaction) = อนุญาต.
--
-- ทำไม CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED บน journal_lines (ไม่ใช่ CHECK / ไม่ใช่บน journal_entries):
--   • auto_post.js + journal_form.js โพสต์เป็น 2 transaction แยก:
--       TX1 = POST journal_entries (header เดี่ยว, ยังไม่มี lines)
--       TX2 = POST journal_lines (bulk array ครั้งเดียว)
--     → ถ้าวาง constraint บน journal_entries ที่ "ต้องมี lines" จะ reject header ทุกใบที่ TX1.
--   • DEFERRED = เช็คตอน COMMIT (หลัง bulk lines เข้าครบใน TX2) ไม่ใช่กลางคัน → bulk insert ที่บาลานซ์ผ่านปกติ.
--   • void = DELETE journal_entries → FK ON DELETE CASCADE ลบ lines → trigger เห็น header หาย → ข้าม (ไม่ error).
--
-- ⚠️ owner รันเองใน Supabase SQL editor — Claude ไม่ apply DB.
--    Trigger นี้ "ไม่ย้อนปฏิเสธ" ของเดิมที่ละเมิดอยู่แล้ว (เช็คเฉพาะ INSERT/UPDATE/DELETE ใหม่)
--    → ต้องรัน STEP 0 ก่อน เพื่อรู้ว่ามี JV เดิมที่ violate กี่ใบ (ตัดสินใจ data-fix แยก).


-- ────────────────────────────────────────────────────────────────────────
-- STEP 0a — (รันก่อน · อ่านผล) JV เดิมที่ lines ไม่ตรง header หรือ Dr≠Cr
--   ถ้าได้ 0 แถว = ระบบสะอาด ติดตั้ง trigger ได้เลย.
--   ถ้าได้ >0 = ของเก่า violate อยู่แล้ว (น่าจะจาก orphan/partial เดิม) — trigger ไม่แตะของเก่า
--   แต่ owner ควร data-fix ก่อน go-live (งบจะเพี้ยนจากใบเหล่านี้).
-- ────────────────────────────────────────────────────────────────────────
-- SELECT je.id, je.doc_no, je.status, je.total_debit, je.total_credit,
--        COALESCE(sum(jl.debit),0)  AS lines_dr,
--        COALESCE(sum(jl.credit),0) AS lines_cr
-- FROM public.journal_entries je
-- LEFT JOIN public.journal_lines jl ON jl.entry_id = je.id
-- GROUP BY je.id
-- HAVING COALESCE(sum(jl.debit),0)  <> je.total_debit
--     OR COALESCE(sum(jl.credit),0) <> je.total_credit
--     OR COALESCE(sum(jl.debit),0)  <> COALESCE(sum(jl.credit),0);

-- STEP 0b — (รันก่อน · อ่านผล) orphan header: entry ที่ "ไม่มี lines เลย"
--   นอกขอบเขต trigger นี้ (header-first 2-TX กันที่ DB ไม่ได้) — รายงานจำนวนให้ owner.
--   ถ้ามีเยอะ = journal_form/auto_post เคยโพสต์ header แล้ว lines ล้ม (journal_form ไม่ rollback) → phase แยก.
-- SELECT je.id, je.doc_no, je.status, je.created_at
-- FROM public.journal_entries je
-- LEFT JOIN public.journal_lines jl ON jl.entry_id = je.id
-- WHERE jl.id IS NULL
-- ORDER BY je.created_at DESC;


-- ────────────────────────────────────────────────────────────────────────
-- STEP 1 — function: ตรวจ entry ที่เกี่ยวข้องว่า lines บาลานซ์ + ตรง header
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_je_lines_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  -- INSERT → NEW.entry_id · DELETE → OLD.entry_id · UPDATE → NEW.entry_id (entry_id ไม่เคยถูกย้ายข้าม entry ใน flow ปัจจุบัน)
  v_entry  bigint := COALESCE(NEW.entry_id, OLD.entry_id);
  v_dr     numeric(14,2);
  v_cr     numeric(14,2);
  v_hdr_dr numeric(14,2);
  v_hdr_cr numeric(14,2);
BEGIN
  -- header ของ entry นี้ยังอยู่ไหม — ถ้าถูกลบ (void = DELETE journal_entries → cascade) → ข้าม ไม่ error
  SELECT total_debit, total_credit
    INTO v_hdr_dr, v_hdr_cr
    FROM public.journal_entries
   WHERE id = v_entry;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- ผลรวม lines ปัจจุบันของ entry นี้ (เช็คตอน COMMIT — lines เข้าครบแล้ว)
  SELECT COALESCE(sum(debit), 0), COALESCE(sum(credit), 0)
    INTO v_dr, v_cr
    FROM public.journal_lines
   WHERE entry_id = v_entry;

  -- (1) รายการต้องบาลานซ์ในตัวเอง
  IF v_dr <> v_cr THEN
    RAISE EXCEPTION 'JE % lines ไม่บาลานซ์: debit % <> credit %', v_entry, v_dr, v_cr
      USING ERRCODE = 'check_violation';
  END IF;

  -- (2) ผลรวม lines ต้องตรงกับ header
  IF v_dr <> v_hdr_dr OR v_cr <> v_hdr_cr THEN
    RAISE EXCEPTION 'JE % ผลรวม lines (%/%) <> header (%/%)', v_entry, v_dr, v_cr, v_hdr_dr, v_hdr_cr
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;  -- AFTER trigger: ค่าที่คืนถูกละเว้น
END;
$$;


-- ────────────────────────────────────────────────────────────────────────
-- STEP 2 — constraint trigger (deferred ถึง COMMIT — รองรับ bulk insert + 2-TX flow)
-- ────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_je_lines_balance ON public.journal_lines;
CREATE CONSTRAINT TRIGGER trg_je_lines_balance
  AFTER INSERT OR UPDATE OR DELETE ON public.journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_je_lines_balance();

-- ให้ PostgREST รีโหลด schema cache
NOTIFY pgrst, 'reload schema';


-- ────────────────────────────────────────────────────────────────────────
-- STEP 3 — (หลังติดตั้ง · ทดสอบ negative — ต้องเห็น ERROR แล้ว ROLLBACK ทิ้ง ไม่เหลือขยะ)
--   ⚠️ ใช้ transaction block (BEGIN…ROLLBACK) ไม่ใช่ DO block — เพราะ:
--     • DO block ควบคุม transaction (ROLLBACK) เองไม่ได้
--     • trigger เป็น DEFERRED → fire ตอน COMMIT; เราใช้ `SET CONSTRAINTS ALL IMMEDIATE`
--       บังคับเช็ค "เดี๋ยวนี้" เพื่อให้เห็น error ชัด ๆ ก่อน ROLLBACK
--     • doc_type ต้องเป็นค่า valid (JV/PV/SV/RV/CV/AJ/OB) — ค่านอกชุดนี้จะตาย CHECK (23514)
--       "ก่อน" ถึง trigger เรา (= ทดสอบผิดตัว)
--   ⚠️ แทน <ACCT_DR>/<ACCT_CR> ด้วย "บัญชี leaf จริง 2 ตัว" ใน chart_of_accounts ของร้าน
--      (account_code เป็น FK → ถ้าไม่มีจริง error จะเป็น FK 23503 ไม่ใช่ trigger เรา)
--      ตัวอย่าง: เงินสด 1110 / รายได้ 4100 — ปรับตาม COA จริง
-- ────────────────────────────────────────────────────────────────────────
-- BEGIN;
--   WITH e AS (
--     INSERT INTO public.journal_entries(doc_no, doc_type, doc_date, description, status, total_debit, total_credit)
--     VALUES ('TEST-498-NEG', 'JV', CURRENT_DATE, 'phase498 negative test', 'draft', 100, 100)
--     RETURNING id
--   )
--   INSERT INTO public.journal_lines(entry_id, line_no, account_code, debit, credit)
--   SELECT id, 1, '<ACCT_DR>', 90, 0 FROM e          -- lines รวม 90/90 (บาลานซ์กันเอง)
--   UNION ALL SELECT id, 2, '<ACCT_CR>', 0, 90 FROM e; --   แต่ "ไม่ตรง header 100/100"
--   SET CONSTRAINTS ALL IMMEDIATE;  -- ← ต้อง RAISE ที่นี่
-- ROLLBACK;
-- -- ↑ คาดหวัง ERROR: "JE ... ผลรวม lines (90.00/90.00) <> header (100.00/100.00)"
-- --   (SQLSTATE 23514 / check_violation จาก trg_je_lines_balance) = trigger ทำงานถูก; ROLLBACK เคลียร์ของทดสอบ.
-- -- ทดสอบ check #1 (Dr รวม ≠ Cr รวม) ได้เช่นกัน: เปลี่ยน lines เป็น (<ACCT_DR>,100,0)+(<ACCT_CR>,0,90)
-- --   → error "lines ไม่บาลานซ์: debit 100.00 <> credit 90.00"
