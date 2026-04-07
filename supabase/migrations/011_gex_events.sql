CREATE TABLE IF NOT EXISTS gex_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL DEFAULT 'SPY',
  event_type TEXT CHECK (event_type IN ('flip_positive', 'flip_negative', 'approaching_flip')),
  flip_level NUMERIC NOT NULL,
  spot_price NUMERIC NOT NULL,
  net_gex NUMERIC,
  vanna_exposure NUMERIC,
  charm_exposure NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gex_time ON gex_events(created_at DESC);
