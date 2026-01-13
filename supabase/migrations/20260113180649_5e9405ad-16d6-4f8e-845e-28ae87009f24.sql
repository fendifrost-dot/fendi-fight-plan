-- Create the updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create analysis_jobs table for async job processing
CREATE TABLE public.analysis_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  session_id UUID REFERENCES public.dispute_sessions(id) ON DELETE CASCADE,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'PARTIAL', 'DONE', 'FAILED')),
  step TEXT DEFAULT 'pending',
  progress NUMERIC DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  
  -- Retry logic
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_heartbeat_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  -- Error tracking
  error_code TEXT,
  error_message TEXT,
  
  -- Input data (stored for resume)
  input_data JSONB DEFAULT '{}'::jsonb,
  
  -- Checkpoints - partial results per step
  checkpoints JSONB DEFAULT '{}'::jsonb,
  
  -- Final result reference
  result_data JSONB,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own jobs"
  ON public.analysis_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own jobs"
  ON public.analysis_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own jobs"
  ON public.analysis_jobs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own jobs"
  ON public.analysis_jobs FOR DELETE
  USING (auth.uid() = user_id);

-- Index for efficient polling
CREATE INDEX idx_analysis_jobs_user_status ON public.analysis_jobs(user_id, status);
CREATE INDEX idx_analysis_jobs_session ON public.analysis_jobs(session_id);

-- Trigger for updated_at
CREATE TRIGGER update_analysis_jobs_updated_at
  BEFORE UPDATE ON public.analysis_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();