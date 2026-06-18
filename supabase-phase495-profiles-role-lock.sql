-- ═══════════════════════════════════════════════════════════════════════════
--  Phase 495 — profiles.role protection: DOCUMENT the live guard + remove a redundant dup
-- ═══════════════════════════════════════════════════════════════════════════
--
--  CONTEXT / CORRECTION (audit 2026-06-18 #1):
--    The audit claimed profiles.role had NO escalation guard. That was WRONG — it was
--    verified against the committed repo SQL only, but the LIVE database already had an
--    out-of-band trigger (applied directly in the Supabase dashboard, never committed):
--
--        guard_profile_role_update   BEFORE UPDATE ON public.profiles
--          • forbids changing id
--          • forbids changing role unless public.is_admin()
--
--    So the real self-promote-to-admin exploit (PATCH /rest/v1/profiles role=admin) was
--    ALREADY blocked. Lesson: DB triggers are verified at the DB, not in the repo.
--
--    The first cut of this phase added a SECOND, redundant trigger (trg_guard_profiles_role
--    + guard_profiles_role()). It is unnecessary (the existing UPDATE guard already covers
--    the exploit) and was never exercised (Postgres fires BEFORE triggers alphabetically, so
--    guard_profile_role_update runs first and raises). This file removes that redundant dup
--    and COMMITS the real, live protection so the security control finally lives in version
--    control (and can be recreated if the DB is ever reset).
--
--  ⚠️ STATUS: the guard below is ALREADY LIVE in production. Only the DROP block at the end
--     needs to be run (to delete the redundant Phase-495-first-attempt trigger). The CREATE
--     OR REPLACE blocks are idempotent and included for tracking / disaster-recovery; they
--     are reconstructed from the live definitions (is_admin via pg_proc, guard via prosrc).
--     Before relying on them for a rebuild, confirm byte-for-byte with:
--       SELECT pg_get_functiondef('public.is_admin'::regproc);
--       SELECT pg_get_functiondef('public.guard_profile_role_update'::regproc);
-- ───────────────────────────────────────────────────────────────────────────

-- (1) is_admin() — current auth user is an admin (SECURITY DEFINER = bypass RLS, no recursion).
--     Used by guard_profile_role_update() AND reusable by future RLS policies.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- (2) the LIVE guard (reconstructed) — id immutable + role change is admin-only.
--     BEFORE UPDATE only: sign-up INSERT (handle_new_user) is unaffected, which is why it
--     has never needed an auth.uid() IS NULL bypass.
CREATE OR REPLACE FUNCTION public.guard_profile_role_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Profile id cannot be changed';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role AND NOT COALESCE(public.is_admin(), false) THEN
    RAISE EXCEPTION 'Only admins can change profile role';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_role_update ON public.profiles;
CREATE TRIGGER guard_profile_role_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_role_update();

-- ───────────────────────────────────────────────────────────────────────────
--  (3) ★ RUN THIS — remove the redundant trigger from this phase's first attempt.
--      (Keep public.is_admin() — guard_profile_role_update() above depends on it.)
-- ───────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_guard_profiles_role ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profiles_role();

-- ───────────────────────────────────────────────────────────────────────────
--  GAP STILL OPEN (the existing guard does NOT cover these — separate phase if wanted):
--    • INSERT side: a non-admin could in theory INSERT a profiles row with role<>'customer'
--      (mitigated in practice: handle_new_user already seeds every auth user's row, so a
--      self-INSERT conflicts, and is_admin() reads auth.uid()'s OWN row — an orphan-id admin
--      row does not escalate the attacker). Low risk; add an INSERT branch here to close fully.
--    • handle_new_user() defaults new users to role='sales' (not 'customer') — over-privileged
--      default; audit separately before deciding to change.
--
--  VERIFY (already passed once): as a NON-admin, PATCH /rest/v1/profiles role=admin →
--    "Only admins can change profile role" (P0001). Admin role change + sign-up still work.
