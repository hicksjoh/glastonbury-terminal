-- ============================================================================
-- 20260420_briefing_lease.sql
-- ----------------------------------------------------------------------------
-- Adversarial QA finding (HIGH): three concurrent ?refresh=true briefing
-- requests each ran an Opus generation independently and persisted three
-- separate rows. ~$0.30 wasted per accidental burst.
--
-- Fix: a `briefing_leases` table with one row per user, gated by an atomic
-- INSERT ... ON CONFLICT DO UPDATE upsert that only takes over an expired
-- lease. The first request gets the lease and runs Opus. Concurrent
-- requests get NULL back, poll the cache for up to 30s, and replay from
-- the cache once the leader writes it (cache freshness window is 5 min).
--
-- pg_advisory_lock would have been cleaner but Supabase pgbouncer's
-- session pooling means the lock isn't held across separate .rpc() calls
-- from the same client connection.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.briefing_leases (
  user_id     text PRIMARY KEY,
  leased_at   timestamptz NOT NULL DEFAULT NOW(),
  expires_at  timestamptz NOT NULL,
  lease_id    uuid NOT NULL DEFAULT gen_random_uuid()
);

ALTER TABLE public.briefing_leases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_full_access ON public.briefing_leases;
CREATE POLICY service_role_full_access ON public.briefing_leases
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Drop any prior scalar-uuid version (Supabase JS v2.43 deserializes scalar
-- UUID returns inconsistently — the JS client got status 200 + data:null
-- where direct PostgREST returned the value).
DROP FUNCTION IF EXISTS public.try_acquire_briefing_lease(text, int);

CREATE OR REPLACE FUNCTION public.try_acquire_briefing_lease(
  p_user_id text,
  p_ttl_seconds int DEFAULT 90
) RETURNS TABLE(lease_id uuid)
LANGUAGE plpgsql AS $fn$
DECLARE
  new_lease uuid := gen_random_uuid();
BEGIN
  RETURN QUERY
  INSERT INTO public.briefing_leases AS bl (user_id, leased_at, expires_at, lease_id)
  VALUES (p_user_id, NOW(), NOW() + make_interval(secs => p_ttl_seconds), new_lease)
  ON CONFLICT (user_id) DO UPDATE
    SET leased_at = NOW(),
        expires_at = NOW() + make_interval(secs => p_ttl_seconds),
        lease_id  = new_lease
    WHERE bl.expires_at < NOW()
  RETURNING bl.lease_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.release_briefing_lease(
  p_user_id text,
  p_lease_id uuid
) RETURNS boolean
LANGUAGE plpgsql AS $fn$
DECLARE
  affected int;
BEGIN
  UPDATE public.briefing_leases
  SET expires_at = NOW() - interval '1 second'
  WHERE user_id = p_user_id AND lease_id = p_lease_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$fn$;
