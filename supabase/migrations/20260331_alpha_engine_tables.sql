-- Alpha Engine v2.0 — Scanner signals, earnings tracking, sentiment history, flow alerts
-- Run via Supabase SQL editor or migration tool

-- Scanner signal history
CREATE TABLE IF NOT EXISTS scanner_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  score numeric NOT NULL,
  sources jsonb DEFAULT '[]',
  kelly_shares integer,
  kelly_dollars numeric,
  thesis text,
  regime text,
  regime_fit boolean DEFAULT true,
  acted_on boolean DEFAULT false,
  outcome text,
  created_at timestamp DEFAULT now()
);

-- Earnings tracking
CREATE TABLE IF NOT EXISTS earnings_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  earnings_date date NOT NULL,
  eps_estimate numeric,
  eps_actual numeric,
  revenue_estimate numeric,
  revenue_actual numeric,
  surprise_pct numeric,
  stock_move_pct numeric,
  iv_before numeric,
  iv_after numeric,
  position_taken text,
  pnl numeric,
  created_at timestamp DEFAULT now()
);

-- Sentiment history
CREATE TABLE IF NOT EXISTS sentiment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  composite_score numeric,
  social_score numeric,
  news_score numeric,
  ai_score numeric,
  flags jsonb DEFAULT '[]',
  created_at timestamp DEFAULT now()
);

-- Flow alerts
CREATE TABLE IF NOT EXISTS flow_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  flow_type text NOT NULL,
  direction text NOT NULL,
  premium numeric,
  vol_oi_ratio numeric,
  strike numeric,
  expiration date,
  created_at timestamp DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_scanner_signals_symbol ON scanner_signals(symbol);
CREATE INDEX IF NOT EXISTS idx_scanner_signals_created ON scanner_signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_earnings_tracking_symbol ON earnings_tracking(symbol);
CREATE INDEX IF NOT EXISTS idx_earnings_tracking_date ON earnings_tracking(earnings_date);
CREATE INDEX IF NOT EXISTS idx_sentiment_history_symbol ON sentiment_history(symbol);
CREATE INDEX IF NOT EXISTS idx_sentiment_history_created ON sentiment_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_alerts_symbol ON flow_alerts(symbol);
CREATE INDEX IF NOT EXISTS idx_flow_alerts_created ON flow_alerts(created_at DESC);
