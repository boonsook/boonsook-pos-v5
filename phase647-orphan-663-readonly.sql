-- Phase 647 incident triage for the owner-approved synthetic sale only.
-- Do not run a backfill or delete the header from this query's result alone.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '30s';

SELECT je.id, je.doc_no, je.status, je.source_table, je.source_id,
       je.total_debit, je.total_credit,
       count(jl.id) AS line_count,
       coalesce(sum(jl.debit), 0)::numeric(14,2) AS line_debit,
       coalesce(sum(jl.credit), 0)::numeric(14,2) AS line_credit,
       s.order_no, s.total_amount AS sale_total
FROM public.journal_entries je
LEFT JOIN public.journal_lines jl ON jl.entry_id = je.id
LEFT JOIN public.sales s ON je.source_table = 'sales' AND s.id = je.source_id
WHERE je.id = 663
GROUP BY je.id, s.order_no, s.total_amount;

ROLLBACK;
