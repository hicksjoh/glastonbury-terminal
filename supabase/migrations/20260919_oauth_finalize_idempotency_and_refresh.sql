-- ============================================================================
-- 20260919_oauth_finalize_idempotency_and_refresh.sql
-- ----------------------------------------------------------------------------
-- Two production defects found during the 2026-09-19 connector QA sweep.
--
-- DEFECT 1 — duplicate consent POST is a dead end.
--   Production trace (2026-09-19 06:43 UTC, client gt_claude_app_*):
--     06:43:05  POST /api/oauth/finalize  303  code minted, redirect to Claude
--     06:43:07  POST /api/oauth/finalize  400  SAME tx, 1.4s later
--   consume_consent_transaction() is atomic and single-use, so the second
--   POST got NULL and the route answered with a bare-text 400 reading
--   "Consent transaction unknown or expired. Restart authorization." That
--   400 replaced the in-flight navigation to claude.ai, so the perfectly
--   valid authorization code minted 2 seconds earlier was never exchanged
--   (oauth_codes.used_at stayed NULL) and the user saw what looked like an
--   expired login. Single-use is correct; the dead end is not.
--
--   Fix: record the code each transaction minted. A duplicate POST of the
--   same tx, by the same authenticated subject, inside a short grace
--   window, re-issues the SAME redirect instead of erroring. No new grant
--   is created — the code stays single-use at /api/oauth/token.
--
-- DEFECT 2 — no refresh tokens.
--   Access tokens are 1h and /api/oauth/token only implemented
--   authorization_code. Every hour the connector's token went dead and the
--   only recovery was the full login + consent dance. src/lib/oauth/tokens.ts
--   claimed "Claude.app handles this transparently" — it does not; it
--   surfaces as "authentication expired".
--
--   Fix: a rotating refresh-token family with reuse detection (OAuth 2.1 /
--   RFC 6819 §5.2.2.3). Tokens are stored as SHA-256 hashes, never
--   plaintext. Presenting an already-rotated token revokes the whole
--   family — the standard stolen-token response.
--
-- Idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE public.oauth_consent_transactions DROP COLUMN IF EXISTS issued_code;
--   DROP TABLE IF EXISTS public.oauth_refresh_tokens;
-- ============================================================================

-- ─── Defect 1: remember which code a consent transaction minted ────────────
ALTER TABLE public.oauth_consent_transactions
  ADD COLUMN IF NOT EXISTS issued_code text;

-- Replay lookups are keyed by tx_id (already the PK), but we also read back
-- by issued_code when deciding whether the grant was already exchanged.
CREATE INDEX IF NOT EXISTS oauth_consent_tx_issued_code_idx
  ON public.oauth_consent_transactions (issued_code)
  WHERE issued_code IS NOT NULL;

-- ─── Defect 2: rotating refresh tokens ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.oauth_refresh_tokens (
  -- SHA-256 hex of the token. The plaintext is returned to the client once
  -- and never persisted, so a database read cannot mint access tokens.
  token_hash   text         primary key,
  -- All tokens descended from one authorization grant share a family_id.
  -- Reuse of a rotated token revokes the entire family.
  family_id    uuid         not null,
  client_id    text         not null,
  subject      text         not null default 'wes',
  scope        text         not null default 'mcp',
  -- RFC 8707 resource the access tokens minted from this family bind to.
  resource     text,
  created_at   timestamptz  not null default now(),
  expires_at   timestamptz  not null,
  -- Set when this token is rotated away. Non-null + presented again =
  -- reuse, which burns the family.
  used_at      timestamptz,
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_family_idx
  ON public.oauth_refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_client_idx
  ON public.oauth_refresh_tokens (client_id);
CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_expires_idx
  ON public.oauth_refresh_tokens (expires_at);

ALTER TABLE public.oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all to anon" ON public.oauth_refresh_tokens;
CREATE POLICY "deny all to anon" ON public.oauth_refresh_tokens
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Atomic rotation claim. Marks the presented token used and returns its
-- grant context — but ONLY if it was live (unused, unrevoked, unexpired).
-- Returning zero rows means "not claimable": unknown, expired, revoked, or
-- already rotated. The caller distinguishes those cases with a follow-up
-- read so it can trigger family revocation on genuine reuse.
CREATE OR REPLACE FUNCTION public.claim_refresh_token(p_token_hash text)
RETURNS TABLE(
  family_id uuid,
  client_id text,
  subject   text,
  scope     text,
  resource  text
)
LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN QUERY
  UPDATE public.oauth_refresh_tokens AS t
  SET used_at = NOW()
  WHERE t.token_hash = p_token_hash
    AND t.used_at IS NULL
    AND t.revoked_at IS NULL
    AND t.expires_at > NOW()
  RETURNING t.family_id, t.client_id, t.subject, t.scope, t.resource;
END;
$fn$;

-- Revoke every token in a family. Called on reuse detection and when an
-- operator revokes a client.
CREATE OR REPLACE FUNCTION public.revoke_refresh_family(p_family_id uuid)
RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  affected integer;
BEGIN
  UPDATE public.oauth_refresh_tokens
  SET revoked_at = NOW()
  WHERE family_id = p_family_id
    AND revoked_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$fn$;
