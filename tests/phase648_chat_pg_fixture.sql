-- Phase 648A — synthetic PostgreSQL fixture for the customer-chat migration.
-- Runs ONLY inside an isolated, owner-approved test database (scripts/phase648-chat-pg-local.mjs).
-- No production records or credentials. Mirrors the Supabase pieces the migration depends on:
--   roles anon / authenticated / service_role (BYPASSRLS), auth.uid() from the JWT sub claim,
--   public.profiles(id, role), public.is_customer_role(), and Supabase's DEFAULT PRIVILEGES
--   (new tables/functions in public are granted to anon/authenticated/service_role) so the
--   migration's REVOKEs are tested against the same starting grants as production.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT anon, authenticated, service_role TO CURRENT_USER;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text NOT NULL);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_self ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
GRANT SELECT ON public.profiles TO authenticated;

CREATE FUNCTION public.is_customer_role() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'customer')
$$;
GRANT EXECUTE ON FUNCTION public.is_customer_role() TO anon, authenticated, service_role;

-- Supabase default privileges (production starting point for objects the migration creates)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

INSERT INTO public.profiles VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'sales'),
  ('00000000-0000-0000-0000-0000000000a3', 'technician'),
  ('00000000-0000-0000-0000-0000000000a4', 'accountant'),
  ('00000000-0000-0000-0000-0000000000a5', 'customer');
