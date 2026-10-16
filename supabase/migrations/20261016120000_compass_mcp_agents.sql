-- Credit Compass MCP agents and audit log.
-- Mirrors the Credit Guardian MCP (fairway-fixer-18, 20261006180000). Staff enroll
-- an agent in Settings → Agent access. The secret is shown once and stored only as
-- a hash. Every agent call writes an audit row before any read or write runs.
-- No policies for anon or authenticated: the edge functions use the service role,
-- so a browser session cannot read these tables.

CREATE TABLE IF NOT EXISTS public.mcp_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (name ~ '^[a-z][a-z0-9_-]{0,31}$'),
  secret_hash TEXT NOT NULL UNIQUE CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  scopes TEXT[] NOT NULL CHECK (
    cardinality(scopes) > 0
    AND scopes <@ ARRAY[
      'assessments.list',
      'assessments.read',
      'reports.read',
      'intake.list',
      'intake.read',
      'payments.read',
      'assessments.create',
      'reports.generate',
      'intake.create',
      'intake.score',
      'intake.approve_pricing',
      'intake.summary',
      'payments.record'
    ]::text[]
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  -- The staff member who enrolled the agent. Everything the agent creates is
  -- attributed to this user: dispute_sessions.user_id and
  -- intake_clients.intake_operator_id.
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcp_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.mcp_agents(id),
  tool TEXT NOT NULL,
  -- dispute_sessions.id or intake_clients.id the call was about, when known.
  subject_id UUID,
  success BOOLEAN NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_agent_created
  ON public.mcp_audit_log (agent_id, created_at DESC);

COMMENT ON TABLE public.mcp_agents IS
  'Credit Compass MCP connector identities. secret_hash is SHA-256 hex of the one-time secret. Never store the secret.';
COMMENT ON TABLE public.mcp_audit_log IS
  'One row per MCP call. Reads and writes are refused unless this insert succeeds first.';

ALTER TABLE public.mcp_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_agents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_audit_log FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mcp_agents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mcp_audit_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mcp_agents TO service_role;
GRANT ALL ON TABLE public.mcp_audit_log TO service_role;

-- Prove the end state.
DO $$
BEGIN
  IF to_regclass('public.mcp_agents') IS NULL OR to_regclass('public.mcp_audit_log') IS NULL THEN
    RAISE EXCEPTION 'mcp_agents / mcp_audit_log were not created';
  END IF;
END $$;
