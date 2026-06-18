-- ═══════════════════════════════════════════════════════════════════════════
--  Phase 495 — Lock profiles.role against privilege escalation  (audit 2026-06-18 #1, BLOCKING)
-- ═══════════════════════════════════════════════════════════════════════════
--
--  THREAT (verified):
--    The only RLS policy on public.profiles is
--      "auth_all_profiles"  FOR ALL TO authenticated USING(true) WITH CHECK(true)
--    and there is NO trigger guarding the `role` column. RLS WITH CHECK cannot do
--    column-level locking. So ANY authenticated user (even an OTP customer) can run
--      PATCH /rest/v1/profiles?id=eq.<their-own-uid>   body {"role":"admin"}
--    with the public anon key + their own JWT, and WITH CHECK(true) accepts it.
--    profiles_role_check already allows 'admin' → instant self-promotion → every
--    server helper that keys off profiles.role (is_accountant(), is_staff(), the
--    accounting RLS, etc.) now grants full money/accounting/permission access.
--
--  FIX:
--    A BEFORE INSERT OR UPDATE trigger (SECURITY DEFINER) that only an admin may
--    use to set/change `role`. Non-admin authenticated requests may keep their role
--    (UPDATE) and may only self-register as 'customer' (INSERT). The trusted server
--    paths are NOT affected:
--      • handle_new_user() (AFTER INSERT on auth.users, SECURITY DEFINER) inserts
--        role='sales' during sign-up — it runs with auth.uid() = NULL (no request
--        JWT), so the `auth.uid() IS NULL` bypass lets it through.
--      • service_role REST (server functions / migrations) also has auth.uid() = NULL.
--      • Admin role changes via changeRole() carry the admin's JWT → is_admin() = true.
--
--  This mirrors the column-lock pattern already used for reviewer/approver columns
--  (RLS WITH CHECK is not column-level — must use a BEFORE trigger).
--
--  ⚠️ Apply in Supabase SQL editor. Idempotent (safe to re-run). No app/build change.
-- ───────────────────────────────────────────────────────────────────────────

-- (1) helper: is the CURRENT auth user an admin?  (definer = bypass RLS, no recursion)
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

-- (2) trigger function: only admin may set/change role; non-admin self-signup = customer only
CREATE OR REPLACE FUNCTION public.guard_profiles_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Trusted contexts pass straight through:
  --   auth.uid() IS NULL  → service_role / migration / handle_new_user (no request JWT)
  --   is_admin()          → an admin acting via changeRole() / invite
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- From here on = an authenticated NON-admin client request.
  IF TG_OP = 'UPDATE' THEN
    -- may edit their own profile (name/phone) but NOT change role
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'FORBIDDEN_ROLE_CHANGE: เฉพาะแอดมินเปลี่ยน role ได้ (role=% → %)', OLD.role, NEW.role
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    -- self-registration may only create a 'customer' profile (privileged roles = admin only)
    IF NEW.role IS DISTINCT FROM 'customer' THEN
      RAISE EXCEPTION 'FORBIDDEN_ROLE_INSERT: ผู้ใช้ทั่วไปสร้างได้เฉพาะ role=customer (พบ %)', NEW.role
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- (3) wire the trigger
DROP TRIGGER IF EXISTS trg_guard_profiles_role ON public.profiles;
CREATE TRIGGER trg_guard_profiles_role
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profiles_role();

-- ───────────────────────────────────────────────────────────────────────────
--  VERIFY (run after applying)
-- ───────────────────────────────────────────────────────────────────────────
-- (a) trigger + function exist:
--     SELECT tgname FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND NOT tgisinternal;
--     -- expect: trg_guard_profiles_role
--
-- (b) EXPLOIT now blocked — as a NON-admin user (run from the app with a customer/sales JWT,
--     e.g. paste into the browser console while logged in as a non-admin):
--       fetch(SUPABASE_URL+'/rest/v1/profiles?id=eq.'+MY_UID,{method:'PATCH',
--         headers:{apikey:ANON,Authorization:'Bearer '+MY_JWT,'Content-Type':'application/json',Prefer:'return=representation'},
--         body:'{"role":"admin"}'}).then(r=>r.text()).then(console.log)
--     -- expect: 4xx with "FORBIDDEN_ROLE_CHANGE" (was: 200 + role flipped to admin)
--
-- (c) LEGIT admin role change still works:
--     logged in as admin, change a staff member's role via ตั้งค่า → ผู้ใช้งาน → expect success.
--
-- (d) SIGN-UP still works:
--     create a fresh user (OTP / invite) → profiles row is created (handle_new_user, role default)
--     → expect success (the auth.uid() IS NULL bypass).
--
--  ROLLBACK (if needed):
--     DROP TRIGGER IF EXISTS trg_guard_profiles_role ON public.profiles;
--     -- (is_admin() / guard_profiles_role() can be left in place; harmless)
