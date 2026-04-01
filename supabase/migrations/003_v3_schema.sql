-- V3 Hedge Fund in a Box — New Tables
-- Phase 6: Supabase Schema Additions

-- Agent crew sessions
CREATE TABLE IF NOT EXISTS crew_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  proposed_action text NOT NULL,
  analyst_response jsonb,
  risk_response jsonb,
  executor_response jsonb,
  consensus text,
  final_verdict text,
  acted_on boolean DEFAULT false,
  outcome text,
  created_at timestamp DEFAULT now()
);

-- Monte Carlo results cache
CREATE TABLE IF NOT EXISTS monte_carlo_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_snapshot jsonb,
  var_95 numeric,
  var_99 numeric,
  cvar_95 numeric,
  cvar_99 numeric,
  expected_return numeric,
  probability_of_loss numeric,
  stress_tests jsonb,
  simulations integer DEFAULT 10000,
  horizon integer DEFAULT 21,
  created_at timestamp DEFAULT now()
);

-- Pairs trading tracking
CREATE TABLE IF NOT EXISTS pairs_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_a text NOT NULL,
  symbol_b text NOT NULL,
  hedge_ratio numeric,
  entry_z_score numeric,
  entry_date timestamp,
  exit_z_score numeric,
  exit_date timestamp,
  status text DEFAULT 'active',
  pnl numeric,
  created_at timestamp DEFAULT now()
);

-- Macro regime history
CREATE TABLE IF NOT EXISTS macro_regime_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regime text NOT NULL,
  confidence numeric,
  indicators jsonb,
  allocation jsonb,
  fed_prediction jsonb,
  created_at timestamp DEFAULT now()
);

-- Autopilot execution log
CREATE TABLE IF NOT EXISTS autopilot_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id text NOT NULL,
  symbol text NOT NULL,
  action text NOT NULL,
  shares integer,
  price numeric,
  score numeric,
  crew_verdict text,
  guard_verdict text,
  kelly_size jsonb,
  outcome text,
  pnl numeric,
  created_at timestamp DEFAULT now()
);

-- Earnings tone analysis cache
CREATE TABLE IF NOT EXISTS earnings_tone (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  quarter integer,
  year integer,
  overall_tone numeric,
  confidence numeric,
  guidance_tone numeric,
  defensiveness numeric,
  language_shift text,
  red_flags jsonb DEFAULT '[]',
  bullish_signals jsonb DEFAULT '[]',
  key_quotes jsonb DEFAULT '[]',
  trading_implication text,
  conviction numeric,
  summary text,
  created_at timestamp DEFAULT now()
);

-- Enable realtime on new tables
ALTER PUBLICATION supabase_realtime ADD TABLE crew_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE autopilot_executions;
