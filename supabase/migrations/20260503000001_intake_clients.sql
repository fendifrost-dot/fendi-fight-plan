-- Credit Compass: operator intake client records (canonical + bureau + pricing + payments)

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

CREATE POLICY "Operators manage own intake clients"
  ON public.intake_clients
  FOR ALL
  USING (auth.uid() = intake_operator_id)
  WITH CHECK (auth.uid() = intake_operator_id);

COMMENT ON TABLE public.intake_clients IS 'Credit Compass new-client intake: single JSON record per directive IntakeClientRecord';

-- Storage bucket for generated summaries and bureau uploads (paths: {operator_id}/{client_id}/...)
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
  USING (
    bucket_id = 'intake-artifacts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Intake artifacts write own prefix"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'intake-artifacts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Intake artifacts update own prefix"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'intake-artifacts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Intake artifacts delete own prefix"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'intake-artifacts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
