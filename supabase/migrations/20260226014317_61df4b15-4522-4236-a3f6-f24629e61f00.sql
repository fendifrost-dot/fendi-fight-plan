CREATE OR REPLACE FUNCTION public.mark_stale_analysis_jobs(
  grace_period_seconds integer DEFAULT 1200
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  stale_count integer;
BEGIN
  WITH zombies AS (
    SELECT id
    FROM public.analysis_jobs
    WHERE status IN ('QUEUED', 'RUNNING', 'IN_PROGRESS')
      AND created_at < now() - (grace_period_seconds || ' seconds')::interval
      AND (
        last_heartbeat_at IS NULL
        OR last_heartbeat_at < now() - (stale_after_seconds || ' seconds')::interval
      )
      AND (updated_at IS NULL OR updated_at < now() - interval '5 minutes')
    LIMIT 50
  ),
  updated_jobs AS (
    UPDATE public.analysis_jobs aj
    SET status = 'FAILED',
        error_code = 'JOB_STALE',
        error_stage = 'WORKER',
        error_message = 'No heartbeat; worker likely crashed or timed out',
        error_meta = jsonb_build_object(
          'last_heartbeat_at', aj.last_heartbeat_at,
          'created_at', aj.created_at,
          'step', aj.step,
          'progress', aj.progress,
          'cleaned_by', 'pg_cron'
        ),
        completed_at = now(),
        updated_at = now()
    FROM zombies z
    WHERE aj.id = z.id
    RETURNING aj.id
  ),
  cleared_sessions AS (
    UPDATE public.dispute_sessions ds
    SET active_job_id = NULL,
        updated_at = now()
    WHERE ds.active_job_id IN (SELECT id FROM updated_jobs)
    RETURNING ds.id
  )
  SELECT count(*) INTO stale_count FROM updated_jobs;

  RETURN stale_count;
END;
$$;