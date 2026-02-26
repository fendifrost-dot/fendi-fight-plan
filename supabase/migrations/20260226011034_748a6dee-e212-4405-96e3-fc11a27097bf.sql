
-- Idempotent: add stale_after_seconds column if not exists
ALTER TABLE public.analysis_jobs 
  ADD COLUMN IF NOT EXISTS stale_after_seconds integer NOT NULL DEFAULT 900;
