
ALTER TABLE public.analysis_jobs
ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (now() + interval '24 hours');

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_expires_at
ON public.analysis_jobs (expires_at);
