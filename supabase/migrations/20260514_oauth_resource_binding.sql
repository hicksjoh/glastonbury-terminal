-- ============================================================================
-- 20260514_oauth_resource_binding.sql
-- ----------------------------------------------------------------------------
-- P0-2: bind OAuth access tokens to the resource URL (RFC 8707).
--
-- Pre-P0-2, the access-token JWT used a hard-coded `aud='terminal-mcp'`
-- placeholder and the authorize endpoint ignored the `resource=` query
-- param Claude.app already sends. This broke:
--   - RFC 8707 "Resource Indicators" compliance
--   - MCP spec 2025-06-18+ resource-binding requirement
--   - any client that expects `aud == resource_url`
--
-- The fix: persist `resource` from the authorize step through to the
-- minted access token, validate it equals `${issuer}/api/mcp`, and stamp
-- the token's `aud` with the resource URL.
--
-- This migration adds the column to both intermediary tables and
-- re-creates the consume_consent_transaction RPC with the new column in
-- its return signature.
--
-- Idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.consume_consent_transaction(text);
--   -- then re-apply 20260506_oauth_consent_transactions.sql to restore
--   -- the prior function signature.
--   ALTER TABLE public.oauth_consent_transactions DROP COLUMN IF EXISTS resource;
--   ALTER TABLE public.oauth_codes DROP COLUMN IF EXISTS resource;
-- ============================================================================

ALTER TABLE public.oauth_consent_transactions
  ADD COLUMN IF NOT EXISTS resource text;

ALTER TABLE public.oauth_codes
  ADD COLUMN IF NOT EXISTS resource text;

-- The previous RPC signature is locked at function-definition time, so a
-- CREATE OR REPLACE that adds a column to RETURNS TABLE() will error with
-- "cannot change return type of existing function". DROP first.
DROP FUNCTION IF EXISTS public.consume_consent_transaction(text);

CREATE OR REPLACE FUNCTION public.consume_consent_transaction(p_tx_id text)
RETURNS TABLE(
  client_id             text,
  redirect_uri          text,
  code_challenge        text,
  code_challenge_method text,
  scope                 text,
  subject               text,
  state                 text,
  resource              text
)
LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN QUERY
  UPDATE public.oauth_consent_transactions AS t
  SET used_at = NOW()
  WHERE t.tx_id = p_tx_id
    AND t.used_at IS NULL
    AND t.expires_at > NOW()
  RETURNING
    t.client_id,
    t.redirect_uri,
    t.code_challenge,
    t.code_challenge_method,
    t.scope,
    t.subject,
    t.state,
    t.resource;
END;
$fn$;
