-- Staff role for Compass intake. Existing logins are staff. A new signup is a
-- customer and cannot open intake, fee quotes, or another person's analysis.

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('staff', 'customer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own role" ON public.user_roles;
CREATE POLICY "Users read own role"
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_roles TO authenticated;
GRANT SELECT, INSERT ON TABLE public.user_roles TO service_role;

DROP POLICY IF EXISTS "Service role reads roles" ON public.user_roles;
CREATE POLICY "Service role reads roles"
  ON public.user_roles
  FOR SELECT
  TO service_role
  USING (true);

CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
    AND _user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = _user_id
        AND role = 'staff'
    );
$$;

REVOKE ALL ON FUNCTION public.is_staff(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assign_customer_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_customer_role();

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'staff'
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id
)
ON CONFLICT (user_id, role) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.hub_operator_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_user_id UUID,
  tool TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.hub_operator_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hub_operator_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.hub_operator_audit TO service_role;

DROP POLICY IF EXISTS "Service role inserts audit" ON public.hub_operator_audit;
CREATE POLICY "Service role inserts audit"
  ON public.hub_operator_audit
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role reads audit" ON public.hub_operator_audit;
CREATE POLICY "Service role reads audit"
  ON public.hub_operator_audit
  FOR SELECT
  TO service_role
  USING (true);

COMMENT ON TABLE public.hub_operator_audit IS
  'Hub-key impersonation and hub writes. No row, no write.';

CREATE TABLE IF NOT EXISTS public.intake_clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  intake_operator_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'intake',
  record JSONB NOT NULL DEFAULT '{}'::jsonb,
  bureau_raw_extracts JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS intake_clients_operator_idx
  ON public.intake_clients (intake_operator_id, created_at DESC);

DROP TRIGGER IF EXISTS intake_clients_set_updated_at ON public.intake_clients;
CREATE TRIGGER intake_clients_set_updated_at
  BEFORE UPDATE ON public.intake_clients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_dispute_updated_at();

ALTER TABLE public.intake_clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Operators manage own intake clients" ON public.intake_clients;
DROP POLICY IF EXISTS "Staff manage own intake clients" ON public.intake_clients;
CREATE POLICY "Staff manage own intake clients"
  ON public.intake_clients
  FOR ALL
  TO authenticated
  USING (auth.uid() = intake_operator_id AND public.is_staff(auth.uid()))
  WITH CHECK (auth.uid() = intake_operator_id AND public.is_staff(auth.uid()));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'intake-artifacts',
  'intake-artifacts',
  false,
  52428800,
  ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Intake artifacts read own prefix" ON storage.objects;
DROP POLICY IF EXISTS "Intake artifacts write own prefix" ON storage.objects;
DROP POLICY IF EXISTS "Intake artifacts update own prefix" ON storage.objects;
DROP POLICY IF EXISTS "Intake artifacts delete own prefix" ON storage.objects;

CREATE POLICY "Intake artifacts read own prefix"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'intake-artifacts'
    AND public.is_staff(auth.uid())
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Intake artifacts write own prefix"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'intake-artifacts'
    AND public.is_staff(auth.uid())
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Intake artifacts update own prefix"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'intake-artifacts'
    AND public.is_staff(auth.uid())
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Intake artifacts delete own prefix"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'intake-artifacts'
    AND public.is_staff(auth.uid())
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
