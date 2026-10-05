-- Synthetic local PostgreSQL fixture; runner creates a NEW owned cluster.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('request.jwt.claim.role',true),'')
$$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text);
INSERT INTO public.profiles SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,r
FROM (VALUES(1,'admin'),(2,'sales'),(3,'technician'),(4,'customer'),(5,'accountant'),(6,'unknown'),(7,NULL)) a(n,r);
CREATE TABLE public.customers(id bigint PRIMARY KEY);
INSERT INTO public.customers VALUES(101);
CREATE TABLE public.sales(checkout_key text PRIMARY KEY,credit_used_amount numeric,status text);
CREATE TABLE public.customer_credit_ledger(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 customer_id bigint NOT NULL REFERENCES public.customers(id),source_type text NOT NULL,
 source_id bigint,source_key text,amount numeric(14,2) NOT NULL,note text,
 created_at timestamptz NOT NULL DEFAULT now(),created_by uuid
);
CREATE UNIQUE INDEX uq_ccl_source_key ON public.customer_credit_ledger(source_type,source_key) WHERE source_key IS NOT NULL;
CREATE UNIQUE INDEX uq_ccl_source ON public.customer_credit_ledger(source_type,source_id) WHERE source_id IS NOT NULL;
INSERT INTO public.customer_credit_ledger(customer_id,source_type,amount) VALUES(101,'refund_credit',100);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE((SELECT role='admin' FROM public.profiles WHERE id=auth.uid()),false)
$$;
-- Applied Auth H semantics, not historical metadata-based helper.
CREATE FUNCTION public.is_customer_role() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND COALESCE((SELECT role FROM public.profiles WHERE id=auth.uid()),'customer')='customer'
$$;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profiles TO authenticated;
CREATE POLICY fixture_profile_read ON public.profiles FOR SELECT TO authenticated USING(true);
ALTER TABLE public.customer_credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY ccl_staff_rw ON public.customer_credit_ledger FOR ALL TO authenticated
 USING(true) WITH CHECK(public.is_admin() OR (amount>0 AND source_type IN('refund_credit','refund_exchange')));
CREATE POLICY ccl_deny_customer ON public.customer_credit_ledger AS RESTRICTIVE FOR ALL TO authenticated
 USING(NOT COALESCE(public.is_customer_role(),false)) WITH CHECK(NOT COALESCE(public.is_customer_role(),false));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.customer_credit_ledger TO authenticated;
GRANT USAGE ON SEQUENCE public.customer_credit_ledger_id_seq TO authenticated;
