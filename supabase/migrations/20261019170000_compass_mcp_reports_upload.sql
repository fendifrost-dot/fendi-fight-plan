-- Let enrolled agents upload a bureau report (reports.upload).
-- Do not edit earlier mcp_agents migrations. Apply this file in the Lovable SQL editor.
-- Agents that already have analysis.start receive the new scope. Others keep their
-- current scopes until staff re-enroll them.

ALTER TABLE public.mcp_agents DROP CONSTRAINT IF EXISTS mcp_agents_scopes_check;

ALTER TABLE public.mcp_agents
  ADD CONSTRAINT mcp_agents_scopes_check CHECK (
    cardinality(scopes) > 0
    AND scopes <@ ARRAY[
      'assessments.list',
      'assessments.read',
      'reports.read',
      'intake.list',
      'intake.read',
      'payments.read',
      'analysis.read',
      'assessments.create',
      'reports.generate',
      'reports.upload',
      'intake.create',
      'intake.score',
      'intake.approve_pricing',
      'intake.summary',
      'payments.record',
      'payments.mark_late',
      'analysis.start',
      'analysis.chunk',
      'analysis.response',
      'documents.classify',
      'documents.map',
      'letters.dispute',
      'letters.specialty_freeze',
      'ai.ask'
    ]::text[]
  );

UPDATE public.mcp_agents
SET scopes = scopes || ARRAY['reports.upload']::text[]
WHERE revoked_at IS NULL
  AND NOT (scopes @> ARRAY['reports.upload']::text[])
  AND scopes @> ARRAY['analysis.start']::text[];

-- Text chunks and the source PDF share the private analysis-images bucket.
-- Leave an unrestricted mime list alone. Append only when a list is already set.
UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT ARRAY(
    SELECT DISTINCT mime
    FROM unnest(allowed_mime_types || ARRAY['application/pdf', 'text/plain']::text[]) AS mime
  )
)
WHERE id = 'analysis-images'
  AND allowed_mime_types IS NOT NULL
  AND NOT (allowed_mime_types @> ARRAY['application/pdf', 'text/plain']::text[]);

-- A non-null limit below 20 MB would reject a typical bureau PDF. Do not impose
-- a limit when the bucket is already unlimited, and do not lower a higher limit.
UPDATE storage.buckets
SET file_size_limit = 20971520
WHERE id = 'analysis-images'
  AND file_size_limit IS NOT NULL
  AND file_size_limit < 20971520;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mcp_agents_scopes_check'
      AND conrelid = 'public.mcp_agents'::regclass
  ) THEN
    RAISE EXCEPTION 'mcp_agents_scopes_check was not applied';
  END IF;
END $$;
