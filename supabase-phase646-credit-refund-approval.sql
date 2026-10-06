-- Phase 646 LOCAL CANDIDATE: approved full-sale credit refund in one transaction.
-- NOT RELEASED: independent review and exact-SHA owner approval are still required.
-- DO NOT APPLY to staging or production from this worktree.
-- B1 redeem/release RPC definitions and B2 active-sale release are untouched.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $gate$
DECLARE
  v_ledger oid := pg_catalog.to_regclass('public.customer_credit_ledger');
  v_refunds oid := pg_catalog.to_regclass('public.refunds');
BEGIN
  IF current_user <> 'postgres' OR pg_catalog.current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'Phase 646 STOP: expected postgres on PostgreSQL 17+';
  END IF;
  IF v_ledger IS NULL OR v_refunds IS NULL
     OR pg_catalog.to_regclass('public.sales') IS NULL
     OR pg_catalog.to_regclass('public.sale_items') IS NULL
     OR pg_catalog.to_regclass('public.products') IS NULL
     OR pg_catalog.to_regclass('public.product_bundles') IS NULL
     OR pg_catalog.to_regclass('public.warehouse_stock') IS NULL
     OR pg_catalog.to_regclass('public.stock_movements') IS NULL
     OR pg_catalog.to_regclass('public.loyalty_points') IS NULL
     OR pg_catalog.to_regclass('public.journal_entries') IS NULL
     OR pg_catalog.to_regclass('public.journal_lines') IS NULL
     OR pg_catalog.to_regclass('public.chart_of_accounts') IS NULL
     OR pg_catalog.to_regclass('public.account_mapping') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.customers') IS NULL THEN
    RAISE EXCEPTION 'Phase 646 STOP: required source table missing';
  END IF;
  IF pg_catalog.to_regclass('public.credit_refund_requests') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.phase646_submit_credit_refund(uuid,bigint,jsonb,text,text,boolean,bigint,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.phase646_admin_decide_credit_refund(bigint,boolean,numeric,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.phase646_finalize_credit_refund(bigint,numeric)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.phase646_is_credit_staff()') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.phase646_stock_return_proven(bigint,bigint,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.phase646_protect_refunded_sale()') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.phase646_protect_refunded_sale_items()') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.phase646_protect_refunded_sale_points()') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.phase646_block_completed_sale_refund()') IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 646 STOP: object already exists; inspect, do not rerun';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=v_ledger
                 AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
                 AND pg_catalog.pg_get_userbyid(c.relowner)='postgres')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=v_refunds
                    AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
                    AND pg_catalog.pg_get_userbyid(c.relowner)='postgres')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                    WHERE c.oid='public.loyalty_points'::pg_catalog.regclass
                      AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
                      AND pg_catalog.pg_get_userbyid(c.relowner)='postgres') THEN
    RAISE EXCEPTION 'Phase 646 STOP: refund, ledger or loyalty owner/RLS shape drift';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_ledger
             AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'Phase 646 STOP: column-level ledger grants need separate review';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname='public'
                 AND p.tablename='customer_credit_ledger' AND p.policyname='ccl_staff_rw'
                 AND p.cmd='ALL' AND p.permissive='PERMISSIVE')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname='public'
                    AND p.tablename='customer_credit_ledger' AND p.policyname='ccl_deny_customer'
                    AND p.cmd='ALL' AND p.permissive='RESTRICTIVE')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=v_refunds
                    AND t.tgname='trg_guard_refunds_insert' AND t.tgenabled='O') THEN
    RAISE EXCEPTION 'Phase 646 STOP: policy or refund guard drift';
  END IF;
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure('public.is_admin()') IS NULL
     OR pg_catalog.to_regprocedure('public.is_customer_role()') IS NULL THEN
    RAISE EXCEPTION 'Phase 646 STOP: trusted auth helper missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.products'::pg_catalog.regclass,'is_bundle'),
      ('public.products'::pg_catalog.regclass,'product_type'),
      ('public.chart_of_accounts'::pg_catalog.regclass,'is_active'),
      ('public.journal_entries'::pg_catalog.regclass,'created_by'),
      ('public.journal_entries'::pg_catalog.regclass,'approved_by'),
      ('public.sales'::pg_catalog.regclass,'customer_name'),
      ('public.sales'::pg_catalog.regclass,'order_no'),
      ('public.sales'::pg_catalog.regclass,'note')
    ) required(rel,col)
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                      WHERE a.attrelid=required.rel AND a.attname=required.col
                        AND a.attnum>0 AND NOT a.attisdropped)
  ) THEN
    RAISE EXCEPTION 'Phase 646 STOP: required live column missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
                 WHERE schemaname='public' AND tablename='loyalty_points'
                   AND indexname='uq_loyalty_sale_reverse')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
                    WHERE schemaname='public' AND tablename='customer_credit_ledger'
                      AND indexname='uq_ccl_source')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
                    WHERE schemaname='public' AND tablename='journal_entries'
                      AND indexname='idx_je_source_unique')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                    WHERE tgrelid='public.warehouse_stock'::pg_catalog.regclass
                      AND tgname='trg_sync_product_stock' AND tgenabled='O')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                    WHERE tgrelid='public.journal_lines'::pg_catalog.regclass
                      AND tgname='trg_je_lines_balance' AND tgenabled='O')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                    WHERE tgrelid='public.journal_entries'::pg_catalog.regclass
                      AND tgname='trg_check_period_locked' AND tgenabled='O') THEN
    RAISE EXCEPTION 'Phase 646 STOP: idempotency or stock-sync guard missing';
  END IF;
END;
$gate$;

-- Trusted profile lookup for ledger SELECT. SECURITY DEFINER avoids requiring
-- broad profiles table grants or recursive RLS policy evaluation. A missing
-- profile is not staff and cannot read another customer's credit history.
CREATE FUNCTION public.phase646_is_credit_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $staff$
  SELECT EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id=auth.uid()
                   AND p.role IN ('admin','sales','technician','accountant'))
$staff$;
REVOKE ALL ON FUNCTION public.phase646_is_credit_staff()
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.phase646_is_credit_staff() TO authenticated;

-- Only restock a sale whose original warehouse deduction has a complete,
-- unambiguous movement trail. Earlier POS versions could save a sale item
-- despite stock/log failure. Missing/mismatched evidence goes to manual_review.
CREATE FUNCTION public.phase646_stock_return_proven(
  p_sale_id bigint,p_warehouse_id bigint,p_order_no text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $proof$
  WITH sold AS (
    SELECT si.product_id,pg_catalog.sum(si.qty) AS qty
    FROM public.sale_items si WHERE si.sale_id=p_sale_id
    GROUP BY si.product_id
  ), moved AS (
    SELECT m.product_id,pg_catalog.sum(m.qty) AS qty
    FROM public.stock_movements m
    WHERE m.type='sale' AND p_order_no IS NOT NULL
      AND pg_catalog.left(m.note,pg_catalog.length('ขายบิล '||p_order_no||' — คลัง:'))
          ='ขายบิล '||p_order_no||' — คลัง:'
    GROUP BY m.product_id
  )
  SELECT p_order_no IS NOT NULL AND p_warehouse_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM sold)
     AND NOT EXISTS (SELECT 1 FROM public.sale_items si
                     WHERE si.sale_id=p_sale_id
                       AND si.warehouse_id IS DISTINCT FROM p_warehouse_id)
     AND NOT EXISTS (SELECT 1 FROM sold s FULL JOIN moved m USING(product_id)
                     WHERE s.qty IS DISTINCT FROM m.qty)
$proof$;
REVOKE ALL ON FUNCTION public.phase646_stock_return_proven(bigint,bigint,text)
  FROM PUBLIC,anon,authenticated,service_role;

-- Request is an immutable intent, NOT a refund and NOT customer credit.
-- For a complete sale, quoted_amount is the server-derived sales.total_amount
-- after discounts (not a sum of unit prices). It is displayed before approval.
-- An older VAT-bearing or ambiguous sale stops for manual review.
CREATE TABLE public.credit_refund_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_key uuid NOT NULL UNIQUE,
  sale_id bigint NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  items_json jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(items_json)='array'
                                   AND pg_catalog.jsonb_array_length(items_json)>0),
  quoted_amount numeric(14,2) NOT NULL CHECK (quoted_amount>0),
  refund_method text NOT NULL CHECK (refund_method IN ('credit','exchange')),
  reason text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(reason))>0),
  restock boolean NOT NULL,
  warehouse_id bigint,
  note text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','manual_review','completed')),
  review_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  finalized_by uuid,
  finalized_at timestamptz,
  refund_id bigint UNIQUE REFERENCES public.refunds(id) ON DELETE RESTRICT,
  CONSTRAINT phase646_warehouse_if_restock CHECK (NOT restock OR warehouse_id IS NOT NULL)
);

ALTER TABLE public.credit_refund_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.credit_refund_requests FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.credit_refund_requests TO authenticated;
CREATE POLICY phase646_request_read ON public.credit_refund_requests
  FOR SELECT TO authenticated
  USING ((created_by=auth.uid() OR public.is_admin())
         AND NOT COALESCE(public.is_customer_role(),false));

CREATE FUNCTION public.phase646_submit_credit_refund(
  p_request_key uuid,
  p_sale_id bigint,
  p_items jsonb,
  p_method text,
  p_reason text,
  p_restock boolean,
  p_warehouse_id bigint,
  p_note text
) RETURNS public.credit_refund_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_sale public.sales%ROWTYPE;
  v_count integer;
  v_distinct_count integer;
  v_sale_item_count integer;
  v_items jsonb;
  v_quote numeric;
  v_line_gross numeric;
  v_review_reason text;
  v_existing public.credit_refund_requests%ROWTYPE;
  v_row public.credit_refund_requests%ROWTYPE;
BEGIN
  -- SECURITY DEFINER must validate the effective DB role and trusted profile;
  -- JWT metadata and browser role flags are never an approval source.
  IF pg_catalog.current_setting('role',true) IS DISTINCT FROM 'authenticated'
     OR v_uid IS NULL THEN
    RAISE EXCEPTION 'credit refund request not authorized' USING ERRCODE='42501';
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id=v_uid;
  IF v_role IS NULL OR v_role NOT IN ('admin','sales') THEN
    RAISE EXCEPTION 'credit refund request not authorized' USING ERRCODE='42501';
  END IF;
  IF p_request_key IS NULL OR p_sale_id IS NULL OR p_sale_id<=0
     OR p_method NOT IN ('credit','exchange') OR p_method IS NULL
     OR p_reason IS NULL OR pg_catalog.length(pg_catalog.btrim(p_reason))=0
     OR p_restock IS NULL OR (p_restock AND (p_warehouse_id IS NULL OR p_warehouse_id<=0))
     OR p_items IS NULL OR pg_catalog.jsonb_typeof(p_items)<>'array'
     OR pg_catalog.jsonb_array_length(p_items)<1 OR pg_catalog.jsonb_array_length(p_items)>100 THEN
    RAISE EXCEPTION 'invalid credit refund request' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) x
             WHERE pg_catalog.jsonb_typeof(x)<>'object'
                OR pg_catalog.jsonb_typeof(x->'sale_item_id')<>'number'
                OR pg_catalog.jsonb_typeof(x->'qty')<>'number') THEN
    RAISE EXCEPTION 'invalid credit refund items' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) x
             WHERE (x->>'sale_item_id')::numeric<=0
                OR (x->>'sale_item_id')::numeric<>pg_catalog.trunc((x->>'sale_item_id')::numeric)
                OR (x->>'qty')::numeric<=0
                OR (x->>'qty')::numeric<>pg_catalog.trunc((x->>'qty')::numeric)) THEN
    RAISE EXCEPTION 'invalid credit refund quantities' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id=p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.customer_id IS NULL
     OR pg_catalog.strpos(COALESCE(v_sale.note,''),'[ลบแล้ว]')>0 THEN
    RAISE EXCEPTION 'sale/customer unavailable for credit refund' USING ERRCODE='23514';
  END IF;

  WITH requested AS (
    SELECT (x->>'sale_item_id')::bigint AS sale_item_id,
           (x->>'qty')::numeric AS qty
    FROM pg_catalog.jsonb_array_elements(p_items) x
  ), matched AS (
    SELECT r.sale_item_id, r.qty, si.product_id, si.product_name,
           si.unit_price, si.qty AS sold_qty
    FROM requested r
    JOIN public.sale_items si ON si.id=r.sale_item_id AND si.sale_id=p_sale_id
  )
  SELECT pg_catalog.count(*), pg_catalog.count(DISTINCT sale_item_id),
         pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'sale_item_id',sale_item_id,'product_id',product_id,'name',product_name,
           'qty',qty,'unit_price',unit_price) ORDER BY sale_item_id),
         pg_catalog.round(pg_catalog.sum(qty*unit_price),2)
    INTO v_count,v_distinct_count,v_items,v_quote
  FROM matched WHERE qty<=sold_qty AND unit_price>=0;
  IF v_count<>pg_catalog.jsonb_array_length(p_items)
     OR v_distinct_count<>v_count OR v_quote IS NULL OR v_quote<=0 THEN
    RAISE EXCEPTION 'credit refund items do not match sale' USING ERRCODE='23514';
  END IF;

  -- Partial returns are not automatically approvable: the discount split and
  -- loyalty reversal need a human decision. Compare IDs and quantities, not
  -- just aggregate value or product name. A prior refund also needs review.
  SELECT pg_catalog.count(*) INTO v_sale_item_count
    FROM public.sale_items WHERE sale_id=p_sale_id;
  v_line_gross := v_quote;
  IF v_count<>v_sale_item_count OR EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(v_items) x
    JOIN public.sale_items si ON si.id=(x->>'sale_item_id')::bigint
    WHERE si.sale_id=p_sale_id AND (x->>'qty')::numeric IS DISTINCT FROM si.qty
  ) THEN
    v_review_reason := 'partial_return';
  ELSIF EXISTS (SELECT 1 FROM public.refunds WHERE sale_id=p_sale_id) THEN
    v_review_reason := 'prior_refund';
  ELSIF v_sale.vat_amount IS NULL OR v_sale.vat_rate IS NULL
     OR v_sale.vat_amount<>0 OR v_sale.vat_rate<>0 THEN
    v_review_reason := 'historical_vat';
  ELSIF v_sale.stock_reverted_at IS NOT NULL OR COALESCE(v_sale.is_credit,false) THEN
    v_review_reason := 'sale_state_ambiguous';
  ELSIF v_sale.total_amount IS NULL OR v_sale.total_amount<=0
     OR v_sale.total_amount<>pg_catalog.round(v_sale.total_amount,2)
     OR v_sale.subtotal IS NULL OR v_sale.discount_amount IS NULL
     OR pg_catalog.round(v_sale.subtotal-v_sale.discount_amount,2)
        IS DISTINCT FROM v_sale.total_amount
     OR v_sale.total_amount>v_line_gross+0.01
     OR COALESCE(v_sale.paid_amount,0)-COALESCE(v_sale.change_amount,0)
        +COALESCE(v_sale.credit_used_amount,0) < v_sale.total_amount-0.01 THEN
    v_review_reason := 'sale_net_ambiguous';
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.source_table='sales' AND e.source_id=p_sale_id
      AND e.status='approved'
      AND e.total_debit=v_sale.total_amount AND e.total_credit=v_sale.total_amount
  ) THEN
    v_review_reason := 'sale_journal_missing';
  ELSIF p_restock AND EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(v_items) x
    LEFT JOIN public.products p ON p.id=(x->>'product_id')::bigint
    WHERE p.id IS NULL OR COALESCE(p.is_bundle,false)
       OR EXISTS (SELECT 1 FROM public.product_bundles b WHERE b.bundle_id=p.id)
       OR p.product_type IS DISTINCT FROM 'stock'
  ) THEN
    v_review_reason := 'stock_return_ambiguous';
  ELSIF p_restock AND NOT public.phase646_stock_return_proven(
      p_sale_id,p_warehouse_id,v_sale.order_no) THEN
    v_review_reason := 'stock_return_ambiguous';
  END IF;
  IF v_review_reason IS NULL THEN
    v_quote := pg_catalog.round(v_sale.total_amount,2);
  ELSIF v_review_reason<>'partial_return' AND v_sale.total_amount>0 THEN
    -- Review-only requests still show the server's sale net, never the gross
    -- line estimate as an approvable amount.
    v_quote := pg_catalog.round(v_sale.total_amount,2);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('p646:'||p_request_key::text,0));
  SELECT * INTO v_existing FROM public.credit_refund_requests
    WHERE request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.created_by IS DISTINCT FROM v_uid
       OR v_existing.sale_id IS DISTINCT FROM p_sale_id
       OR v_existing.customer_id IS DISTINCT FROM v_sale.customer_id
       OR v_existing.items_json IS DISTINCT FROM v_items
       OR v_existing.refund_method IS DISTINCT FROM p_method
       OR v_existing.reason IS DISTINCT FROM p_reason
       OR v_existing.restock IS DISTINCT FROM p_restock
       OR v_existing.warehouse_id IS DISTINCT FROM (CASE WHEN p_restock THEN p_warehouse_id ELSE NULL END)
       OR v_existing.note IS DISTINCT FROM p_note THEN
      RAISE EXCEPTION 'request key reused with changed payload' USING ERRCODE='23514';
    END IF;
    RETURN v_existing;
  END IF;

  INSERT INTO public.credit_refund_requests
    (request_key,sale_id,customer_id,items_json,quoted_amount,refund_method,
     reason,restock,warehouse_id,note,status,review_reason,created_by)
  VALUES
    (p_request_key,p_sale_id,v_sale.customer_id,v_items,v_quote,p_method,
     p_reason,p_restock,CASE WHEN p_restock THEN p_warehouse_id ELSE NULL END,p_note,
     CASE WHEN v_review_reason IS NULL THEN 'pending' ELSE 'manual_review' END,
     v_review_reason,v_uid)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;
REVOKE ALL ON FUNCTION public.phase646_submit_credit_refund(uuid,bigint,jsonb,text,text,boolean,bigint,text)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.phase646_submit_credit_refund(uuid,bigint,jsonb,text,text,boolean,bigint,text)
  TO authenticated;

-- Approval records the exact immutable item snapshot and sale net confirmed
-- on screen. It does not create a refund/JV/stock/loyalty/ledger row.
CREATE FUNCTION public.phase646_admin_decide_credit_refund(
  p_request_id bigint,
  p_approve boolean,
  p_expected_quote numeric,
  p_reason text DEFAULT NULL
) RETURNS public.credit_refund_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $decision$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_req public.credit_refund_requests%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_count integer;
  v_sale_item_count integer;
  v_items jsonb;
  v_quote numeric;
  v_line_gross numeric;
  v_bad integer;
BEGIN
  IF pg_catalog.current_setting('role',true) IS DISTINCT FROM 'authenticated'
     OR v_uid IS NULL THEN
    RAISE EXCEPTION 'credit refund approval not authorized' USING ERRCODE='42501';
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id=v_uid;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'credit refund approval not authorized' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR p_request_id<=0 OR p_approve IS NULL THEN
    RAISE EXCEPTION 'invalid credit refund decision' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_req FROM public.credit_refund_requests
    WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit refund request not found' USING ERRCODE='23514';
  END IF;
  IF v_req.status<>'pending' THEN
    IF v_req.status='approved' AND p_approve
       AND p_expected_quote IS NOT DISTINCT FROM v_req.quoted_amount THEN
      RETURN v_req; -- idempotent status read; no second approval event
    END IF;
    RAISE EXCEPTION 'credit refund request already decided' USING ERRCODE='23514';
  END IF;

  IF NOT p_approve THEN
    IF p_reason IS NULL OR pg_catalog.length(pg_catalog.btrim(p_reason))=0 THEN
      RAISE EXCEPTION 'rejection reason required' USING ERRCODE='23514';
    END IF;
    UPDATE public.credit_refund_requests SET status='rejected',
      decided_by=v_uid,decided_at=pg_catalog.now(),decision_reason=p_reason
    WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;

  IF p_expected_quote IS NULL OR p_expected_quote IS DISTINCT FROM v_req.quoted_amount THEN
    RAISE EXCEPTION 'approved quote differs from request' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id=v_req.sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.customer_id IS DISTINCT FROM v_req.customer_id
     OR pg_catalog.strpos(COALESCE(v_sale.note,''),'[ลบแล้ว]')>0 THEN
    RAISE EXCEPTION 'sale/customer changed since request' USING ERRCODE='23514';
  END IF;

  WITH requested AS (
    SELECT (x->>'sale_item_id')::bigint AS sale_item_id,
           (x->>'qty')::numeric AS qty
    FROM pg_catalog.jsonb_array_elements(v_req.items_json) x
  ), matched AS (
    SELECT r.sale_item_id,r.qty,si.product_id,si.product_name,si.unit_price,
           si.qty AS sold_qty
    FROM requested r
    JOIN public.sale_items si ON si.id=r.sale_item_id AND si.sale_id=v_req.sale_id
  )
  SELECT pg_catalog.count(*),
         pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'sale_item_id',sale_item_id,'product_id',product_id,'name',product_name,
           'qty',qty,'unit_price',unit_price) ORDER BY sale_item_id),
         pg_catalog.round(pg_catalog.sum(qty*unit_price),2)
    INTO v_count,v_items,v_quote
  FROM matched WHERE qty<=sold_qty AND unit_price>=0;
  IF v_count<>pg_catalog.jsonb_array_length(v_req.items_json)
     OR v_items IS DISTINCT FROM v_req.items_json THEN
    RAISE EXCEPTION 'credit refund request is stale' USING ERRCODE='23514';
  END IF;
  v_line_gross := v_quote;

  -- A whole-sale request can become partial while waiting for admin. Pause it
  -- rather than approving a stale discount/loyalty decision.
  SELECT pg_catalog.count(*) INTO v_sale_item_count
    FROM public.sale_items WHERE sale_id=v_req.sale_id;
  IF v_count<>v_sale_item_count OR EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(v_req.items_json) x
    JOIN public.sale_items si ON si.id=(x->>'sale_item_id')::bigint
    WHERE si.sale_id=v_req.sale_id AND (x->>'qty')::numeric IS DISTINCT FROM si.qty
  ) THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='partial_return'
    WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;
  IF EXISTS (SELECT 1 FROM public.refunds WHERE sale_id=v_req.sale_id) THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='prior_refund'
    WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;
  IF v_sale.vat_amount IS NULL OR v_sale.vat_rate IS NULL
     OR v_sale.vat_amount<>0 OR v_sale.vat_rate<>0 THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='historical_vat'
    WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;
  IF v_sale.stock_reverted_at IS NOT NULL OR COALESCE(v_sale.is_credit,false) THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='sale_state_ambiguous'
    WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;
  IF v_sale.total_amount IS NULL OR v_sale.total_amount<=0
     OR v_sale.total_amount<>pg_catalog.round(v_sale.total_amount,2)
     OR v_sale.subtotal IS NULL OR v_sale.discount_amount IS NULL
     OR pg_catalog.round(v_sale.subtotal-v_sale.discount_amount,2)
        IS DISTINCT FROM v_sale.total_amount
     OR v_sale.total_amount>v_line_gross+0.01
     OR COALESCE(v_sale.paid_amount,0)-COALESCE(v_sale.change_amount,0)
        +COALESCE(v_sale.credit_used_amount,0) < v_sale.total_amount-0.01 THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='sale_net_ambiguous'
    WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;
  v_quote := pg_catalog.round(v_sale.total_amount,2);
  IF v_quote IS DISTINCT FROM v_req.quoted_amount THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='sale_net_changed'
    WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.source_table='sales' AND e.source_id=v_req.sale_id
      AND e.status='approved'
      AND e.total_debit=v_sale.total_amount AND e.total_credit=v_sale.total_amount
  ) THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='sale_journal_missing'
    WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;
  IF v_req.restock AND EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(v_req.items_json) x
    LEFT JOIN public.products p ON p.id=(x->>'product_id')::bigint
    WHERE p.id IS NULL OR COALESCE(p.is_bundle,false)
       OR EXISTS (SELECT 1 FROM public.product_bundles b WHERE b.bundle_id=p.id)
       OR p.product_type IS DISTINCT FROM 'stock'
  ) THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='stock_return_ambiguous'
    WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;
  IF v_req.restock AND NOT public.phase646_stock_return_proven(
      v_req.sale_id,v_req.warehouse_id,v_sale.order_no) THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='stock_return_ambiguous'
    WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;

  -- Prior refunds are counted by product ID (or name for custom rows), matching
  -- the existing client guard. This check is repeated at finalization under the
  -- sale lock; approval alone never reserves quantity.
  WITH wanted AS (
    SELECT CASE WHEN x->>'product_id' IS NOT NULL
                THEN 'p:'||(x->>'product_id') ELSE 'n:'||(x->>'name') END AS item_key,
           pg_catalog.sum((x->>'qty')::numeric) AS qty
    FROM pg_catalog.jsonb_array_elements(v_req.items_json) x
    GROUP BY 1
  ), sold AS (
    SELECT CASE WHEN si.product_id IS NOT NULL
                THEN 'p:'||si.product_id::text ELSE 'n:'||si.product_name END AS item_key,
           pg_catalog.sum(si.qty) AS qty
    FROM public.sale_items si WHERE si.sale_id=v_req.sale_id GROUP BY 1
  ), prior AS (
    SELECT CASE WHEN x->>'product_id' IS NOT NULL
                THEN 'p:'||(x->>'product_id') ELSE 'n:'||(x->>'name') END AS item_key,
           pg_catalog.sum((x->>'qty')::numeric) AS qty
    FROM public.refunds r
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(r.items_json) x
    WHERE r.sale_id=v_req.sale_id AND pg_catalog.jsonb_typeof(r.items_json)='array'
    GROUP BY 1
  )
  SELECT pg_catalog.count(*) INTO v_bad FROM wanted w
  LEFT JOIN sold s USING(item_key)
  LEFT JOIN prior p USING(item_key)
  WHERE w.qty+COALESCE(p.qty,0)>COALESCE(s.qty,0);
  IF v_bad>0 THEN
    RAISE EXCEPTION 'requested quantity is no longer refundable' USING ERRCODE='23514';
  END IF;

  UPDATE public.credit_refund_requests SET status='approved',
    decided_by=v_uid,decided_at=pg_catalog.now(),decision_reason=NULL
  WHERE id=v_req.id RETURNING * INTO v_req;
  RETURN v_req;
END;
$decision$;
REVOKE ALL ON FUNCTION public.phase646_admin_decide_credit_refund(bigint,boolean,numeric,text)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.phase646_admin_decide_credit_refund(bigint,boolean,numeric,text)
  TO authenticated;

-- A single SECURITY DEFINER call owns every financial effect. A normal error
-- rolls back the inner subtransaction and records manual_review outside it.
-- Cancellation/connection loss rolls back the entire call; the approved row
-- remains safe to inspect/retry. The request row and sale row serialize two
-- competing Phase 646 calls; the existing unique source indexes are backups.
CREATE FUNCTION public.phase646_finalize_credit_refund(
  p_request_id bigint,
  p_expected_net numeric
) RETURNS public.credit_refund_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $finalize$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_req public.credit_refund_requests%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_count integer;
  v_distinct_count integer;
  v_sale_item_count integer;
  v_items jsonb;
  v_gross numeric;
  v_amount numeric(14,2);
  v_refund_id bigint;
  v_entry_id bigint;
  v_rows integer;
  v_item record;
  v_earned numeric;
  v_balance numeric;
  v_reverse numeric;
  v_error_code text;
BEGIN
  IF pg_catalog.current_setting('role',true) IS DISTINCT FROM 'authenticated'
     OR v_uid IS NULL THEN
    RAISE EXCEPTION 'credit refund finalization not authorized' USING ERRCODE='42501';
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id=v_uid;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'credit refund finalization not authorized' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR p_request_id<=0 OR p_expected_net IS NULL THEN
    RAISE EXCEPTION 'invalid credit refund finalization' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_req FROM public.credit_refund_requests
    WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit refund request not found' USING ERRCODE='23514';
  END IF;
  IF v_req.quoted_amount IS DISTINCT FROM p_expected_net THEN
    RAISE EXCEPTION 'expected net differs from approved request' USING ERRCODE='23514';
  END IF;
  IF v_req.status IN ('completed','manual_review') THEN
    RETURN v_req; -- status read only: no second refund or credit
  END IF;
  IF v_req.status<>'approved' OR v_req.decided_by IS NULL OR v_req.decided_at IS NULL THEN
    RAISE EXCEPTION 'admin approval required before finalization' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id=v_req.sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.customer_id IS DISTINCT FROM v_req.customer_id
     OR pg_catalog.strpos(COALESCE(v_sale.note,''),'[ลบแล้ว]')>0 THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='sale_changed' WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;
  -- Hold the entire item set stable, including phantom INSERTs, until the
  -- refund/stock/JV/loyalty/ledger transaction commits. Row locks alone do
  -- not stop a new sale_item appearing between validation and restock.
  LOCK TABLE public.sale_items IN SHARE ROW EXCLUSIVE MODE;
  -- Old cash/transfer writes do not lock sales. Serialize with them while
  -- checking prior refunds; a later legacy insert still meets its qty guard.
  LOCK TABLE public.refunds IN SHARE ROW EXCLUSIVE MODE;
  WITH requested AS (
    SELECT (x->>'sale_item_id')::bigint AS sale_item_id,
           (x->>'qty')::numeric AS qty
    FROM pg_catalog.jsonb_array_elements(v_req.items_json) x
  ), matched AS (
    SELECT r.sale_item_id,r.qty,si.product_id,si.product_name,
           si.unit_price,si.qty AS sold_qty,si.line_total
    FROM requested r
    JOIN public.sale_items si ON si.id=r.sale_item_id AND si.sale_id=v_req.sale_id
  )
  SELECT pg_catalog.count(*),pg_catalog.count(DISTINCT sale_item_id),
         pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'sale_item_id',sale_item_id,'product_id',product_id,'name',product_name,
           'qty',qty,'unit_price',unit_price) ORDER BY sale_item_id),
         pg_catalog.round(pg_catalog.sum(line_total),2)
    INTO v_count,v_distinct_count,v_items,v_gross
  FROM matched WHERE qty=sold_qty AND qty>0 AND unit_price>=0 AND line_total>=0;
  SELECT pg_catalog.count(*) INTO v_sale_item_count
    FROM public.sale_items WHERE sale_id=v_req.sale_id;
  IF v_count<>v_sale_item_count OR v_distinct_count<>v_count
     OR v_items IS DISTINCT FROM v_req.items_json
     OR EXISTS (SELECT 1 FROM public.refunds WHERE sale_id=v_req.sale_id)
     OR v_sale.stock_reverted_at IS NOT NULL OR COALESCE(v_sale.is_credit,false)
     OR v_sale.vat_amount IS NULL OR v_sale.vat_rate IS NULL
     OR v_sale.vat_amount<>0 OR v_sale.vat_rate<>0
     OR v_sale.total_amount IS NULL OR v_sale.total_amount<=0
     OR v_sale.total_amount<>pg_catalog.round(v_sale.total_amount,2)
     OR v_sale.subtotal IS NULL OR v_sale.discount_amount IS NULL
     OR pg_catalog.round(v_sale.subtotal-v_sale.discount_amount,2)
        IS DISTINCT FROM v_sale.total_amount
     OR v_sale.total_amount>v_gross+0.01
     OR COALESCE(v_sale.paid_amount,0)-COALESCE(v_sale.change_amount,0)
        +COALESCE(v_sale.credit_used_amount,0)<v_sale.total_amount-0.01
     OR v_sale.total_amount IS DISTINCT FROM v_req.quoted_amount
     OR NOT EXISTS (
       SELECT 1 FROM public.journal_entries e
       WHERE e.source_table='sales' AND e.source_id=v_req.sale_id
         AND e.status='approved'
         AND e.total_debit=v_sale.total_amount AND e.total_credit=v_sale.total_amount
     ) THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='finalization_source_changed'
    WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;
  v_amount := v_sale.total_amount; -- already net after sale discounts; no VAT added
  IF v_req.restock AND EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(v_req.items_json) x
    LEFT JOIN public.products p ON p.id=(x->>'product_id')::bigint
    WHERE p.id IS NULL OR COALESCE(p.is_bundle,false)
       OR EXISTS (SELECT 1 FROM public.product_bundles b WHERE b.bundle_id=p.id)
       OR p.product_type IS DISTINCT FROM 'stock'
       OR NOT EXISTS (SELECT 1 FROM public.warehouse_stock w
                      WHERE w.product_id=p.id AND w.warehouse_id=v_req.warehouse_id)
  ) THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='stock_return_ambiguous'
    WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;
  IF v_req.restock AND NOT public.phase646_stock_return_proven(
      v_req.sale_id,v_req.warehouse_id,v_sale.order_no) THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='stock_return_ambiguous'
    WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;
  -- Freeze the customer's points during finalization. If any points earned
  -- from this sale were already spent, a full reversal is not provable; park
  -- the request before creating a refund or credit instead of reversing only
  -- the remaining points while still crediting the full sale amount.
  -- Match Phase 540 redeem_loyalty_points_atomic's per-customer lock order.
  -- Taking this advisory lock before the table lock avoids a redeem/insert
  -- deadlock while the sale points balance is checked.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('loyalty:'||v_req.customer_id::text,0));
  LOCK TABLE public.loyalty_points IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.loyalty_points
             WHERE ref_type='sale_reverse' AND ref_id=v_req.sale_id)
     OR EXISTS (SELECT 1 FROM public.loyalty_points
                WHERE ref_type='sale' AND ref_id=v_req.sale_id
                  AND type='earn' AND customer_id IS DISTINCT FROM v_req.customer_id) THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='loyalty_source_ambiguous'
      WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;
  SELECT COALESCE(pg_catalog.sum(points),0) INTO v_earned
    FROM public.loyalty_points
    WHERE ref_type='sale' AND ref_id=v_req.sale_id
      AND type='earn' AND customer_id=v_req.customer_id;
  SELECT COALESCE(pg_catalog.sum(CASE WHEN type='earn' THEN points
                                       WHEN type='redeem' THEN -points ELSE 0 END),0)
    INTO v_balance FROM public.loyalty_points
    WHERE customer_id=v_req.customer_id;
  -- The ledger does not allocate redeemed points to a particular earn row.
  -- A later earn can replenish the aggregate balance after points were spent:
  -- sale A +5, redeem 3, sale B +3 leaves 5 but cannot prove A is unspent.
  -- Ledger IDs/timestamps are not immutable proof of which sale funded a
  -- redemption. Owner policy: ANY historical redeem (including another
  -- sale's reversal or a redemption predating this sale) parks a full-sale
  -- credit refund for manual review. Never claw back points from a different
  -- sale or issue spendable credit while point allocation is ambiguous.
  IF v_earned<0 OR v_balance<v_earned
     OR EXISTS (
       SELECT 1 FROM public.loyalty_points spent
       WHERE spent.customer_id=v_req.customer_id AND spent.type='redeem'
     ) THEN
    UPDATE public.credit_refund_requests SET status='manual_review',
      review_reason='loyalty_spent_or_ambiguous'
      WHERE id=v_req.id RETURNING * INTO v_req;
    RETURN v_req;
  END IF;

  BEGIN
    -- The trigger below accepts a credit refund only from this postgres-owned
    -- finalizer after the approved request has been locked and rechecked.
    PERFORM pg_catalog.set_config('phase646.finalizing_request_id',v_req.id::text,true);
    INSERT INTO public.refunds
      (refund_no,sale_id,customer_id,customer_name,reason,refund_method,
       refund_amount,items_json,restocked,warehouse_id,note,created_by)
    SELECT 'RF-P646-'||v_req.id::text,v_req.sale_id,v_req.customer_id,
           v_sale.customer_name,v_req.reason,v_req.refund_method,v_amount,
           pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'sale_item_id',(x->>'sale_item_id')::bigint,
             'product_id',si.product_id,'name',si.product_name,
             'qty',si.qty,'unit_price',si.unit_price)
             ORDER BY si.id),false,v_req.warehouse_id,v_req.note,v_uid::text
    FROM pg_catalog.jsonb_array_elements(v_req.items_json) x
    JOIN public.sale_items si ON si.id=(x->>'sale_item_id')::bigint
    RETURNING id INTO v_refund_id;

    IF v_req.restock THEN
      FOR v_item IN
        SELECT si.product_id,si.qty
        FROM pg_catalog.jsonb_array_elements(v_req.items_json) x
        JOIN public.sale_items si ON si.id=(x->>'sale_item_id')::bigint
        ORDER BY si.id
      LOOP
        UPDATE public.warehouse_stock SET stock=stock+v_item.qty
          WHERE product_id=v_item.product_id AND warehouse_id=v_req.warehouse_id;
        GET DIAGNOSTICS v_rows=ROW_COUNT;
        IF v_rows<>1 THEN
          RAISE EXCEPTION 'warehouse stock row not unique' USING ERRCODE='23514';
        END IF;
        -- Phase 403 trigger on warehouse_stock is the single products.stock writer.
        INSERT INTO public.stock_movements(product_id,type,qty,note,created_by)
        VALUES (v_item.product_id,'return',v_item.qty,
                'คืน RF-P646-'||v_req.id::text||' คลัง #'||v_req.warehouse_id::text,v_uid);
      END LOOP;
      UPDATE public.refunds SET restocked=true WHERE id=v_refund_id;
      UPDATE public.sales SET stock_reverted_at=pg_catalog.now()
        WHERE id=v_req.sale_id AND stock_reverted_at IS NULL;
      GET DIAGNOSTICS v_rows=ROW_COUNT;
      IF v_rows<>1 THEN
        RAISE EXCEPTION 'sale stock return marker changed' USING ERRCODE='23514';
      END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                   WHERE code='4110' AND is_active)
       OR NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                      WHERE code='2180' AND is_active)
       OR NOT EXISTS (SELECT 1 FROM public.account_mapping
                      WHERE mapping_key=CASE WHEN v_req.refund_method='exchange'
                                             THEN 'refund_exchange' ELSE 'refund_credit' END
                        AND is_active AND debit_account_code='4110'
                        AND credit_account_code='2180') THEN
      RAISE EXCEPTION 'refund accounts unavailable' USING ERRCODE='23514';
    END IF;
    INSERT INTO public.journal_entries
      (doc_no,doc_type,doc_date,description,status,total_debit,total_credit,
       source_table,source_id,created_by,approved_by,approved_at)
    VALUES ('JV-P646-'||v_req.id::text,'JV',
            (pg_catalog.now() AT TIME ZONE 'Asia/Bangkok')::date,
            'คืนเงินเป็นเครดิต RF-P646-'||v_req.id::text,
            'approved',v_amount,v_amount,'refunds',v_refund_id,
            v_uid,v_uid,pg_catalog.now())
    RETURNING id INTO v_entry_id;
    INSERT INTO public.journal_lines
      (entry_id,line_no,account_code,debit,credit,description)
    VALUES (v_entry_id,1,'4110',v_amount,0,'คืนยอดขายหลังส่วนลด'),
           (v_entry_id,2,'2180',0,v_amount,'เครดิตลูกค้าจากการคืน');
    SET CONSTRAINTS public.trg_je_lines_balance IMMEDIATE;

    -- Existing unique uq_loyalty_sale_reverse is a second idempotency gate.
    -- The source and balance were checked under the table lock above.
    v_reverse := v_earned;
    IF v_reverse>0 THEN
      INSERT INTO public.loyalty_points
        (customer_id,points,type,ref_type,ref_id,note)
      VALUES (v_req.customer_id,v_reverse,'redeem','sale_reverse',v_req.sale_id,
              'คืนแต้มจากการคืน RF-P646-'||v_req.id::text);
    END IF;

    INSERT INTO public.customer_credit_ledger
      (customer_id,source_type,source_id,source_key,amount,note,created_by)
    VALUES (v_req.customer_id,
            CASE WHEN v_req.refund_method='exchange' THEN 'refund_exchange'
                 ELSE 'refund_credit' END,
            v_refund_id,'phase646:'||v_req.request_key::text,v_amount,
            'เครดิตจาก RF-P646-'||v_req.id::text,v_uid);
    UPDATE public.credit_refund_requests
      SET status='completed',refund_id=v_refund_id,review_reason=NULL,
          finalized_by=v_uid,finalized_at=pg_catalog.now()
      WHERE id=v_req.id RETURNING * INTO v_req;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_code=RETURNED_SQLSTATE;
    -- All inner writes (including stock trigger and ledger) have rolled back.
    -- Keep only a coarse SQLSTATE for manual reconciliation; never auto-retry.
    UPDATE public.credit_refund_requests
      SET status='manual_review',review_reason='finalize_failed_'||v_error_code
      WHERE id=v_req.id RETURNING * INTO v_req;
  END;
  RETURN v_req;
END;
$finalize$;
REVOKE ALL ON FUNCTION public.phase646_finalize_credit_refund(bigint,numeric)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.phase646_finalize_credit_refund(bigint,numeric)
  TO authenticated;

-- Old clients cannot create credit/exchange refunds or convert cash/transfer
-- rows. Only the locked approved finalizer may insert one such source row.
-- This definer trigger sees completed requests regardless of who submitted
-- them, so a different staff user's RLS cannot hide a prior full-sale refund.
CREATE FUNCTION public.phase646_block_completed_sale_refund()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $completed_guard$
DECLARE v_blocked boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT EXISTS (SELECT 1 FROM public.credit_refund_requests q
                   WHERE q.status='completed' AND q.sale_id=NEW.sale_id)
      INTO v_blocked;
  ELSIF TG_OP='UPDATE' THEN
    SELECT EXISTS (SELECT 1 FROM public.credit_refund_requests q
                   WHERE q.status='completed' AND q.sale_id IN (OLD.sale_id,NEW.sale_id))
      INTO v_blocked;
  END IF;
  IF v_blocked THEN
    RAISE EXCEPTION 'completed credit refund blocks another refund for this sale'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$completed_guard$;
REVOKE ALL ON FUNCTION public.phase646_block_completed_sale_refund()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER phase646_block_completed_sale_refund
  BEFORE INSERT OR UPDATE ON public.refunds FOR EACH ROW
  EXECUTE FUNCTION public.phase646_block_completed_sale_refund();

CREATE FUNCTION public.phase646_block_unapproved_credit_refund()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $guard$
DECLARE
  v_credit_like boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    IF COALESCE(OLD.refund_method,'') ~* '(credit|เครดิต|exchange|เปลี่ยน)' THEN
      RAISE EXCEPTION 'credit refund cannot be deleted' USING ERRCODE='42501';
    END IF;
    RETURN OLD;
  END IF;
  v_credit_like := COALESCE(NEW.refund_method,'') ~* '(credit|เครดิต|exchange|เปลี่ยน)';
  -- Match the legacy accounting classifier, which trims/case-folds and also
  -- recognizes Thai credit/exchange labels. Noncanonical spellings cannot be
  -- allowed to bypass the approval path, even if the old UI never emits them.
  IF v_credit_like AND NEW.refund_method NOT IN ('credit','exchange') THEN
    RAISE EXCEPTION 'noncanonical credit refund method' USING ERRCODE='42501';
  END IF;
  IF NEW.refund_method IN ('credit','exchange') THEN
    IF TG_OP='INSERT' THEN
      IF current_user IS DISTINCT FROM 'postgres'
         OR pg_catalog.current_setting('phase646.finalizing_request_id',true) IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM public.credit_refund_requests q
           WHERE q.id::text=pg_catalog.current_setting('phase646.finalizing_request_id',true)
             AND q.status='approved' AND q.decided_by IS NOT NULL
             AND q.sale_id=NEW.sale_id AND q.customer_id=NEW.customer_id
             AND q.refund_method=NEW.refund_method
             AND q.quoted_amount=NEW.refund_amount
         ) THEN
        RAISE EXCEPTION 'credit refund requires Phase 646 admin approval'
          USING ERRCODE='42501';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.refund_method IS DISTINCT FROM NEW.refund_method THEN
      RAISE EXCEPTION 'cannot convert existing refund to credit' USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND COALESCE(OLD.refund_method,'') ~* '(credit|เครดิต|exchange|เปลี่ยน)' THEN
    IF current_user IS DISTINCT FROM 'postgres'
       OR pg_catalog.current_setting('phase646.finalizing_request_id',true) IS NULL
       OR OLD.restocked IS DISTINCT FROM false OR NEW.restocked IS DISTINCT FROM true
       OR (pg_catalog.to_jsonb(NEW)-'restocked') IS DISTINCT FROM
          (pg_catalog.to_jsonb(OLD)-'restocked') THEN
      RAISE EXCEPTION 'credit refund source is immutable' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.phase646_block_unapproved_credit_refund()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER phase646_block_unapproved_credit_refund
  BEFORE INSERT OR UPDATE OR DELETE ON public.refunds FOR EACH ROW
  EXECUTE FUNCTION public.phase646_block_unapproved_credit_refund();

-- Soft-delete currently voids sale JV and returns stock AFTER sales.note is
-- written in browser requests. A completed full credit refund cannot enter
-- that non-atomic legacy void path again. Other sales and cash/transfer
-- refunds retain their existing behavior.
CREATE FUNCTION public.phase646_protect_refunded_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $sale_guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.credit_refund_requests q
                 WHERE q.sale_id=OLD.id AND q.status='completed') THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'completed credit refund requires manual sale reconciliation'
      USING ERRCODE='42501';
  END IF;
  IF (pg_catalog.strpos(COALESCE(NEW.note,''),'[ลบแล้ว]')>0
      AND pg_catalog.strpos(COALESCE(OLD.note,''),'[ลบแล้ว]')=0)
     OR NEW.stock_reverted_at IS DISTINCT FROM OLD.stock_reverted_at
     OR NEW.order_no IS DISTINCT FROM OLD.order_no
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
     OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
     OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
     OR NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
     OR NEW.change_amount IS DISTINCT FROM OLD.change_amount
     OR NEW.credit_used_amount IS DISTINCT FROM OLD.credit_used_amount
     OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount
     OR NEW.vat_rate IS DISTINCT FROM OLD.vat_rate
     OR NEW.is_credit IS DISTINCT FROM OLD.is_credit THEN
    RAISE EXCEPTION 'completed credit refund cannot be voided or restocked again'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$sale_guard$;
REVOKE ALL ON FUNCTION public.phase646_protect_refunded_sale()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER phase646_protect_refunded_sale
  BEFORE UPDATE OR DELETE ON public.sales FOR EACH ROW
  EXECUTE FUNCTION public.phase646_protect_refunded_sale();

CREATE FUNCTION public.phase646_protect_refunded_sale_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $item_guard$
BEGIN
  IF TG_OP='INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.credit_refund_requests q
               WHERE q.status='completed' AND q.sale_id=NEW.sale_id) THEN
      RAISE EXCEPTION 'completed credit refund sale items are immutable'
        USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.credit_refund_requests q
               WHERE q.status='completed' AND q.sale_id=OLD.sale_id) THEN
      RAISE EXCEPTION 'completed credit refund sale items are immutable'
        USING ERRCODE='42501';
    END IF;
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_refund_requests q
             WHERE q.status='completed' AND q.sale_id IN (OLD.sale_id,NEW.sale_id)) THEN
    RAISE EXCEPTION 'completed credit refund sale items are immutable'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$item_guard$;
REVOKE ALL ON FUNCTION public.phase646_protect_refunded_sale_items()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER phase646_protect_refunded_sale_items
  BEFORE INSERT OR UPDATE OR DELETE ON public.sale_items FOR EACH ROW
  EXECUTE FUNCTION public.phase646_protect_refunded_sale_items();

-- POS awards sale points after saving the sale. An award still in flight when
-- the full credit refund commits must not create points for the refunded sale
-- afterward; the finalizer already serialized existing loyalty rows above.
-- The ledger is append-only from this migration onward: UPDATE/DELETE could
-- otherwise relabel a target sale's earn as an adjustment before finalization,
-- hiding points that must be reversed. All current app/Phase 540 writers use
-- INSERT; corrections require separately reviewed compensating entries.
CREATE FUNCTION public.phase646_protect_refunded_sale_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $point_guard$
DECLARE
  v_new_sale bigint;
BEGIN
  -- Preserve both deduction history and the sale-earn provenance used to
  -- determine the exact reversal. A staff role must not rewrite either side.
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'loyalty history is immutable'
      USING ERRCODE='42501';
  END IF;
  IF NEW.type='earn' AND NEW.ref_type='sale' THEN
    v_new_sale := NEW.ref_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_refund_requests q
             WHERE q.status='completed'
               AND q.sale_id=v_new_sale) THEN
    RAISE EXCEPTION 'completed credit refund sale points are immutable'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$point_guard$;
REVOKE ALL ON FUNCTION public.phase646_protect_refunded_sale_points()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER phase646_protect_refunded_sale_points
  BEFORE INSERT OR UPDATE OR DELETE ON public.loyalty_points FOR EACH ROW
  EXECUTE FUNCTION public.phase646_protect_refunded_sale_points();
-- TRUNCATE bypasses row triggers and RLS; no browser/service role may erase
-- the redemption history that gates automatic credit refund finalization.
REVOKE TRUNCATE ON TABLE public.loyalty_points
  FROM PUBLIC,anon,authenticated,service_role;

-- Table-level write privileges and the old FOR ALL policy allowed direct
-- authenticated inserts/deletes despite B1's two RPC guards. Retain SELECT
-- for accountant/staff; existing restrictive customer policy still applies.
REVOKE ALL ON TABLE public.customer_credit_ledger FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.customer_credit_ledger TO authenticated,service_role;
DROP POLICY ccl_staff_rw ON public.customer_credit_ledger;
CREATE POLICY ccl_staff_select ON public.customer_credit_ledger
  FOR SELECT TO authenticated USING (public.phase646_is_credit_staff());

DO $post$
BEGIN
  IF pg_catalog.has_table_privilege('anon','public.customer_credit_ledger','INSERT')
     OR pg_catalog.has_table_privilege('anon','public.loyalty_points','TRUNCATE')
     OR pg_catalog.has_table_privilege('authenticated','public.loyalty_points','TRUNCATE')
     OR pg_catalog.has_table_privilege('service_role','public.loyalty_points','TRUNCATE')
     OR pg_catalog.has_table_privilege('authenticated','public.customer_credit_ledger','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.customer_credit_ledger','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.customer_credit_ledger','DELETE')
     OR pg_catalog.has_table_privilege('service_role','public.customer_credit_ledger','INSERT')
     OR NOT pg_catalog.has_table_privilege('authenticated','public.customer_credit_ledger','SELECT')
     OR pg_catalog.has_table_privilege('anon','public.credit_refund_requests','SELECT')
     OR pg_catalog.has_table_privilege('authenticated','public.credit_refund_requests','INSERT')
     OR pg_catalog.has_function_privilege('anon',
          'public.phase646_finalize_credit_refund(bigint,numeric)','EXECUTE')
     OR pg_catalog.has_function_privilege('service_role',
          'public.phase646_finalize_credit_refund(bigint,numeric)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated',
          'public.phase646_finalize_credit_refund(bigint,numeric)','EXECUTE')
     OR pg_catalog.has_function_privilege('anon',
          'public.phase646_is_credit_staff()','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated',
          'public.phase646_is_credit_staff()','EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                    WHERE tgrelid='public.refunds'::pg_catalog.regclass
                      AND tgname='phase646_block_completed_sale_refund'
                      AND tgenabled='O')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                    WHERE tgrelid='public.refunds'::pg_catalog.regclass
                      AND tgname='phase646_block_unapproved_credit_refund'
                      AND tgenabled='O')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                    WHERE tgrelid='public.sales'::pg_catalog.regclass
                      AND tgname='phase646_protect_refunded_sale'
                      AND tgenabled='O')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                    WHERE tgrelid='public.sale_items'::pg_catalog.regclass
                      AND tgname='phase646_protect_refunded_sale_items'
                      AND tgenabled='O')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                    WHERE tgrelid='public.loyalty_points'::pg_catalog.regclass
                      AND tgname='phase646_protect_refunded_sale_points'
                      AND tgenabled='O') THEN
    RAISE EXCEPTION 'Phase 646 STOP: postcheck privileges failed';
  END IF;
END;
$post$;
NOTIFY pgrst, 'reload schema';
COMMIT;
