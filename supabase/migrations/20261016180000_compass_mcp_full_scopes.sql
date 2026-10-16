-- Expand Credit Compass MCP scopes so enrolled agents can reach session-hub
-- tools (analysis, documents, letters, AI) and mark late payments.
-- Do not edit 20261016120000_compass_mcp_agents.sql; apply this file in the
-- Lovable SQL editor after it lands on main.

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
