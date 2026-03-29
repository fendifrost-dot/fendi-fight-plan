ALTER TABLE pitch_log
  ALTER COLUMN cooldown_until DROP NOT NULL;
COMMENT ON COLUMN pitch_log.cooldown_until IS 'NULL when status=error (no cooldown); otherwise sent + 90d';
