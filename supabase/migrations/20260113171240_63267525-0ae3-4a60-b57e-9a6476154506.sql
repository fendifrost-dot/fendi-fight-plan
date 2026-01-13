-- Add persisted mode for System B generation (AI vs Manual)
ALTER TABLE public.dispute_sessions
ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'ai';

-- Optional: index for analytics/filtering (safe)
CREATE INDEX IF NOT EXISTS dispute_sessions_mode_idx ON public.dispute_sessions(mode);