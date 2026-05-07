-- ============================================================================
-- 20260506_cron_run_idempotency.sql
-- ----------------------------------------------------------------------------
-- Production-readiness audit (Codex finding #10): three cron routes that
-- fan out (push notifications, transactional email) had no idempotency. A
-- single Vercel cron retry — which DOES happen on transient failures —
-- would re-fire the morning push to every subscribed device, re-send the
-- Sunday email, and re-INSERT a duplicate briefing row.
--
-- This table holds one row per (job_name, run_key) tuple. The run_key is
-- chosen by the caller — typically `YYYY-MM-DD` in America/New_York for
-- daily jobs, or the prior-Sunday date for weekly jobs. The `try_claim`
-- RPC is the atomic gate: returns true exactly once per (job, key) tuple
-- within the stale window. After the stale window expires (default 10
-- minutes) a new attempt CAN reclaim, so a job that crashed mid-run
-- without marking complete will eventually be retried.
--
-- This is intentionally separate from `briefing_leases` (added 2026-04-20):
--   - briefing_leases: dedup CONCURRENT requests within a 90s window so
--     three users smashing /api/keisha/briefing?refresh=true don't run
--     three Opus calls.
--   - cron_runs: dedup DISTINCT runs of the same scheduled job within the
--     same logical period (today, this week) so a Vercel retry doesn't
--     re-fire side effects.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cron_runs (
  job_name      text NOT NULL,
  run_key       text NOT NULL,
  claimed_at    timestamptz NOT NULL DEFAULT NOW(),
  completed_at  timestamptz,
  result        jsonb,
  PRIMARY KEY (job_name, run_key)
);

CREATE INDEX IF NOT EXISTS cron_runs_claimed_at_idx
  ON public.cron_runs (claimed_at DESC);

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_full_access ON public.cron_runs;
CREATE POLICY service_role_full_access ON public.cron_runs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- try_claim_cron_run: returns true iff the caller acquired the run slot.
-- The atomic INSERT ... ON CONFLICT DO UPDATE WHERE makes this race-safe
-- across concurrent cron retries hitting different Vercel function instances.
DROP FUNCTION IF EXISTS public.try_claim_cron_run(text, text, int);

CREATE OR REPLACE FUNCTION public.try_claim_cron_run(
  p_job_name             text,
  p_run_key              text,
  p_stale_after_seconds  int DEFAULT 600
) RETURNS boolean
LANGUAGE plpgsql AS $fn$
DECLARE
  claimed boolean := false;
BEGIN
  WITH upsert AS (
    INSERT INTO public.cron_runs (job_name, run_key, claimed_at)
    VALUES (p_job_name, p_run_key, NOW())
    ON CONFLICT (job_name, run_key) DO UPDATE
      SET claimed_at = NOW(),
          completed_at = NULL,
          result = NULL
      WHERE cron_runs.completed_at IS NULL
        AND cron_runs.claimed_at < NOW() - make_interval(secs => p_stale_after_seconds)
    RETURNING 1
  )
  SELECT EXISTS(SELECT 1 FROM upsert) INTO claimed;
  RETURN claimed;
END;
$fn$;

-- mark_cron_run_complete: called on the success path so future invocations
-- with the same (job_name, run_key) skip immediately rather than waiting
-- for the stale window to elapse.
CREATE OR REPLACE FUNCTION public.mark_cron_run_complete(
  p_job_name text,
  p_run_key  text,
  p_result   jsonb DEFAULT NULL
) RETURNS void
LANGUAGE sql AS $fn$
  UPDATE public.cron_runs
  SET completed_at = NOW(), result = p_result
  WHERE job_name = p_job_name AND run_key = p_run_key;
$fn$;
