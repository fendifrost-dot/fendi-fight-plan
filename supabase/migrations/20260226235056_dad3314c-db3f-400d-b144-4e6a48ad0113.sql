
ALTER TABLE public.dispute_accounts
  ADD COLUMN IF NOT EXISTS triage_state text NOT NULL DEFAULT 'included',
  ADD COLUMN IF NOT EXISTS exclude_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'dispute_accounts_triage_state_check'
      AND t.relname = 'dispute_accounts'
  ) THEN
    ALTER TABLE public.dispute_accounts
      ADD CONSTRAINT dispute_accounts_triage_state_check
      CHECK (triage_state IN ('included', 'excluded', 'pending'));
  END IF;
END $$;

UPDATE public.dispute_accounts
  SET triage_state = 'included'
  WHERE triage_state IS NULL;
