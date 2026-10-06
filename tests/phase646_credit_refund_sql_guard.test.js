import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync("supabase-phase646-credit-refund-approval.sql", "utf8");

function between(start, end) {
  const a = sql.indexOf(start);
  const b = sql.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `cannot extract ${start}`);
  return sql.slice(a, b);
}

test("migration is explicitly local-only and is one transaction", () => {
  assert.match(sql, /^-- Phase 646 LOCAL CANDIDATE/m);
  assert.match(sql, /DO NOT APPLY to staging or production/);
  assert.match(sql, /^BEGIN;\s*SET LOCAL lock_timeout/m);
  assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*COMMIT;\s*$/);
  assert.match(sql, /object already exists; inspect, do not rerun/);
});

test("request table is read-only to browser and restricted by creator/admin", () => {
  const body = between("CREATE TABLE public.credit_refund_requests", "CREATE FUNCTION public.phase646_submit_credit_refund");
  assert.match(body, /request_key uuid NOT NULL UNIQUE/);
  assert.match(body, /created_by uuid NOT NULL/);
  assert.match(body, /ENABLE ROW LEVEL SECURITY/);
  assert.match(body, /REVOKE ALL ON TABLE public.credit_refund_requests FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(body, /GRANT SELECT ON TABLE public.credit_refund_requests TO authenticated/);
  assert.match(body, /created_by=auth\.uid\(\) OR public\.is_admin\(\)/);
  assert.doesNotMatch(body, /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\s+ON TABLE public\.credit_refund_requests TO authenticated/);
});

test("submission checks trusted DB role/profile before touching sale data", () => {
  const body = between("CREATE FUNCTION public.phase646_submit_credit_refund", "REVOKE ALL ON FUNCTION public.phase646_submit_credit_refund");
  const role = body.indexOf("pg_catalog.current_setting('role',true)");
  const profile = body.indexOf("FROM public.profiles");
  const sale = body.indexOf("FROM public.sales");
  assert.ok(role >= 0 && profile > role && sale > profile);
  assert.match(body, /v_role NOT IN \('admin','sales'\)/);
  assert.match(body, /JOIN public.sale_items si ON si.id=r.sale_item_id AND si.sale_id=p_sale_id/);
  assert.match(body, /pg_advisory_xact_lock/);
  assert.match(body, /request key reused with changed payload/);
  assert.doesNotMatch(body, /INSERT INTO public\.(?:refunds|customer_credit_ledger|journal_entries|journal_lines)/);
});

test("partial or previously refunded sale pauses in manual_review before approval", () => {
  const submit = between("CREATE FUNCTION public.phase646_submit_credit_refund", "REVOKE ALL ON FUNCTION public.phase646_submit_credit_refund");
  const decision = between("CREATE FUNCTION public.phase646_admin_decide_credit_refund", "REVOKE ALL ON FUNCTION public.phase646_admin_decide_credit_refund");
  assert.match(submit, /v_count<>v_sale_item_count/);
  assert.match(submit, /\(x->>'qty'\)::numeric IS DISTINCT FROM si\.qty/);
  assert.match(submit, /v_review_reason := 'partial_return'/);
  assert.match(submit, /EXISTS \(SELECT 1 FROM public\.refunds WHERE sale_id=p_sale_id\)/);
  assert.match(submit, /v_review_reason := 'prior_refund'/);
  assert.match(submit, /v_review_reason := 'sale_journal_missing'/);
  assert.match(submit, /phase646_stock_return_proven\(/);
  assert.match(submit, /v_quote := pg_catalog\.round\(v_sale\.total_amount,2\)/);
  assert.match(submit, /v_sale\.vat_amount IS NULL OR v_sale\.vat_rate IS NULL/);
  assert.match(submit, /round\(v_sale\.subtotal-v_sale\.discount_amount,2\)/);
  assert.match(submit, /CASE WHEN v_review_reason IS NULL THEN 'pending' ELSE 'manual_review' END/);
  assert.match(decision, /IF v_req\.status<>'pending' THEN/);
  assert.match(decision, /v_count<>v_sale_item_count/);
  assert.match(decision, /review_reason='partial_return'/);
  assert.match(decision, /review_reason='prior_refund'/);
  assert.match(decision, /review_reason='historical_vat'/);
  assert.match(decision, /review_reason='sale_net_ambiguous'/);
  assert.match(decision, /review_reason='sale_journal_missing'/);
  assert.match(decision, /review_reason='stock_return_ambiguous'/);
  assert.match(decision, /status='manual_review'[\s\S]*?RETURN v_req/);
  assert.doesNotMatch(submit, /INSERT INTO public\.(?:refunds|customer_credit_ledger|journal_entries|journal_lines)/);
});

test("admin decision is explicit, serialized, revalidates source, and has no money side effect", () => {
  const body = between("CREATE FUNCTION public.phase646_admin_decide_credit_refund", "REVOKE ALL ON FUNCTION public.phase646_admin_decide_credit_refund");
  const role = body.indexOf("pg_catalog.current_setting('role',true)");
  const profile = body.indexOf("FROM public.profiles");
  const request = body.indexOf("FROM public.credit_refund_requests");
  assert.ok(role >= 0 && profile > role && request > profile);
  assert.match(body, /v_role IS DISTINCT FROM 'admin'/);
  assert.match(body, /WHERE id=p_request_id FOR UPDATE/);
  assert.match(body, /FROM public.sales WHERE id=v_req.sale_id FOR UPDATE/);
  assert.match(body, /v_items IS DISTINCT FROM v_req.items_json/);
  assert.match(body, /requested quantity is no longer refundable/);
  assert.match(body, /decided_by=v_uid,decided_at=pg_catalog.now\(\)/);
  assert.doesNotMatch(body, /INSERT INTO public\.(?:refunds|customer_credit_ledger|journal_entries|journal_lines)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public.phase646_admin_decide_credit_refund\(bigint,boolean,numeric,text\)\s+FROM PUBLIC,anon,service_role/);
});

test("old clients cannot insert or convert a credit refund, and credited source cannot be changed", () => {
  const body = between("CREATE FUNCTION public.phase646_block_unapproved_credit_refund", "REVOKE ALL ON FUNCTION public.phase646_block_unapproved_credit_refund");
  assert.match(body, /IF TG_OP='DELETE'/);
  assert.match(body, /IF TG_OP='INSERT'/);
  assert.match(body, /current_user IS DISTINCT FROM 'postgres'/);
  assert.match(body, /phase646\.finalizing_request_id/);
  assert.match(body, /q\.status='approved'/);
  assert.match(body, /cannot convert existing refund to credit/);
  assert.match(body, /to_jsonb\(NEW\)-'restocked'\) IS DISTINCT FROM/);
  assert.match(body, /OLD.restocked IS DISTINCT FROM false OR NEW.restocked IS DISTINCT FROM true/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OR DELETE ON public.refunds/);
});

test("legacy credit aliases and post-completion cash refunds cannot bypass approval", () => {
  const direct = between("CREATE FUNCTION public.phase646_block_unapproved_credit_refund", "REVOKE ALL ON FUNCTION public.phase646_block_unapproved_credit_refund");
  const complete = between("CREATE FUNCTION public.phase646_block_completed_sale_refund", "REVOKE ALL ON FUNCTION public.phase646_block_completed_sale_refund");
  assert.match(direct, /COALESCE\(NEW\.refund_method,''\) ~\* '\(credit\|เครดิต\|exchange\|เปลี่ยน\)'/);
  assert.match(direct, /v_credit_like AND NEW\.refund_method NOT IN \('credit','exchange'\)/);
  assert.match(complete, /SECURITY DEFINER SET search_path=''/);
  assert.match(complete, /q\.status='completed' AND q\.sale_id=NEW\.sale_id/);
  assert.match(complete, /q\.status='completed' AND q\.sale_id IN \(OLD\.sale_id,NEW\.sale_id\)/);
  assert.match(sql, /CREATE TRIGGER phase646_block_completed_sale_refund\s+BEFORE INSERT OR UPDATE ON public\.refunds/);
});

test("ledger direct writes are closed; accountant SELECT and existing B1 RPCs remain", () => {
  assert.match(sql, /REVOKE ALL ON TABLE public.customer_credit_ledger FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(sql, /GRANT SELECT ON TABLE public.customer_credit_ledger TO authenticated,service_role/);
  assert.match(sql, /DROP POLICY ccl_staff_rw ON public.customer_credit_ledger/);
  assert.match(sql, /CREATE FUNCTION public.phase646_is_credit_staff\(\)[\s\S]*?SECURITY DEFINER SET search_path=''[\s\S]*?p.role IN \('admin','sales','technician','accountant'\)/);
  assert.match(sql, /CREATE POLICY ccl_staff_select ON public.customer_credit_ledger\s+FOR SELECT TO authenticated USING \(public.phase646_is_credit_staff\(\)\)/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.(?:redeem_customer_credit|release_customer_credit)/);
  const submit = between("CREATE FUNCTION public.phase646_submit_credit_refund", "REVOKE ALL ON FUNCTION public.phase646_submit_credit_refund");
  const decision = between("CREATE FUNCTION public.phase646_admin_decide_credit_refund", "REVOKE ALL ON FUNCTION public.phase646_admin_decide_credit_refund");
  assert.doesNotMatch(submit + decision, /INSERT INTO public.customer_credit_ledger/);
});

test("finalizer is admin-only, serialized, derives sale net, and never trusts client amount", () => {
  const body = between("CREATE FUNCTION public.phase646_finalize_credit_refund", "REVOKE ALL ON FUNCTION public.phase646_finalize_credit_refund");
  assert.match(body, /current_setting\('role',true\) IS DISTINCT FROM 'authenticated'/);
  assert.match(body, /v_role IS DISTINCT FROM 'admin'/);
  assert.match(body, /FROM public.credit_refund_requests\s+WHERE id=p_request_id FOR UPDATE/);
  assert.match(body, /FROM public.sales WHERE id=v_req.sale_id FOR UPDATE/);
  assert.match(body, /LOCK TABLE public.sale_items IN SHARE ROW EXCLUSIVE MODE/);
  assert.ok(body.indexOf("LOCK TABLE public.sale_items") < body.indexOf("WITH requested AS ("));
  assert.match(body, /v_req.status IN \('completed','manual_review'\)/);
  assert.match(body, /v_req.status<>'approved'/);
  assert.match(body, /v_sale.total_amount IS DISTINCT FROM v_req.quoted_amount/);
  assert.match(body, /e.source_table='sales' AND e.source_id=v_req.sale_id/);
  assert.match(body, /v_amount := v_sale.total_amount/);
  assert.match(body, /p_expected_net/);
  assert.doesNotMatch(body, /v_amount\s*:=\s*p_expected_net/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public.phase646_finalize_credit_refund\(bigint,numeric\)\s+FROM PUBLIC,anon,service_role/);
});

test("finalizer pauses stale, partial, prior, VAT, bundle and stock-ambiguous requests", () => {
  const body = between("CREATE FUNCTION public.phase646_finalize_credit_refund", "REVOKE ALL ON FUNCTION public.phase646_finalize_credit_refund");
  assert.match(body, /v_count<>v_sale_item_count/);
  assert.match(body, /v_items IS DISTINCT FROM v_req.items_json/);
  assert.match(body, /EXISTS \(SELECT 1 FROM public.refunds WHERE sale_id=v_req.sale_id\)/);
  assert.match(body, /v_sale\.vat_amount IS NULL OR v_sale\.vat_rate IS NULL/);
  assert.match(body, /round\(v_sale\.subtotal-v_sale\.discount_amount,2\)/);
  assert.match(body, /v_sale.stock_reverted_at IS NOT NULL/);
  assert.match(body, /COALESCE\(p.is_bundle,false\)/);
  assert.match(body, /FROM public.product_bundles b/);
  assert.match(body, /phase646_stock_return_proven\(/);
  assert.match(body, /review_reason='stock_return_ambiguous'/);
});

test("refund, stock log, exact balanced 4110/2180 JV, loyalty and credit are one rollback unit", () => {
  const body = between("CREATE FUNCTION public.phase646_finalize_credit_refund", "REVOKE ALL ON FUNCTION public.phase646_finalize_credit_refund");
  const atomic = between("  BEGIN\n    -- The trigger below", "  EXCEPTION WHEN OTHERS THEN");
  const effects = [
    "INSERT INTO public.refunds", "UPDATE public.warehouse_stock",
    "INSERT INTO public.stock_movements", "INSERT INTO public.journal_entries",
    "INSERT INTO public.journal_lines", "INSERT INTO public.loyalty_points",
    "INSERT INTO public.customer_credit_ledger", "SET status='completed'"
  ];
  let at = 0;
  for (const token of effects) {
    const found = atomic.indexOf(token, at);
    assert.ok(found >= at, `${token} must be inside atomic finalizer and in order`);
    at = found + token.length;
  }
  assert.match(atomic, /'4110',v_amount,0/);
  assert.match(atomic, /'2180',0,v_amount/);
  assert.match(atomic, /UPDATE public\.sales SET stock_reverted_at=pg_catalog\.now\(\)/);
  assert.match(atomic, /FROM public\.account_mapping/);
  assert.match(atomic, /debit_account_code='4110'/);
  assert.match(atomic, /credit_account_code='2180'/);
  assert.match(atomic, /SET CONSTRAINTS public\.trg_je_lines_balance IMMEDIATE/);
  assert.match(body, /pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\('loyalty:'\|\|v_req\.customer_id::text,0\)\)/);
  assert.match(body, /LOCK TABLE public.loyalty_points IN SHARE ROW EXCLUSIVE MODE/);
  assert.ok(body.indexOf("hashtextextended('loyalty:'") < body.indexOf("LOCK TABLE public.loyalty_points"));
  assert.ok(body.indexOf("LOCK TABLE public.loyalty_points") < body.indexOf("  BEGIN\n    -- The trigger below"));
  assert.match(body, /v_balance<v_earned[\s\S]*?review_reason='loyalty_spent_or_ambiguous'/);
  assert.match(body, /OR EXISTS \(\s*SELECT 1 FROM public\.loyalty_points spent\s+WHERE spent\.customer_id=v_req\.customer_id AND spent\.type='redeem'\s*\) THEN[\s\S]*?review_reason='loyalty_spent_or_ambiguous'/);
  assert.doesNotMatch(body, /v_first_earn_id|spent\.id|v_earned>0 AND EXISTS/);
  assert.match(atomic, /v_reverse := v_earned/);
  assert.match(body, /EXCEPTION WHEN OTHERS THEN[\s\S]*?status='manual_review'/);
  assert.match(body, /GET STACKED DIAGNOSTICS v_error_code=RETURNED_SQLSTATE/);
  assert.match(sql, /indexname='uq_loyalty_sale_reverse'/);
  assert.match(sql, /indexname='uq_ccl_source'/);
  assert.match(sql, /tgname='trg_sync_product_stock'/);
  const proof = between("CREATE FUNCTION public.phase646_stock_return_proven", "REVOKE ALL ON FUNCTION public.phase646_stock_return_proven");
  assert.match(proof, /si.warehouse_id IS DISTINCT FROM p_warehouse_id/);
  assert.match(proof, /m.type='sale'/);
  assert.match(proof, /s.qty IS DISTINCT FROM m.qty/);
});

test("completed credit refund blocks later legacy sale void/re-restock, other sales pass", () => {
  const guard = between("CREATE FUNCTION public.phase646_protect_refunded_sale", "REVOKE ALL ON FUNCTION public.phase646_protect_refunded_sale");
  assert.match(guard, /q.sale_id=OLD.id AND q.status='completed'/);
  assert.match(guard, /IF TG_OP='DELETE' THEN RETURN OLD; END IF;\s+RETURN NEW/);
  assert.match(guard, /IF TG_OP='DELETE' THEN\s+RAISE EXCEPTION/);
  assert.match(guard, /strpos\(COALESCE\(NEW.note,''\),'\[ลบแล้ว\]'\)/);
  assert.match(guard, /NEW.stock_reverted_at IS DISTINCT FROM OLD.stock_reverted_at/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public.sales FOR EACH ROW\s+EXECUTE FUNCTION public.phase646_protect_refunded_sale/);
});

test("completed credit refund makes source sale items immutable on every write path", () => {
  const guard = between("CREATE FUNCTION public.phase646_protect_refunded_sale_items", "REVOKE ALL ON FUNCTION public.phase646_protect_refunded_sale_items");
  assert.match(guard, /IF TG_OP='INSERT' THEN[\s\S]*?q.sale_id=NEW.sale_id[\s\S]*?RETURN NEW/);
  assert.match(guard, /ELSIF TG_OP='DELETE' THEN[\s\S]*?q.sale_id=OLD.sale_id[\s\S]*?RETURN OLD/);
  assert.match(guard, /q.sale_id IN \(OLD.sale_id,NEW.sale_id\)/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OR DELETE ON public.sale_items FOR EACH ROW\s+EXECUTE FUNCTION public.phase646_protect_refunded_sale_items/);
});

test("completed credit refund blocks late sale points and source-point mutation", () => {
  const guard = between("CREATE FUNCTION public.phase646_protect_refunded_sale_points", "REVOKE ALL ON FUNCTION public.phase646_protect_refunded_sale_points");
  assert.match(guard, /SECURITY DEFINER SET search_path=''/);
  assert.match(guard, /NEW\.type='earn' AND NEW\.ref_type='sale'/);
  assert.match(guard, /q\.status='completed'[\s\S]*?q\.sale_id=v_new_sale/);
  assert.match(sql, /CREATE TRIGGER phase646_protect_refunded_sale_points\s+BEFORE INSERT OR UPDATE OR DELETE ON public\.loyalty_points/);
  assert.match(sql, /tgname='phase646_protect_refunded_sale_points'[\s\S]*?tgenabled='O'/);
});

test("loyalty ledger is append-only, including sale earn provenance and redemptions", () => {
  const guard = between("CREATE FUNCTION public.phase646_protect_refunded_sale_points", "REVOKE ALL ON FUNCTION public.phase646_protect_refunded_sale_points");
  assert.match(guard, /IF TG_OP<>'INSERT' THEN[\s\S]*?ERRCODE='42501'/);
  assert.match(sql, /c\.oid='public\.loyalty_points'::pg_catalog\.regclass[\s\S]*?c\.relrowsecurity[\s\S]*?pg_catalog\.pg_get_userbyid\(c\.relowner\)='postgres'/);
  assert.match(sql, /REVOKE TRUNCATE ON TABLE public\.loyalty_points\s+FROM PUBLIC,anon,authenticated,service_role/);
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(sql, new RegExp(`has_table_privilege\\('${role}','public\\.loyalty_points','TRUNCATE'\\)`));
  }
});
