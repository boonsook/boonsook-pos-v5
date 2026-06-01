-- ═══════════════════════════════════════════════════════════
--  Phase 92.61b — Refund over-/double-refund GUARD (server-side)
--
--  วัตถุประสงค์ (ปิดช่อง audit #1 ระดับ DB — เส้นแบ่งจริงตาม CLAUDE.md 4.x):
--    BEFORE INSERT trigger บน public.refunds:
--      - รวม qty ที่จะคืน (NEW.items_json) + qty ที่เคยคืนแล้วของบิลนี้ (refunds เดิม)
--        เทียบกับ qty เดิมใน sale_items ต่อ product_id
--      - ถ้า (ใหม่ + เก่า) > ของจริง → RAISE EXCEPTION (บล็อกการ insert)
--    → กันการเปิด modal คืนเต็มบิลซ้ำ ๆ → เงิน + สต็อก + JV รั่ว
--
--  ทำงานกับ "ทุก role" (admin + non-admin) — การคืนเกินคือความผิดเสมอ
--  เป็น defense-in-depth ทับ client guard (Phase 92.61 ใน modules/refunds.js)
--
--  ขอบเขต (additive only):
--    - ★ ไม่ลบ/แก้ RLS policy เดิมของ refunds (auth_all_refunds ยังอยู่)
--    - ★ ไม่แตะ sale_items / accounting / money math
--    - ★ ตรวจเฉพาะรายการที่มี product_id (custom item product_id=null
--          ปล่อยผ่าน — พบยาก; client guard จับคู่ด้วยชื่อให้อีกชั้น)
--
--  How to run:
--    Supabase Dashboard → SQL Editor → paste ทั้งไฟล์ → Run → ตรวจ VERIFY ท้ายไฟล์
--    Re-run safe: CREATE OR REPLACE / DROP TRIGGER IF EXISTS
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
--  1) Guard function
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._guard_refunds_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_bad RECORD;
BEGIN
  -- ไม่มีบิลอ้างอิง / ไม่มี items_json เป็น array → ปล่อย (เช่น adjustment ยอดอย่างเดียว)
  IF NEW.sale_id IS NULL OR NEW.items_json IS NULL OR jsonb_typeof(NEW.items_json) <> 'array' THEN
    RETURN NEW;
  END IF;

  -- หา product_id ที่ (ใหม่ + เคยคืน) เกิน qty เดิม
  SELECT * INTO v_bad FROM (
    WITH new_items AS (
      SELECT (it->>'product_id')::bigint AS product_id,
             SUM(COALESCE((it->>'qty')::numeric, 0)) AS qty
      FROM jsonb_array_elements(NEW.items_json) AS it
      WHERE COALESCE(it->>'product_id','') <> ''
      GROUP BY 1
    ),
    prior AS (
      SELECT (it->>'product_id')::bigint AS product_id,
             SUM(COALESCE((it->>'qty')::numeric, 0)) AS qty
      FROM public.refunds r
      CROSS JOIN LATERAL jsonb_array_elements(r.items_json) AS it
      WHERE r.sale_id = NEW.sale_id
        AND jsonb_typeof(r.items_json) = 'array'
        AND COALESCE(it->>'product_id','') <> ''
      GROUP BY 1
    ),
    orig AS (
      SELECT product_id, SUM(COALESCE(qty,0)) AS qty
      FROM public.sale_items
      WHERE sale_id = NEW.sale_id AND product_id IS NOT NULL
      GROUP BY 1
    )
    SELECT n.product_id,
           n.qty                        AS new_qty,
           COALESCE(p.qty, 0)           AS prior_qty,
           COALESCE(o.qty, 0)           AS orig_qty
    FROM new_items n
    LEFT JOIN prior p ON p.product_id = n.product_id
    LEFT JOIN orig  o ON o.product_id = n.product_id
    WHERE n.qty + COALESCE(p.qty, 0) > COALESCE(o.qty, 0)
    LIMIT 1
  ) q;

  IF FOUND THEN
    RAISE EXCEPTION
      'refund exceeds remaining qty (product_id=%, original=%, already_refunded=%, requested=%)',
      v_bad.product_id, v_bad.orig_qty, v_bad.prior_qty, v_bad.new_qty
      USING ERRCODE = '23514';  -- check_violation
  END IF;

  RETURN NEW;
END;
$$;


-- ═══════════════════════════════════════════════════════════
--  2) Trigger
-- ═══════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_guard_refunds_insert ON public.refunds;
CREATE TRIGGER trg_guard_refunds_insert
  BEFORE INSERT ON public.refunds
  FOR EACH ROW
  EXECUTE FUNCTION public._guard_refunds_insert();


-- ═══════════════════════════════════════════════════════════
--  3) Reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════
--  4) VERIFY (รันทีละชุดหลัง apply)
-- ═══════════════════════════════════════════════════════════
-- (a) Trigger ต้องมี trg_guard_refunds_insert
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.refunds'::regclass AND NOT tgisinternal;

-- (b) Function ต้องมี _guard_refunds_insert
-- SELECT proname FROM pg_proc WHERE proname = '_guard_refunds_insert';

-- (c) Smoke (ใช้ sale จริงที่มี sale_items) — แทน <SALE_ID> + <PRODUCT_ID> + <ORIG_QTY>
--     ทดสอบคืนเกิน → ต้อง ERROR "refund exceeds remaining qty ..."
-- INSERT INTO public.refunds (refund_no, sale_id, refund_method, refund_amount, items_json)
-- VALUES ('SMOKE-OVER-1', <SALE_ID>, 'cash', 1,
--   jsonb_build_array(jsonb_build_object('product_id', <PRODUCT_ID>, 'qty', <ORIG_QTY> + 999, 'unit_price', 1)));
--     คาดหวัง: ERROR (ไม่มี row insert)

-- (d) Smoke คืนพอดี/น้อยกว่า → ต้องผ่าน (อย่าลืมลบ row ทดสอบทิ้ง)
-- INSERT INTO public.refunds (refund_no, sale_id, refund_method, refund_amount, items_json)
-- VALUES ('SMOKE-OK-1', <SALE_ID>, 'cash', 1,
--   jsonb_build_array(jsonb_build_object('product_id', <PRODUCT_ID>, 'qty', 1, 'unit_price', 1)));
-- DELETE FROM public.refunds WHERE refund_no IN ('SMOKE-OK-1');
