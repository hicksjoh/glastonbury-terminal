-- Live-trading acknowledgment tokens
--
-- Backs the safety layer that requires Wes to type "CONFIRM LIVE"
-- before real-money orders can post. Rows are session-scoped, TTL'd
-- (default 4h), and revocable. See src/lib/live-ack.ts for the API.

CREATE TABLE IF NOT EXISTS live_trading_acks (
  token       TEXT PRIMARY KEY,           -- 64-hex random opaque token
  user_hint   TEXT NOT NULL,              -- audit label (e.g., "wes@localhost")
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ                 -- non-NULL means explicit revoke
);

-- Fast lookup by expiry when we prune expired rows in a background job
CREATE INDEX IF NOT EXISTS idx_live_trading_acks_expires
  ON live_trading_acks (expires_at)
  WHERE revoked_at IS NULL;

-- RLS: service role only. Nothing on the client should read these directly.
ALTER TABLE live_trading_acks ENABLE ROW LEVEL SECURITY;

-- No policies added — with RLS enabled and no policies, the service_role
-- key bypasses RLS (as designed) and anon/authenticated keys cannot see
-- the table at all. That matches the "server-verified only" semantics.

COMMENT ON TABLE live_trading_acks IS
  'Live-mode order-submission acknowledgments. Server verifies the token '
  'from the client on every /v2/orders POST when TRADING_MODE=live. '
  'See src/lib/live-ack.ts.';
