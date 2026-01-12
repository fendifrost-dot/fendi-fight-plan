-- Create dispute_sessions table for persistent storage
CREATE TABLE public.dispute_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Document storage (JSON arrays)
  documents JSONB DEFAULT '[]'::jsonb,
  bureau_response_text TEXT DEFAULT '',
  prior_letter_text TEXT DEFAULT '',
  
  -- Analysis state
  is_analyzed BOOLEAN DEFAULT false,
  analysis_result JSONB,
  
  -- Processing progress
  processing_progress JSONB DEFAULT '{"phase": "idle", "currentStep": "", "totalSteps": 0, "completedSteps": 0, "failedChunks": [], "message": ""}'::jsonb,
  
  -- Outcome confirmation
  outcome_confirmation JSONB DEFAULT '{"receivedResponse": null, "responseDate": "", "wasVerified": null, "wasPartiallyVerified": null, "wereSomeItemsDeleted": null, "noResponseReceived": null, "receivedFrivolousLetter": null}'::jsonb,
  
  -- Survey answers
  survey JSONB DEFAULT '{}'::jsonb,
  
  -- Consumer info
  consumer_info JSONB DEFAULT '{"fullName": "", "addressLine1": "", "addressLine2": "", "cityStateZip": ""}'::jsonb,
  
  -- Selected bureaus for letter generation
  selected_bureaus TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Generated letters per bureau
  generated_letters JSONB DEFAULT '{"experian": "", "equifax": "", "transunion": ""}'::jsonb,
  
  -- Imported data from System A
  imported_analyzer_data JSONB
);

-- Create dispute_accounts table for individual account tracking
CREATE TABLE public.dispute_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.dispute_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Account identification
  masked_account_number TEXT NOT NULL,
  creditor_name TEXT NOT NULL,
  date_opened TEXT,
  
  -- Per-bureau statuses (JSON object with experian/equifax/transunion keys)
  bureau_statuses JSONB DEFAULT '{}'::jsonb,
  
  -- User selection state
  is_selected BOOLEAN DEFAULT false,
  dispute_reason TEXT,
  custom_reason TEXT,
  
  -- Source tracking
  source_file TEXT,
  source_page INTEGER,
  confidence NUMERIC DEFAULT 0.8
);

-- Enable Row Level Security
ALTER TABLE public.dispute_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispute_accounts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for dispute_sessions
CREATE POLICY "Users can view their own sessions"
ON public.dispute_sessions
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own sessions"
ON public.dispute_sessions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions"
ON public.dispute_sessions
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sessions"
ON public.dispute_sessions
FOR DELETE
USING (auth.uid() = user_id);

-- RLS Policies for dispute_accounts
CREATE POLICY "Users can view their own accounts"
ON public.dispute_accounts
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own accounts"
ON public.dispute_accounts
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own accounts"
ON public.dispute_accounts
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own accounts"
ON public.dispute_accounts
FOR DELETE
USING (auth.uid() = user_id);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_dispute_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_dispute_sessions_updated_at
BEFORE UPDATE ON public.dispute_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_dispute_updated_at();

CREATE TRIGGER update_dispute_accounts_updated_at
BEFORE UPDATE ON public.dispute_accounts
FOR EACH ROW
EXECUTE FUNCTION public.update_dispute_updated_at();

-- Create indexes for better query performance
CREATE INDEX idx_dispute_sessions_user_id ON public.dispute_sessions(user_id);
CREATE INDEX idx_dispute_accounts_session_id ON public.dispute_accounts(session_id);
CREATE INDEX idx_dispute_accounts_user_id ON public.dispute_accounts(user_id);