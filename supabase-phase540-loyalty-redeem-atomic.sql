-- ═══════════════════════════════════════════════════════════════════════════
--  Phase 540 (audit S5) — atomic loyalty redeem via SECURITY DEFINER RPC
-- ═══════════════════════════════════════════════════════════════════════════
--
--  BUG (BUG_AUDIT_2026-06-25 S5, verified at source modules/loyalty.js:295-337):
--    redeemPoints() did read-then-insert from the CLIENT: it computed "remaining" from
--    state.loyaltyPoints (an in-memory cache that is also capped at ≤500 rows) and then POSTed
--    a redeem row. Two devices/tabs redeeming for the same customer at once both pass the
--    in-memory check and both insert → the balance can go NEGATIVE (over-redeem).
--
--  FIX: move the redeem to a DB function that (1) takes a per-customer advisory xact lock so
--    concurrent redeems serialize, (2) reads the balance from loyalty_points in the DB (source
--    of truth), (3) rejects over-redeem with SQLSTATE 23514, (4) inserts the redeem row — all in
--    one transaction. Mirrors redeem_customer_credit.
--
--  ⚠️ SECURITY (why the role guard below is mandatory):
--    This function is SECURITY DEFINER → it bypasses Row-Level Security. EXECUTE is granted to
--    `authenticated`, and on this project OTP *customers* share that role pool. Phase 505 added a
--    RESTRICTIVE deny_customer_loyalty_points policy that blocks customers at the TABLE — but a
--    SECURITY DEFINER function bypasses table RLS, so without an explicit role check a logged-in
--    customer could call this RPC and burn arbitrary loyalty points (their own or anyone's).
--    The guard re-checks the *caller's* role (auth.uid() is the real caller even under DEFINER)
--    and refuses the `customer` role. This mirrors how redeem_customer_credit guards at the DB.
--
--  ⚠️ Apply manually in the Supabase SQL editor. Run STEP 0 first.

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 0 — inspect the CURRENT loyalty_points protection (run + read before STEP 1)
-- ═══════════════════════════════════════════════════════════════════════════
-- 0a) Is RLS enabled on the table?
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'loyalty_points';
--
-- 0b) Which roles can SELECT / INSERT today, and with what condition?
--   SELECT polname, polcmd, polroles::regrole[] AS roles,
--          pg_get_expr(polqual,      polrelid) AS using_expr,
--          pg_get_expr(polwithcheck, polrelid) AS check_expr
--   FROM pg_policy WHERE polrelid = 'public.loyalty_points'::regclass
--   ORDER BY polname;
--
-- 0c) Confirm the Phase 505 customer-deny exists (expect a RESTRICTIVE deny_customer_loyalty_points
--     with USING/CHECK = NOT is_customer_role()).
--
--   → The guard in STEP 1 must AT LEAST match phase505 (deny customer). If 0b shows the INSERT
--     policy is stricter than "any non-customer staff" (e.g. is_admin() only), tighten the guard
--     to that same condition so this RPC does NOT silently grant redeem to extra roles.

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1 — the function
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.redeem_loyalty_points_atomic(
  p_customer_id bigint,
  p_points      numeric,
  p_note        text DEFAULT NULL
)
RETURNS public.loyalty_points
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining numeric;
  v_row       public.loyalty_points;
BEGIN
  -- ★ AUTHZ — MUST be first (SECURITY DEFINER bypasses RLS). Loyalty redeem is staff-only;
  --   block OTP customers. auth.uid() inside a DEFINER function is still the CALLING user.
  IF COALESCE(public.is_customer_role(), false) THEN
    RAISE EXCEPTION 'forbidden: loyalty redeem is staff-only' USING ERRCODE = '42501';
  END IF;

  -- validate args
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id is required' USING ERRCODE = '23514';
  END IF;
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'points must be > 0' USING ERRCODE = '23514';
  END IF;

  -- serialize concurrent redeems for THIS customer (auto-released at txn end)
  PERFORM pg_advisory_xact_lock(hashtextextended('loyalty:' || p_customer_id::text, 0));

  -- balance from the DB — the source of truth, not the client's capped cache
  SELECT COALESCE(SUM(CASE WHEN type = 'earn'   THEN points ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN type = 'redeem' THEN points ELSE 0 END), 0)
    INTO v_remaining
  FROM public.loyalty_points
  WHERE customer_id = p_customer_id;

  IF v_remaining < p_points THEN
    RAISE EXCEPTION 'insufficient loyalty points: have %, need %', v_remaining, p_points
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.loyalty_points (customer_id, type, points, ref_type, ref_id, note, created_at)
  VALUES (p_customer_id, 'redeem', p_points, 'redemption', NULL, p_note, now())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2 — grant (customer role is refused INSIDE the function, not by withholding EXECUTE)
-- ═══════════════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION public.redeem_loyalty_points_atomic(bigint, numeric, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3 — reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY (smoke)
-- ═══════════════════════════════════════════════════════════════════════════
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'redeem_loyalty_points_atomic';
--     -- expect prosecdef = true
--   -- as a STAFF JWT: redeem <= balance → returns the inserted row (type='redeem');
--   --                 redeem  > balance → ERROR 23514 (insufficient)
--   -- as a CUSTOMER JWT: any call → ERROR 42501 (forbidden)
--   -- (use a test customer / rollback if testing with throwaway data)
