-- ============================================================================
-- 20260506_oauth_client_lifecycle.sql
-- ----------------------------------------------------------------------------
-- Codex audit finding (HIGH): registered OAuth clients had no revocation
-- path. Once a client_id was issued, its access tokens stayed valid for
-- their full TTL (1h) and the client could keep re-doing the auth dance
-- forever. There was no way to disable a stale or compromised client
-- short of dropping the row.
--
-- Two new columns + supporting index:
--   - revoked_at:    when set, verifyAccessToken returns null for any
--                    token bearing this client_id, even if the JWT signature
--                    is valid and unexpired. New auth flows are also
--                    refused at the token endpoint.
--   - last_used_at:  bumped by verifyAccessToken on each successful
--                    token validation. Lets the admin UI sort by recency
--                    and identify dormant clients to revoke.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

ALTER TABLE public.oauth_clients
  ADD COLUMN IF NOT EXISTS revoked_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_used_at  timestamptz;

-- Sort/filter index for the admin list view. Partial index keeps it small
-- (only indexes rows with a value, which most won't have for last_used_at
-- until they've been exercised).
CREATE INDEX IF NOT EXISTS oauth_clients_last_used_at_idx
  ON public.oauth_clients (last_used_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS oauth_clients_revoked_at_idx
  ON public.oauth_clients (revoked_at)
  WHERE revoked_at IS NOT NULL;
