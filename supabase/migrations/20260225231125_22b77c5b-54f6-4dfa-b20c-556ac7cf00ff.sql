-- Add canonical job lifecycle columns to dispute_sessions
ALTER TABLE public.dispute_sessions
ADD COLUMN IF NOT EXISTS analysis_status text NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN IF NOT EXISTS active_job_id uuid NULL,
ADD COLUMN IF NOT EXISTS latest_analysis_job_id uuid NULL,
ADD COLUMN IF NOT EXISTS manual_claims_text text NOT NULL DEFAULT '';

-- Constrain status values for deterministic lifecycle state (idempotent)
DO $$
BEGIN
IF NOT EXISTS (
SELECT 1 FROM pg_constraint
WHERE conname = 'dispute_sessions_analysis_status_check'
AND conrelid = 'public.dispute_sessions'::regclass
) THEN
ALTER TABLE public.dispute_sessions
ADD CONSTRAINT dispute_sessions_analysis_status_check
CHECK (analysis_status IN ('NOT_STARTED', 'IN_PROGRESS', 'DONE', 'FAILED', 'SKIPPED', 'ABORTED', 'STALE'));
END IF;
END $$;

-- FK: active_job_id -> analysis_jobs(id) (guarded + idempotent)
DO $$
BEGIN
IF to_regclass('public.analysis_jobs') IS NOT NULL
AND NOT EXISTS (
SELECT 1 FROM pg_constraint
WHERE conname = 'dispute_sessions_active_job_id_fkey'
AND conrelid = 'public.dispute_sessions'::regclass
)
THEN
ALTER TABLE public.dispute_sessions
ADD CONSTRAINT dispute_sessions_active_job_id_fkey
FOREIGN KEY (active_job_id)
REFERENCES public.analysis_jobs(id)
ON DELETE SET NULL;
END IF;
END $$;

-- FK: latest_analysis_job_id -> analysis_jobs(id) (guarded + idempotent)
DO $$
BEGIN
IF to_regclass('public.analysis_jobs') IS NOT NULL
AND NOT EXISTS (
SELECT 1 FROM pg_constraint
WHERE conname = 'dispute_sessions_latest_analysis_job_id_fkey'
AND conrelid = 'public.dispute_sessions'::regclass
)
THEN
ALTER TABLE public.dispute_sessions
ADD CONSTRAINT dispute_sessions_latest_analysis_job_id_fkey
FOREIGN KEY (latest_analysis_job_id)
REFERENCES public.analysis_jobs(id)
ON DELETE SET NULL;
END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dispute_sessions_active_job_id
ON public.dispute_sessions(active_job_id);

CREATE INDEX IF NOT EXISTS idx_dispute_sessions_latest_analysis_job_id
ON public.dispute_sessions(latest_analysis_job_id);

-- Backfill ONLY where it is clearly derivable from legacy fields
UPDATE public.dispute_sessions
SET analysis_status = CASE
WHEN coalesce(is_analyzed, false) = true THEN 'DONE'
WHEN upper(coalesce(mode, 'AI')) = 'MANUAL' THEN 'SKIPPED'
ELSE analysis_status
END
WHERE analysis_status = 'NOT_STARTED'
AND (coalesce(is_analyzed, false) = true OR upper(coalesce(mode, 'AI')) = 'MANUAL');