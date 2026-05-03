-- ============================================================
-- Phase 47 - Fix profile role escalation
-- Date: 2026-05-03
--
-- Run this in Supabase SQL Editor if the database already has the
-- Phase 45 RLS policies applied. It keeps self profile edits working,
-- but blocks non-admin users from changing id or role.
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_profile_role_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.guard_profile_role_update() FROM PUBLIC;

DROP TRIGGER IF EXISTS guard_profile_role_update ON public.profiles;
CREATE TRIGGER guard_profile_role_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_role_update();

-- Optional smoke tests after running:
-- 1) As customer/sales/technician: update own full_name or phone should pass.
-- 2) As customer/sales/technician: update own role to admin should fail.
-- 3) As admin: update another user's role should pass.
