-- ═══════════════════════════════════════════════════════════════════════════
--  Phase 497 (#4a) — idempotent loyalty reverse: at most ONE sale_reverse per sale
-- ═══════════════════════════════════════════════════════════════════════════
--
--  BUG (audit รอบ2 #4, verified at code + DB):
--    reverseEarnedPointsForSale() (modules/loyalty.js) claws back a sale's earned points by
--    inserting a row: type='redeem', ref_type='sale_reverse', ref_id=<saleId>. Its only
--    idempotency guard is an in-memory cache scan (hasReversedLoyaltyForSale over
--    state.loyaltyPoints) and the loyalty_points table has NO unique index for it (live DB:
--    only loyalty_points_pkey). So voiding/refunding the SAME sale from two tabs/devices — or
--    double-clicking before loadAllData refreshes the cache — passes the cache check on both,
--    inserts TWO sale_reverse rows, and deducts the customer's points TWICE (can drive the
--    balance below the real earned amount; the cap is also computed from stale cache).
--
--  FIX: a partial UNIQUE index makes a second concurrent reverse fail with 23505; the app
--    (Phase 497) treats that as an idempotent skip (cache check stays as the fast path).
--    Mirrors the auto_post idx_je_source_unique / refund-guard pattern.
--
--  ⚠️ Apply in Supabase SQL editor. Run STEP 0 first — the index CREATE fails if duplicate
--     sale_reverse rows already exist (i.e. the double-void already happened).
-- ───────────────────────────────────────────────────────────────────────────

-- STEP 0 — pre-check: are there already duplicate sale_reverse rows? (must return 0 rows)
SELECT ref_id, count(*) AS n
FROM public.loyalty_points
WHERE ref_type = 'sale_reverse'
GROUP BY ref_id
HAVING count(*) > 1;

-- STEP 0b — ONLY IF step 0 returned rows: dedup (keep the earliest, delete the extras).
--   NOTE: this removes the *duplicate* claw-back rows (the over-deduction); the customer's
--   balance is corrected upward by the amount of the removed duplicates. Review before running.
--   DELETE FROM public.loyalty_points a
--   USING public.loyalty_points b
--   WHERE a.ref_type = 'sale_reverse' AND b.ref_type = 'sale_reverse'
--     AND a.ref_id = b.ref_id AND a.id > b.id;

-- STEP 1 — the guard: at most one sale_reverse per sale.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_sale_reverse
  ON public.loyalty_points (ref_id)
  WHERE ref_type = 'sale_reverse';

-- VERIFY:
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_loyalty_sale_reverse';
--   -- behaviour: a 2nd reverse of the same sale now returns 23505; the app skips it (no double deduct).
--
-- ROLLBACK (if ever needed):
--   DROP INDEX IF EXISTS public.uq_loyalty_sale_reverse;
