-- ============================================================
-- Glastonbury Terminal — Comprehensive Schema Migration
-- All tables with CREATE TABLE IF NOT EXISTS for safe re-runs
-- Generated 2026-04-05
-- ============================================================

-- ============================================================
-- CORE: Portfolio & Wealth Tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date UNIQUE,
  total_equity numeric(15,2),
  equity decimal,
  cash decimal,
  net_worth decimal,
  pnl numeric(15,2) DEFAULT 0,
  cr3_value numeric(15,2) DEFAULT 0,
  rsu_value numeric(15,2) DEFAULT 0,
  property_value numeric(15,2) DEFAULT 0,
  positions_json jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wealth_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_class text NOT NULL,
  name text NOT NULL,
  current_value numeric NOT NULL,
  cost_basis numeric,
  last_updated timestamp DEFAULT now(),
  metadata jsonb DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS wealth_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  value decimal NOT NULL,
  date date DEFAULT current_date,
  notes text
);

-- ============================================================
-- CORE: Watchlist & Screener
-- ============================================================

CREATE TABLE IF NOT EXISTS watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol varchar(10) NOT NULL UNIQUE,
  company_name varchar(255),
  current_price numeric(12,4),
  fair_value numeric(12,4),
  moat varchar(20) CHECK (moat IN ('wide', 'narrow', 'none')),
  stars integer CHECK (stars BETWEEN 1 AND 5),
  notes text,
  added_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tickers jsonb DEFAULT '[]',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS screener_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}',
  filters_json jsonb,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- CORE: Alerts & Notifications
-- ============================================================

CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  symbol text,
  condition text,
  conditions jsonb,
  logic text DEFAULT 'AND',
  target_price decimal,
  action text DEFAULT 'notify',
  status text DEFAULT 'active',
  is_active boolean DEFAULT true,
  triggered_at timestamptz,
  last_triggered timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  title text NOT NULL,
  message text,
  priority text DEFAULT 'P2',
  read boolean DEFAULT false,
  link text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- CORE: Trade Journal & Trades
-- ============================================================

CREATE TABLE IF NOT EXISTS trade_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  symbol text,
  direction text NOT NULL,
  strategy text,
  entry_date date NOT NULL,
  entry_price numeric NOT NULL,
  exit_date date,
  exit_price numeric,
  quantity numeric NOT NULL,
  pnl numeric,
  pnl_percent numeric,
  entry_thesis text,
  exit_thesis text,
  keisha_agreed boolean,
  keisha_recommendation text,
  notes text,
  tags text[] DEFAULT '{}',
  emotion text,
  trade_date date,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alpaca_order_id varchar(255),
  symbol varchar(10) NOT NULL,
  side varchar(10) CHECK (side IN ('buy', 'sell')),
  qty numeric(12,4),
  order_type varchar(20) CHECK (order_type IN ('market', 'limit', 'stop', 'stop_limit')),
  limit_price numeric(12,4),
  status varchar(20) CHECK (status IN ('pending', 'filled', 'cancelled', 'rejected', 'expired')),
  filled_avg_price numeric(12,4),
  submitted_at timestamptz DEFAULT now(),
  filled_at timestamptz,
  is_paper boolean DEFAULT true
);

-- ============================================================
-- CORE: Strategies & Backtesting
-- ============================================================

CREATE TABLE IF NOT EXISTS strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  description text,
  type varchar(50),
  rules_json jsonb,
  status varchar(20) DEFAULT 'paper',
  params jsonb DEFAULT '{}',
  performance_json jsonb,
  total_return numeric(15,2) DEFAULT 0,
  total_return_pct numeric(8,4) DEFAULT 0,
  trades_executed integer DEFAULT 0,
  last_run timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backtest_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid REFERENCES strategies(id) ON DELETE CASCADE,
  symbols text[],
  date_range text,
  results_json jsonb,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- CORE: Agent System
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent text NOT NULL,
  action text NOT NULL,
  details text,
  result text,
  status text DEFAULT 'pending',
  blocked_by text,
  metadata jsonb DEFAULT '{}',
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text NOT NULL,
  action_type text NOT NULL,
  details text,
  status text DEFAULT 'success',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp timestamptz DEFAULT now(),
  agent varchar(100) NOT NULL,
  action varchar(255) NOT NULL,
  details text,
  status varchar(20) CHECK (status IN ('success', 'failed', 'pending')) DEFAULT 'pending',
  metadata jsonb DEFAULT '{}'
);

-- ============================================================
-- CORE: CR3 & Business
-- ============================================================

CREATE TABLE IF NOT EXISTS territories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  territory_id text UNIQUE NOT NULL,
  name text NOT NULL,
  region text NOT NULL,
  ar_agreement text NOT NULL,
  county text,
  status text DEFAULT 'developing',
  strategy text DEFAULT 'sell',
  fees_paid numeric DEFAULT 0,
  royalties_earned numeric DEFAULT 0,
  units_sold integer DEFAULT 0,
  home_value_index numeric,
  permit_count integer DEFAULT 0,
  projected_breakeven date,
  zip_codes jsonb DEFAULT '[]',
  zips text[],
  revenue_projection decimal,
  notes text,
  metadata jsonb DEFAULT '{}',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roadmap_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL UNIQUE,
  engine varchar(255),
  projected numeric(15,2) NOT NULL,
  actual numeric(15,2),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cashflow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  amount decimal NOT NULL,
  type text NOT NULL,
  date date NOT NULL,
  notes text,
  is_projected boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cashflow_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  category text NOT NULL,
  description text,
  amount numeric NOT NULL,
  date date NOT NULL,
  recurring boolean DEFAULT false,
  recurring_interval text,
  metadata jsonb DEFAULT '{}',
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  date date NOT NULL,
  time time,
  category text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- CORE: Settings
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text UNIQUE NOT NULL,
  setting_value jsonb NOT NULL,
  updated_at timestamp DEFAULT now()
);

-- ============================================================
-- KEISHA AI: Conversations, Recommendations, Calibration
-- ============================================================

CREATE TABLE IF NOT EXISTS keisha_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona text,
  domain text DEFAULT 'general',
  user_message text,
  keisha_response text,
  messages_json jsonb,
  messages jsonb DEFAULT '[]',
  symbols_mentioned text[],
  sentiment text,
  topics text[],
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS keisha_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  recommendation text NOT NULL,
  conviction integer,
  reasoning text,
  price_at_recommendation numeric,
  price_after_5d numeric,
  price_after_30d numeric,
  outcome text,
  return_pct numeric,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signal_calibration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL UNIQUE,
  default_weight numeric,
  actual_precision numeric,
  actual_avg_return numeric,
  recommended_weight numeric,
  sample_size integer,
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  market_data_json jsonb,
  portfolio_data_json jsonb,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- MARKET: Regime, Macro, Sentiment
-- ============================================================

CREATE TABLE IF NOT EXISTS market_regime (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regime text NOT NULL,
  confidence numeric,
  vix numeric,
  vix_ratio numeric,
  yield_spread numeric,
  momentum_factor numeric,
  detected_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS macro_regime_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regime text NOT NULL,
  confidence numeric,
  indicators jsonb,
  allocation jsonb,
  fed_prediction jsonb,
  created_at timestamp DEFAULT now()
);

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

-- ============================================================
-- ALPHA ENGINE: Scanner, Earnings, Flow
-- ============================================================

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

-- ============================================================
-- HEDGE FUND: Crew, Monte Carlo, Pairs, Autopilot
-- ============================================================

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

CREATE TABLE IF NOT EXISTS monte_carlo_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  parameters jsonb NOT NULL,
  results jsonb,
  created_at timestamp DEFAULT now()
);

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

-- ============================================================
-- OPTIONS TRADING
-- ============================================================

CREATE TABLE IF NOT EXISTS options_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'wes',
  underlying text NOT NULL,
  option_symbol text NOT NULL,
  contract_type text NOT NULL CHECK (contract_type IN ('call', 'put')),
  strike decimal(10,2) NOT NULL,
  expiration date NOT NULL,
  direction text NOT NULL CHECK (direction IN ('long', 'short')),
  quantity integer NOT NULL,
  avg_cost decimal(10,4) NOT NULL,
  current_price decimal(10,4),
  status text DEFAULT 'open' CHECK (status IN ('open', 'closed', 'exercised', 'assigned', 'expired')),
  strategy_id uuid,
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz,
  close_price decimal(10,4),
  pnl decimal(10,2),
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS options_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'wes',
  name text NOT NULL,
  template text,
  underlying text NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('active', 'closed', 'expired')),
  max_profit decimal(10,2),
  max_loss decimal(10,2),
  break_even decimal(10,2)[],
  net_premium decimal(10,2),
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz,
  total_pnl decimal(10,2),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wheel_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'wes',
  underlying text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('selling_puts', 'assigned', 'selling_calls', 'called_away', 'completed')),
  round_number integer DEFAULT 1,
  cost_basis decimal(10,2),
  total_premium decimal(10,2) DEFAULT 0,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS options_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id uuid REFERENCES options_positions(id),
  strategy_id uuid REFERENCES options_strategies(id),
  wheel_cycle_id uuid REFERENCES wheel_cycles(id),
  action text NOT NULL CHECK (action IN ('buy_to_open', 'sell_to_open', 'buy_to_close', 'sell_to_close', 'exercise', 'assignment', 'expiration')),
  option_symbol text NOT NULL,
  underlying text NOT NULL,
  quantity integer NOT NULL,
  price decimal(10,4) NOT NULL,
  fees decimal(10,4) DEFAULT 0,
  executed_at timestamptz DEFAULT now(),
  alpaca_order_id text,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iv_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  iv_rank decimal(5,2),
  iv_percentile decimal(5,2),
  current_iv decimal(5,2),
  hv_30 decimal(5,2),
  recorded_at timestamptz DEFAULT now()
);

-- ============================================================
-- TAX TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS tax_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  tax_character text,
  amount numeric NOT NULL,
  ticker text,
  description text,
  date date NOT NULL,
  wash_sale_flag boolean DEFAULT false,
  wash_sale_expires date,
  metadata jsonb DEFAULT '{}',
  created_at timestamp DEFAULT now()
);

-- ============================================================
-- INDEXES: Symbol lookups
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_watchlist_symbol ON watchlist(symbol);
CREATE INDEX IF NOT EXISTS idx_alerts_symbol ON alerts(symbol);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_trade_journal_ticker ON trade_journal(ticker);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_scanner_signals_symbol ON scanner_signals(symbol);
CREATE INDEX IF NOT EXISTS idx_earnings_tracking_symbol ON earnings_tracking(symbol);
CREATE INDEX IF NOT EXISTS idx_earnings_tone_symbol ON earnings_tone(symbol);
CREATE INDEX IF NOT EXISTS idx_sentiment_history_symbol ON sentiment_history(symbol);
CREATE INDEX IF NOT EXISTS idx_flow_alerts_symbol ON flow_alerts(symbol);
CREATE INDEX IF NOT EXISTS idx_pairs_trades_symbols ON pairs_trades(symbol_a, symbol_b);
CREATE INDEX IF NOT EXISTS idx_autopilot_symbol ON autopilot_executions(symbol);
CREATE INDEX IF NOT EXISTS idx_crew_sessions_symbol ON crew_sessions(symbol);
CREATE INDEX IF NOT EXISTS idx_keisha_recs_symbol ON keisha_recommendations(symbol);
CREATE INDEX IF NOT EXISTS idx_iv_history_symbol ON iv_history(symbol, recorded_at);

-- ============================================================
-- INDEXES: Time-series queries (created_at DESC)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_date ON portfolio_snapshots(date DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_created ON portfolio_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_agent_actions_created ON agent_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created ON agent_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trade_journal_entry ON trade_journal(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_trades_submitted ON trades(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scanner_signals_created ON scanner_signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_earnings_tracking_date ON earnings_tracking(earnings_date);
CREATE INDEX IF NOT EXISTS idx_sentiment_history_created ON sentiment_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_alerts_created ON flow_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_keisha_convos_created ON keisha_conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_keisha_recs_created ON keisha_recommendations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crew_sessions_created ON crew_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autopilot_created ON autopilot_executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_monte_carlo_created ON monte_carlo_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_macro_regime_created ON macro_regime_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_regime_detected ON market_regime(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefings_created ON briefings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashflow_date ON cashflow(date DESC);
CREATE INDEX IF NOT EXISTS idx_cashflow_items_date ON cashflow_items(date DESC);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date DESC);
CREATE INDEX IF NOT EXISTS idx_strategies_created ON strategies(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategies_status ON strategies(status);
CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy ON backtest_results(strategy_id);

-- ============================================================
-- INDEXES: Options trading
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_options_positions_status ON options_positions(status);
CREATE INDEX IF NOT EXISTS idx_options_positions_underlying ON options_positions(underlying);
CREATE INDEX IF NOT EXISTS idx_options_positions_expiration ON options_positions(expiration);
CREATE INDEX IF NOT EXISTS idx_options_trades_executed ON options_trades(executed_at);
CREATE INDEX IF NOT EXISTS idx_wheel_cycles_underlying ON wheel_cycles(underlying);
CREATE INDEX IF NOT EXISTS idx_wheel_cycles_phase ON wheel_cycles(phase);

-- ============================================================
-- INDEXES: GIN indexes for array/JSONB columns
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_keisha_convos_symbols ON keisha_conversations USING GIN (symbols_mentioned);
CREATE INDEX IF NOT EXISTS idx_trade_journal_tags ON trade_journal USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_territories_zips ON territories USING GIN (zip_codes);

-- ============================================================
-- INDEXES: Unique/special lookups
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_territories_territory_id ON territories(territory_id);
CREATE INDEX IF NOT EXISTS idx_territories_region ON territories(region);
CREATE INDEX IF NOT EXISTS idx_territories_status ON territories(status);
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
CREATE INDEX IF NOT EXISTS idx_user_settings_key ON user_settings(setting_key);
CREATE INDEX IF NOT EXISTS idx_cashflow_category ON cashflow(category);
CREATE INDEX IF NOT EXISTS idx_cashflow_type ON cashflow(type);
CREATE INDEX IF NOT EXISTS idx_wealth_entries_category ON wealth_entries(category);
CREATE INDEX IF NOT EXISTS idx_wealth_entries_date ON wealth_entries(date DESC);

-- ============================================================
-- FOREIGN KEY: options_positions -> options_strategies
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_strategy' AND table_name = 'options_positions'
  ) THEN
    ALTER TABLE options_positions ADD CONSTRAINT fk_strategy
      FOREIGN KEY (strategy_id) REFERENCES options_strategies(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- ROW LEVEL SECURITY (enable for all tables)
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'portfolio_snapshots', 'wealth_assets', 'wealth_entries', 'watchlist',
      'watchlists', 'screener_presets', 'alerts', 'notifications',
      'trade_journal', 'trades', 'strategies', 'backtest_results',
      'agent_actions', 'agent_logs', 'audit_log', 'territories',
      'roadmap_entries', 'cashflow', 'cashflow_items', 'events',
      'settings', 'user_settings', 'keisha_conversations',
      'keisha_recommendations', 'signal_calibration', 'briefings',
      'market_regime', 'macro_regime_history', 'sentiment_history',
      'scanner_signals', 'earnings_tracking', 'earnings_tone',
      'flow_alerts', 'crew_sessions', 'monte_carlo_results',
      'monte_carlo_scenarios', 'pairs_trades', 'autopilot_executions',
      'options_positions', 'options_strategies', 'wheel_cycles',
      'options_trades', 'iv_history', 'tax_events'
    ])
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS %I ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

-- ============================================================
-- REALTIME: Enable for key tables
-- ============================================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE agent_actions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE market_regime;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE crew_sessions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE autopilot_executions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- SEED: Roadmap data (skip if exists)
-- ============================================================

INSERT INTO roadmap_entries (year, engine, projected, actual) VALUES
  (2026, 'Foundation', 580000, 580000),
  (2027, 'CR3 Scale', 1200000, NULL),
  (2028, 'Expansion', 2800000, NULL),
  (2029, 'Franchise Growth', 6500000, NULL),
  (2030, 'IPO Catalyst', 15000000, NULL),
  (2031, 'Portfolio Compounding', 28000000, NULL),
  (2032, '$50M Target', 50000000, NULL)
ON CONFLICT (year) DO NOTHING;

-- ============================================================
-- SEED: CR3 Territories (skip if exists)
-- ============================================================

INSERT INTO territories (territory_id, name, region, ar_agreement, status, strategy) VALUES
  ('MIAMI_FL-01', 'Miami North', 'Miami', 'seacoast', 'active', 'operate'),
  ('MIAMI_FL-02', 'Miami Central', 'Miami', 'seacoast', 'active', 'operate'),
  ('MIAMI_FL-03', 'Miami South', 'Miami', 'seacoast', 'developing', 'sell'),
  ('MIAMI_FL-04', 'Miami West', 'Miami', 'seacoast', 'developing', 'hybrid'),
  ('MIAMI_FL-05', 'Miami Beach', 'Miami', 'seacoast', 'developing', 'sell'),
  ('FTLAUD_FL-01', 'Fort Lauderdale South', 'Fort Lauderdale', 'seacoast', 'active', 'operate'),
  ('FTLAUD_FL-02', 'Fort Lauderdale Central', 'Fort Lauderdale', 'seacoast', 'developing', 'sell'),
  ('FTLAUD_FL-03', 'Fort Lauderdale North', 'Fort Lauderdale', 'seacoast', 'developing', 'sell'),
  ('STLUCIE_FL-01', 'St. Lucie', 'St. Lucie', 'seacoast', 'developing', 'sell'),
  ('WESTPALM_FL-01', 'West Palm Beach South', 'West Palm Beach', 'seacoast', 'developing', 'sell'),
  ('WESTPALM_FL-02', 'West Palm Beach Central-North', 'West Palm Beach', 'seacoast', 'developing', 'hybrid'),
  ('WESTPALM_FL-03', 'West Palm Beach North', 'West Palm Beach', 'seacoast', 'developing', 'sell'),
  ('ORLANDO_FL-08', 'Orlando East', 'Orlando', 'seacoast', 'developing', 'sell'),
  ('WCFL-01', 'Naples', 'Naples', 'westcoast', 'developing', 'sell'),
  ('WCFL-02', 'Estero / Bonita Springs', 'Southwest FL', 'westcoast', 'developing', 'hybrid'),
  ('WCFL-03', 'Fort Myers', 'Fort Myers', 'westcoast', 'developing', 'sell'),
  ('WCFL-04', 'Cape Coral', 'Cape Coral', 'westcoast', 'developing', 'sell'),
  ('WCFL-05', 'Sarasota', 'Sarasota', 'westcoast', 'developing', 'sell'),
  ('WCFL-06', 'Bradenton', 'Bradenton', 'westcoast', 'developing', 'sell'),
  ('WCFL-07', 'St. Petersburg', 'St. Petersburg', 'westcoast', 'developing', 'sell'),
  ('WCFL-08', 'Tampa South', 'Tampa', 'westcoast', 'developing', 'sell'),
  ('WCFL-09', 'Tampa North', 'Tampa', 'westcoast', 'developing', 'sell'),
  ('WCFL-10', 'Clearwater', 'Clearwater', 'westcoast', 'developing', 'sell')
ON CONFLICT (territory_id) DO NOTHING;

-- ============================================================
-- SEED: Wealth assets (skip if exists)
-- ============================================================

INSERT INTO wealth_assets (asset_class, name, current_value, cost_basis, metadata) VALUES
  ('franchise', 'CR3 American Exteriors - Seacoast FL (13 territories)', 650000, 325000, '{"territories": 13, "agreement": "seacoast"}'),
  ('franchise', 'CR3 American Exteriors - West Coast FL (10 territories)', 500000, 100000, '{"territories": 10, "agreement": "westcoast"}'),
  ('real_estate', 'Miami Shores Property', 580000, 420000, '{"address": "Miami Shores, FL"}'),
  ('rsu', 'Anthropic RSUs (5,749 shares)', 1489000, 0, '{"shares": 5749, "grant_price": 259.14, "vesting": "quarterly"}'),
  ('cash', 'Operating Cash', 75000, 75000, '{}')
ON CONFLICT DO NOTHING;
