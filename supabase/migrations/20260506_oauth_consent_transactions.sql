-- ============================================================================
-- 20260506_oauth_consent_transactions.sql
-- ----------------------------------------------------------------------------
-- Codex audit finding #7 (HIGH): the OAuth flow had no server-side
-- transaction binding between /api/oauth/authorize and /api/oauth/finalize.
-- The consent page round-tripped every authorize parameter (client_id,
-- redirect_uri, code_challenge, scope, state) through hidden form fields,
-- and finalize trusted whatever came back. A CSRF gadget that tricked Wes
-- into POSTing a constructed form to /api/oauth/finalize could mint a
-- code for an attacker-chosen client_id+redirect_uri tuple.
--
-- Fix: server mints a transaction at /api/oauth/authorize, stores the
-- params keyed by `tx_id`, redirects to /oauth/consent?tx=<id>. The
-- consent page loads the row server-side. Finalize accepts ONLY the
-- tx_id (plus the session cookie) and atomically consumes the row,
-- minting the code from server-side params. Hidden form fields are no
-- longer load-bearing.
--
-- TTL: 5 minutes — long enough for a human to read the consent screen
-- and click Approve, short enough that abandoned flows clean up quickly.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.oauth_consent_transactions (
  tx_id                 text         primary key,
  client_id             text         not null,
  redirect_uri          text         not null,
  code_challenge        text         not null,
  code_challenge_method text         not null
                                      check (code_challenge_method = 'S256'),
  scope                 text         not null default 'mcp',
  subject               text         not null default 'wes',
  state                 text,
  created_at            timestamptz  not null default now(),
  expires_at            timestamptz  not null,
  used_at               timestamptz
);

CREATE INDEX IF NOT EXISTS oauth_consent_tx_expires_idx
  ON public.oauth_consent_transactions (expires_at);

ALTER TABLE public.oauth_consent_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all to anon" ON public.oauth_consent_transactions;
CREATE POLICY "deny all to anon" ON public.oauth_consent_transactions
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Atomic consume: returns the row exactly once and only if it's unused +
-- unexpired. Single-use prevents replay; expiry kills abandoned flows.
DROP FUNCTION IF EXISTS public.consume_consent_transaction(text);

CREATE OR REPLACE FUNCTION public.consume_consent_transaction(p_tx_id text)
RETURNS TABLE(
  client_id             text,
  redirect_uri          text,
  code_challenge        text,
  code_challenge_method text,
  scope                 text,
  subject               text,
  state                 text
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
    t.state;
END;
$fn$;
