# Phase 646 production catalog — read-only observation (2026-10-06)

Source: the owner-opened Supabase Dashboard for project `rwmmjljelpcpwohwiplu`,
branch `main / PRODUCTION`. The successful `SELECT` queries in SQL Editor read only
`pg_class`, `pg_attribute`, `pg_constraint`, `pg_trigger`, `pg_policies` and
`pg_indexes`. No business rows, RPCs or migration statements were run. One
intermediate malformed `SELECT` returned syntax error 42601 and changed nothing.

Observed relevant schema:

| Table | Relevant columns / constraints |
| --- | --- |
| `sales` | `id`, `customer_id`, `total_amount numeric(12,2)`, `subtotal`, `discount_amount`, `paid_amount`, `change_amount`, `credit_used_amount`, `vat_amount`, `vat_rate`, `is_credit`, `stock_reverted_at`. RLS on. |
| `sale_items` | `id`, `sale_id`, `product_id`, `product_name`, `qty integer`, `unit_price`, `line_total`, `warehouse_id`. RLS on. |
| `refunds` | `id`, unique `refund_no`, `sale_id`, `customer_id`, `refund_method`, `refund_amount`, `items_json`, `restocked`, `warehouse_id`, `created_by text`. `trg_guard_refunds_insert` enabled. RLS on. |
| `warehouse_stock` | `(product_id,warehouse_id)` unique; `stock integer CHECK >=0`; `trg_sync_product_stock` enabled. RLS on. |
| `stock_movements` | `id`, `product_id`, `type`, `qty`, `note`, `created_by`; no source-id/unique refund key. RLS on. |
| `loyalty_points` | `id`, `customer_id`, `points`, `type`, `ref_type`, `ref_id`, `note`; focused `pg_indexes` query confirmed unique `uq_loyalty_sale_reverse` on `ref_id WHERE ref_type='sale_reverse'`. RLS on. |
| `journal_entries` | unique `doc_no`; unique partial `idx_je_source_unique(source_table,source_id)`; period-lock trigger `trg_check_period_locked`. RLS on. |
| `journal_lines` | numeric(14,2) debit/credit, balanced-line checks, deferred `trg_je_lines_balance`. RLS on. |
| `customer_credit_ledger` | unique partial `uq_ccl_source(source_type,source_id)` and `uq_ccl_source_key(source_type,source_key)`. RLS on. |
| `product_bundles` | `bundle_id`, `child_product_id`, `qty`; restoring a bundle parent without its children would be unsafe. |
| `products` | Focused catalog query confirmed `id bigint`, `stock integer`, `product_type text`, and `is_bundle boolean`; the migration's stock-type gate has these columns available. |
| `account_mapping` | `mapping_key`, `debit_account_code`, `credit_account_code`, `is_active`; unique `mapping_key`. |

The current browser stock helper updates warehouse stock and writes its movement
log in separate requests. The current browser accounting helper writes the
journal header and lines separately. Phase 646 cannot call those helpers in
sequence and claim atomicity. Full-sale credit finalization must validate the
server-derived **net** amount, check mapping/period and run all financial,
stock, loyalty and ledger writes in a single database transaction. Partial,
prior-refunded, historical-VAT, bundle and ambiguous legacy sales must not
enter the automatic path. This catalog observation does not authorize applying
SQL or show that any proposed migration works on production.
