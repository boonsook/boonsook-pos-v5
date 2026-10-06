-- Behavioral checks run only in the isolated local PostgreSQL fixture.
-- Any exception stops psql with ON_ERROR_STOP=1; no live business rows exist.
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; -- sales
DO $check$
DECLARE r public.credit_refund_requests%ROWTYPE; v_method text;
BEGIN
  SELECT * INTO r FROM public.phase646_submit_credit_refund(
    '00000000-0000-0000-0000-000000000091',9,
    '[{"sale_item_id":81,"qty":1}]'::jsonb,'credit','สินค้าชำรุด',true,2,NULL);
  IF r.status<>'pending' OR r.quoted_amount<>90 OR r.customer_id<>101 THEN
    RAISE EXCEPTION 'full-sale request did not use net after discount';
  END IF;
  IF (SELECT count(*) FROM public.credit_refund_requests WHERE sale_id=9)<>1 THEN
    RAISE EXCEPTION 'request duplicate';
  END IF;
  SELECT * INTO r FROM public.phase646_submit_credit_refund(
    '00000000-0000-0000-0000-000000000091',9,
    '[{"sale_item_id":81,"qty":1}]'::jsonb,'credit','สินค้าชำรุด',true,2,NULL);
  IF r.id<>1 THEN RAISE EXCEPTION 'request key replay changed id'; END IF;
  BEGIN
    PERFORM public.phase646_admin_decide_credit_refund(1,true,90,NULL);
    RAISE EXCEPTION 'sales role approved credit refund';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  FOR v_method IN SELECT unnest(ARRAY['credit ','คืนเป็นเครดิต','exchange ','cash-credit']) LOOP
    BEGIN
      INSERT INTO public.refunds(refund_no,sale_id,customer_id,reason,refund_method,
        refund_amount,items_json,created_by)
        VALUES('FORGED-'||v_method,9,101,'forged',v_method,90,'[]'::jsonb,auth.uid()::text);
      RAISE EXCEPTION 'method alias bypassed admin approval: %',v_method;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
  END LOOP;
  BEGIN
    INSERT INTO public.refunds(refund_no,sale_id,customer_id,reason,refund_method,
      refund_amount,items_json,created_by)
      VALUES('FORGED-9',9,101,'forged','credit',90,'[]'::jsonb,auth.uid()::text);
    RAISE EXCEPTION 'sales role inserted direct credit refund';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.customer_credit_ledger(customer_id,source_type,source_id,amount)
      VALUES(101,'refund_credit',9999,90);
    RAISE EXCEPTION 'sales role wrote spendable credit directly';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  RAISE NOTICE 'PASS full-sale net quote and sales cannot approve';
END $check$;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; -- admin
DO $check$
DECLARE r public.credit_refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.phase646_admin_decide_credit_refund(1,true,90,NULL);
  IF r.status<>'approved' OR r.decided_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'admin approval not recorded';
  END IF;
  IF EXISTS(SELECT 1 FROM public.refunds WHERE sale_id=9)
     OR EXISTS(SELECT 1 FROM public.customer_credit_ledger WHERE customer_id=101) THEN
    RAISE EXCEPTION 'approval had financial effects before finalization';
  END IF;
  SELECT * INTO r FROM public.phase646_finalize_credit_refund(1,90);
  IF r.status<>'completed' OR r.refund_id IS NULL THEN
    RAISE EXCEPTION 'finalizer did not complete';
  END IF;
  IF (SELECT count(*) FROM public.refunds WHERE id=r.refund_id AND refund_amount=90 AND restocked)<>1
     OR (SELECT stock FROM public.warehouse_stock WHERE product_id=44 AND warehouse_id=2)<>4
     OR (SELECT stock FROM public.products WHERE id=44)<>4
     OR (SELECT count(*) FROM public.stock_movements WHERE type='return' AND product_id=44)<>1
     OR (SELECT count(*) FROM public.journal_entries WHERE source_table='refunds' AND source_id=r.refund_id
           AND total_debit=90 AND total_credit=90 AND status='approved')<>1
     OR (SELECT count(*) FROM public.journal_lines l JOIN public.journal_entries e ON e.id=l.entry_id
           WHERE e.source_table='refunds' AND e.source_id=r.refund_id AND
           ((l.account_code='4110' AND l.debit=90 AND l.credit=0) OR
            (l.account_code='2180' AND l.credit=90 AND l.debit=0)))<>2
     OR (SELECT count(*) FROM public.loyalty_points WHERE ref_type='sale_reverse' AND ref_id=9 AND points=5)<>1
     OR (SELECT count(*) FROM public.customer_credit_ledger WHERE source_id=r.refund_id AND amount=90)<>1 THEN
    RAISE EXCEPTION 'completed refund lacks an exact stock/JV/loyalty/ledger effect';
  END IF;
  PERFORM public.phase646_finalize_credit_refund(1,90);
  IF (SELECT count(*) FROM public.refunds WHERE sale_id=9)<>1
     OR (SELECT count(*) FROM public.stock_movements WHERE type='return' AND product_id=44)<>1
     OR (SELECT count(*) FROM public.loyalty_points WHERE ref_type='sale_reverse' AND ref_id=9)<>1
     OR (SELECT count(*) FROM public.customer_credit_ledger WHERE customer_id=101)<>1 THEN
    RAISE EXCEPTION 'finalizer retry duplicated side effects';
  END IF;
  RAISE NOTICE 'PASS admin full-sale atomic effects and replay idempotency';
END $check$;

-- A second sales user cannot read another staff member's request via RLS,
-- but must still be blocked from inserting a cash refund after completion.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.credit_refund_requests WHERE sale_id=9) THEN
    RAISE EXCEPTION 'RLS test user unexpectedly sees the other request';
  END IF;
  BEGIN
    INSERT INTO public.refunds(refund_no,sale_id,customer_id,reason,refund_method,
      refund_amount,items_json,created_by)
      VALUES('FORGED-CASH-9',9,101,'second refund','cash',90,NULL,auth.uid()::text);
    RAISE EXCEPTION 'completed credit refund accepted a second cash refund';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  INSERT INTO public.refunds(refund_no,sale_id,customer_id,reason,refund_method,
    refund_amount,items_json,created_by)
    VALUES('CASH-17',17,101,'cash test','cash',30,NULL,auth.uid()::text);
  BEGIN
    UPDATE public.refunds SET sale_id=9 WHERE refund_no='CASH-17';
    RAISE EXCEPTION 'cash refund was moved onto a completed credit-refund sale';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  IF (SELECT sale_id FROM public.refunds WHERE refund_no='CASH-17')<>17 THEN
    RAISE EXCEPTION 'blocked cash-refund reassignment changed source sale';
  END IF;
  RAISE NOTICE 'PASS completed sale rejects another staff user INSERT and UPDATE';
END $check$;

-- Force accounting failure after the refund row has been attempted. The
-- finalizer must roll the entire effect back and park the request for review.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; -- sales
DO $check$
DECLARE r public.credit_refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.phase646_submit_credit_refund(
    '00000000-0000-0000-0000-000000000096',12,
    '[{"sale_item_id":85,"qty":1}]'::jsonb,'credit','ทดสอบบัญชีล้ม',false,NULL,NULL);
  IF r.status<>'pending' OR r.quoted_amount<>50 THEN
    RAISE EXCEPTION 'accounting-failure fixture did not reach approval';
  END IF;
END $check$;
RESET ROLE;
UPDATE public.account_mapping SET is_active=false WHERE mapping_key='refund_credit';
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; -- admin
DO $check$
DECLARE r public.credit_refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.phase646_admin_decide_credit_refund(2,true,50,NULL);
  IF r.status<>'approved' THEN RAISE EXCEPTION 'admin approval missing for failure test'; END IF;
  SELECT * INTO r FROM public.phase646_finalize_credit_refund(2,50);
  IF r.status<>'manual_review' OR r.review_reason NOT LIKE 'finalize_failed_%'
     OR EXISTS (SELECT 1 FROM public.refunds WHERE sale_id=12)
     OR EXISTS (SELECT 1 FROM public.customer_credit_ledger WHERE customer_id=106) THEN
    RAISE EXCEPTION 'accounting failure left a refund or spendable credit';
  END IF;
  RAISE NOTICE 'PASS accounting failure rolls back refund and credit';
END $check$;
RESET ROLE;
UPDATE public.account_mapping SET is_active=true WHERE mapping_key='refund_credit';

SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; -- sales
DO $check$
DECLARE r public.credit_refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.phase646_submit_credit_refund(
    '00000000-0000-0000-0000-000000000097',15,
    '[{"sale_item_id":87,"qty":1}]'::jsonb,'credit','แต้มใช้ไปแล้ว',false,NULL,NULL);
  IF r.status<>'pending' OR r.quoted_amount<>40 THEN
    RAISE EXCEPTION 'spent-loyalty fixture did not reach approval';
  END IF;
END $check$;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; -- admin
DO $check$
DECLARE r public.credit_refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.phase646_admin_decide_credit_refund(3,true,40,NULL);
  SELECT * INTO r FROM public.phase646_finalize_credit_refund(3,40);
  IF r.status<>'manual_review' OR r.review_reason<>'loyalty_spent_or_ambiguous'
     OR EXISTS (SELECT 1 FROM public.refunds WHERE sale_id=15)
     OR EXISTS (SELECT 1 FROM public.customer_credit_ledger WHERE customer_id=102) THEN
    RAISE EXCEPTION 'spent points incorrectly produced a full credit refund';
  END IF;
  RAISE NOTICE 'PASS spent loyalty pauses before any refund or credit';
END $check$;

SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; -- sales
DO $check$
DECLARE r public.credit_refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.phase646_submit_credit_refund(
    '00000000-0000-0000-0000-000000000092',10,
    '[{"sale_item_id":82,"qty":1}]'::jsonb,'credit','คืนบางรายการ',true,2,NULL);
  IF r.status<>'manual_review' OR r.review_reason<>'partial_return' THEN
    RAISE EXCEPTION 'partial request was not parked for manual review';
  END IF;
  SELECT * INTO r FROM public.phase646_submit_credit_refund(
    '00000000-0000-0000-0000-000000000093',11,
    '[{"sale_item_id":84,"qty":1}]'::jsonb,'credit','บิล VAT เดิม',false,NULL,NULL);
  IF r.status<>'manual_review' OR r.review_reason<>'historical_vat' THEN
    RAISE EXCEPTION 'historical VAT did not stop automation';
  END IF;
  SELECT * INTO r FROM public.phase646_submit_credit_refund(
    '00000000-0000-0000-0000-000000000094',13,
    '[{"sale_item_id":86,"qty":1}]'::jsonb,'credit','ยอดไม่ตรง',false,NULL,NULL);
  IF r.status<>'manual_review' THEN RAISE EXCEPTION 'ambiguous net was automatically approved'; END IF;
  RAISE NOTICE 'PASS partial, historical VAT and ambiguous net are manual';
END $check$;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; -- customer
DO $check$
BEGIN
  BEGIN
    PERFORM public.phase646_submit_credit_refund(
      '00000000-0000-0000-0000-000000000095',12,
      '[{"sale_item_id":85,"qty":1}]'::jsonb,'credit','forged',false,NULL,NULL);
    RAISE EXCEPTION 'customer submitted refund request';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.phase646_finalize_credit_refund(1,90);
    RAISE EXCEPTION 'customer finalized credit refund';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.customer_credit_ledger(customer_id,source_type,source_id,amount)
      VALUES(102,'refund_credit',12345,999);
    RAISE EXCEPTION 'customer wrote ledger directly';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  RAISE NOTICE 'PASS customer cannot request, finalize or write ledger';
END $check$;
RESET ROLE;

-- A sale's 5 earned points were spent (3) and later replenished by a
-- different sale (3). Aggregate balance is again 5, so balance-only checks
-- cannot prove that sale 18's original points remain available. Moving the
-- earn identity above the redemption must not make it safe either: existing
-- ledger IDs are not immutable evidence of transaction order. The fixture
-- established that identity before installing Phase 646.
-- Staff has UPDATE/DELETE in the local fixture. Rewriting or deleting the
-- redemption would hide the risk from finalization; unrelated sale_reverse
-- is also a point deduction and must stay append-only.
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; -- sales
DO $check$
BEGIN
  IF NOT pg_catalog.has_table_privilege('authenticated','public.loyalty_points','UPDATE')
     OR NOT pg_catalog.has_table_privilege('authenticated','public.loyalty_points','DELETE') THEN
    RAISE EXCEPTION 'fixture must permit staff ledger mutation to test trigger';
  END IF;
  IF pg_catalog.has_table_privilege('authenticated','public.loyalty_points','TRUNCATE')
     OR pg_catalog.has_table_privilege('service_role','public.loyalty_points','TRUNCATE') THEN
    RAISE EXCEPTION 'browser/service role can truncate loyalty history';
  END IF;
  BEGIN
    TRUNCATE TABLE public.loyalty_points;
    RAISE EXCEPTION 'staff truncated loyalty history';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    UPDATE public.loyalty_points SET type='earn'
      WHERE customer_id=103 AND type='redeem' AND ref_type='redemption';
    RAISE EXCEPTION 'staff rewrote redemption before finalization';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    DELETE FROM public.loyalty_points
      WHERE customer_id=103 AND type='redeem' AND ref_type='redemption';
    RAISE EXCEPTION 'staff deleted redemption before finalization';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    UPDATE public.loyalty_points SET points=0
      WHERE customer_id=104 AND type='redeem' AND ref_type='sale_reverse';
    RAISE EXCEPTION 'staff changed other-sale reversal';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    DELETE FROM public.loyalty_points
      WHERE customer_id=104 AND type='redeem' AND ref_type='sale_reverse';
    RAISE EXCEPTION 'staff deleted other-sale reversal';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    UPDATE public.loyalty_points SET ref_type='adjustment'
      WHERE customer_id=103 AND type='earn' AND ref_type='sale' AND ref_id=18;
    RAISE EXCEPTION 'staff hid target-sale earn before finalization';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    DELETE FROM public.loyalty_points
      WHERE customer_id=103 AND type='earn' AND ref_type='sale' AND ref_id=18;
    RAISE EXCEPTION 'staff deleted target-sale earn before finalization';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  IF (SELECT count(*) FROM public.loyalty_points
      WHERE customer_id=103 AND type='redeem' AND ref_type='redemption')<>1
     OR (SELECT count(*) FROM public.loyalty_points
         WHERE customer_id=104 AND type='redeem' AND ref_type='sale_reverse' AND points=1)<>1
     OR (SELECT count(*) FROM public.loyalty_points
         WHERE customer_id=103 AND type='earn' AND ref_type='sale' AND ref_id=18 AND points=5)<>1 THEN
    RAISE EXCEPTION 'blocked point mutation changed ledger';
  END IF;
  RAISE NOTICE 'PASS staff cannot erase redemption or sale-earn history before finalization';
END $check$;
RESET ROLE;
DO $check$
BEGIN
  IF (SELECT COALESCE(sum(CASE WHEN type='earn' THEN points
                                WHEN type='redeem' THEN -points ELSE 0 END),0)
      FROM public.loyalty_points WHERE customer_id=103)<>5
     OR (SELECT COALESCE(sum(points),0) FROM public.loyalty_points
         WHERE customer_id=103 AND type='earn' AND ref_type='sale' AND ref_id=18)<>5 THEN
    RAISE EXCEPTION 'replenished-loyalty counterexample is not balanced';
  END IF;
END $check$;
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; -- sales
DO $check$
DECLARE r public.credit_refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.phase646_submit_credit_refund(
    '00000000-0000-0000-0000-000000000099',18,
    '[{"sale_item_id":89,"qty":1}]'::jsonb,'credit','แต้มถูกใช้แล้วเติมกลับ',false,NULL,NULL);
  IF r.status<>'pending' OR r.quoted_amount<>40 THEN
    RAISE EXCEPTION 'replenished-loyalty fixture did not reach approval';
  END IF;
END $check$;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; -- admin
DO $check$
DECLARE r public.credit_refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.phase646_admin_decide_credit_refund(
    (SELECT id FROM public.credit_refund_requests WHERE sale_id=18),true,40,NULL);
  IF r.status<>'approved' THEN
    RAISE EXCEPTION 'replenished-loyalty request did not reach finalization';
  END IF;
  SELECT * INTO r FROM public.phase646_finalize_credit_refund(r.id,40);
  IF r.status<>'manual_review' OR r.review_reason<>'loyalty_spent_or_ambiguous'
     OR EXISTS (SELECT 1 FROM public.refunds WHERE sale_id=18)
     OR EXISTS (SELECT 1 FROM public.journal_entries
                WHERE doc_no='RF-P646-'||r.id::text)
     OR EXISTS (SELECT 1 FROM public.customer_credit_ledger WHERE customer_id=103)
     OR EXISTS (SELECT 1 FROM public.loyalty_points
                WHERE ref_type='sale_reverse' AND ref_id=18) THEN
    RAISE EXCEPTION 'replenished points wrongly permitted credit or reversal';
  END IF;
  RAISE NOTICE 'PASS replenished spent-loyalty sale remains manual with no side effects';
END $check$;
RESET ROLE;

-- Owner policy: any redemption history, including an older redemption and
-- another sale's reversal, requires manual review before credit is issued.
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; -- sales
DO $check$
DECLARE r public.credit_refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.phase646_submit_credit_refund(
    '00000000-0000-0000-0000-000000000090',20,
    '[{"sale_item_id":91,"qty":1}]'::jsonb,'credit','ใช้แต้มก่อนซื้อบิลนี้',false,NULL,NULL);
  IF r.status<>'pending' OR r.quoted_amount<>40 THEN
    RAISE EXCEPTION 'prior-redemption fixture did not reach approval';
  END IF;
END $check$;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; -- admin
DO $check$
DECLARE r public.credit_refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.phase646_admin_decide_credit_refund(
    (SELECT id FROM public.credit_refund_requests WHERE sale_id=20),true,40,NULL);
  IF r.status<>'approved' THEN
    RAISE EXCEPTION 'prior-redemption request did not reach finalization';
  END IF;
  SELECT * INTO r FROM public.phase646_finalize_credit_refund(r.id,40);
  IF r.status<>'manual_review' OR r.review_reason<>'loyalty_spent_or_ambiguous'
     OR EXISTS (SELECT 1 FROM public.refunds WHERE sale_id=20)
     OR (SELECT COALESCE(sum(amount),0) FROM public.customer_credit_ledger
         WHERE customer_id=104)<>0
     OR EXISTS (SELECT 1 FROM public.journal_entries
         WHERE doc_no='RF-P646-'||r.id::text)
     OR EXISTS (SELECT 1 FROM public.loyalty_points
         WHERE ref_type='sale_reverse' AND ref_id=20) THEN
    RAISE EXCEPTION 'prior redemption wrongly issued credit or reversal';
  END IF;
  RAISE NOTICE 'PASS prior redemption parks full refund without side effects';
END $check$;
RESET ROLE;

-- The approved conservative policy also parks a later sale with no earn row:
-- the ledger cannot allocate historical point deductions to a sale.
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; -- sales
DO $check$
DECLARE r public.credit_refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.phase646_submit_credit_refund(
    '00000000-0000-0000-0000-000000000087',22,
    '[{"sale_item_id":93,"qty":1}]'::jsonb,'credit','ไม่มีแต้มบิลนี้แต่เคยหักแต้ม',false,NULL,NULL);
  IF r.status<>'pending' OR r.quoted_amount<>25 THEN
    RAISE EXCEPTION 'zero-earned historical-redemption fixture did not reach approval';
  END IF;
END $check$;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; -- admin
DO $check$
DECLARE r public.credit_refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.phase646_admin_decide_credit_refund(
    (SELECT id FROM public.credit_refund_requests WHERE sale_id=22),true,25,NULL);
  IF r.status<>'approved' THEN
    RAISE EXCEPTION 'zero-earned historical-redemption request did not reach finalization';
  END IF;
  SELECT * INTO r FROM public.phase646_finalize_credit_refund(r.id,25);
  IF r.status<>'manual_review' OR r.review_reason<>'loyalty_spent_or_ambiguous'
     OR EXISTS (SELECT 1 FROM public.refunds WHERE sale_id=22)
     OR EXISTS (SELECT 1 FROM public.customer_credit_ledger WHERE customer_id=104)
     OR EXISTS (SELECT 1 FROM public.journal_entries
         WHERE doc_no='RF-P646-'||r.id::text) THEN
    RAISE EXCEPTION 'zero-earned historical-redemption sale issued credit';
  END IF;
  RAISE NOTICE 'PASS zero-earned sale with redemption history also remains manual';
END $check$;
RESET ROLE;

-- A late browser earn for an already completed credit-refunded sale must not
-- create points after the finalizer has committed its loyalty reversal.
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; -- POS staff
DO $check$
BEGIN
  BEGIN
    INSERT INTO public.loyalty_points(customer_id,points,type,ref_type,ref_id,note)
      VALUES (101,1,'earn','sale',9,'late earn after completed credit refund');
    RAISE EXCEPTION 'late sale earn passed completed refund guard';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    UPDATE public.loyalty_points SET points=6
      WHERE customer_id=101 AND type='earn' AND ref_type='sale' AND ref_id=9;
    RAISE EXCEPTION 'completed sale earn was mutable';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    DELETE FROM public.loyalty_points
      WHERE customer_id=101 AND type='earn' AND ref_type='sale' AND ref_id=9;
    RAISE EXCEPTION 'completed sale earn could be deleted';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    UPDATE public.loyalty_points SET points=0
      WHERE customer_id=101 AND type='redeem' AND ref_type='sale_reverse' AND ref_id=9;
    RAISE EXCEPTION 'completed sale reversal was mutable';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    DELETE FROM public.loyalty_points
      WHERE customer_id=101 AND type='redeem' AND ref_type='sale_reverse' AND ref_id=9;
    RAISE EXCEPTION 'completed sale reversal could be deleted';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  INSERT INTO public.loyalty_points(customer_id,points,type,ref_type,ref_id,note)
    VALUES (101,1,'earn','sale',17,'earn on other sale remains allowed');
  IF (SELECT count(*) FROM public.loyalty_points
      WHERE customer_id=101 AND type='earn' AND ref_type='sale' AND ref_id=17)<>1
     OR (SELECT count(*) FROM public.loyalty_points
         WHERE customer_id=101 AND type='redeem' AND ref_type='sale_reverse'
           AND ref_id=9 AND points=5)<>1 THEN
    RAISE EXCEPTION 'other-sale loyalty earn did not work';
  END IF;
  RAISE NOTICE 'PASS late earn blocked for completed sale; loyalty mutation blocked globally';
END $check$;
RESET ROLE;

-- The append-only guard must not break normal staff earning or the existing
-- Phase 540 redemption RPC for a customer without a completed credit refund.
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; -- sales
DO $check$
DECLARE redeemed public.loyalty_points%ROWTYPE;
BEGIN
  INSERT INTO public.loyalty_points(customer_id,points,type,ref_type,note)
    VALUES (107,2,'earn','adjustment','normal loyalty control');
  SELECT * INTO redeemed FROM public.redeem_loyalty_points_atomic(
    107,1,'normal redemption after Phase 646');
  IF redeemed.customer_id<>107 OR redeemed.type<>'redeem'
     OR redeemed.ref_type<>'redemption' OR redeemed.points<>1 THEN
    RAISE EXCEPTION 'normal Phase 540 redemption was blocked or changed';
  END IF;
  RAISE NOTICE 'PASS normal Phase 540 staff redemption still works';
END $check$;
RESET ROLE;
SELECT 'PHASE646 LOCAL PASS';
