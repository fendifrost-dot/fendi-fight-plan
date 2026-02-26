
ALTER TABLE public.analysis_jobs ADD COLUMN IF NOT EXISTS error_stage text NULL;
ALTER TABLE public.analysis_jobs ADD COLUMN IF NOT EXISTS error_meta jsonb NULL DEFAULT '{}'::jsonb;
