-- ============================================================================
-- 20260420_durable_rate_limit.sql
-- ----------------------------------------------------------------------------
-- Adversarial QA finding (MED): the in-memory rate limiter (lib/rate-limit.ts)
-- can't survive Vercel horizontal scaling. Each instance has its own counter
-- so effective rate = declared × N instances. For Anthropic-burning endpoints
-- (research, debate, crew, briefing-refresh) that's a real bill-bomb path.
--
-- This migration adds a Postgres-backed counter table + atomic upsert RPC.
-- The companion `lib/rate-limit-durable.ts` wraps it. Hot routes
-- (research/start, debate/run, crew/analyze, keisha/briefing) call the
-- durable limiter; cheap routes can stay on the in-memory limiter.
--
-- Bucket strategy: floor(epoch / window) gives a stable bucket id per
-- window. Counter implicitly resets when the bucket rolls over.
-- Opportunistic GC: ~1% of calls clean expired rows (no cron needed).
--
-- Idempotent. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  bucket_key  text NOT NULL,
  count       int  NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  PRIMARY KEY (bucket_key)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_expires
  ON public.rate_limit_counters (expires_at);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_full_access ON public.rate_limit_counters;
CREATE POLICY service_role_full_access ON public.rate_limit_counters
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_key      text,
  p_limit    int,
  p_window_s int
) RETURNS TABLE (allowed boolean, count int, reset_at timestamptz)
LANGUAGE plpgsql AS $fn$
DECLARE
  bucket    bigint;
  full_key  text;
  cur       int;
  exp       timestamptz;
BEGIN
  bucket := floor(extract(epoch from NOW()) / p_window_s)::bigint;
  full_key := p_key || ':' || bucket::text;
  exp := to_timestamp((bucket + 1) * p_window_s);

  INSERT INTO public.rate_limit_counters (bucket_key, count, expires_at)
  VALUES (full_key, 1, exp)
  ON CONFLICT (bucket_key) DO UPDATE
    SET count = public.rate_limit_counters.count + 1
  RETURNING public.rate_limit_counters.count INTO cur;

  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_counters WHERE expires_at < NOW();
  END IF;

  RETURN QUERY SELECT (cur <= p_limit), cur, exp;
END;
$fn$;
