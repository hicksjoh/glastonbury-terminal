-- ============================================================
-- Glastonbury Terminal — Options Trading Schema Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- Options positions tracking
CREATE TABLE IF NOT EXISTS options_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'wes',
  underlying TEXT NOT NULL,
  option_symbol TEXT NOT NULL,
  contract_type TEXT NOT NULL CHECK (contract_type IN ('call', 'put')),
  strike DECIMAL(10,2) NOT NULL,
  expiration DATE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
  quantity INTEGER NOT NULL,
  avg_cost DECIMAL(10,4) NOT NULL,
  current_price DECIMAL(10,4),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed', 'exercised', 'assigned', 'expired')),
  strategy_id UUID,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  close_price DECIMAL(10,4),
  pnl DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Multi-leg strategies
CREATE TABLE IF NOT EXISTS options_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'wes',
  name TEXT NOT NULL,
  template TEXT,
  underlying TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed', 'expired')),
  max_profit DECIMAL(10,2),
  max_loss DECIMAL(10,2),
  break_even DECIMAL(10,2)[],
  net_premium DECIMAL(10,2),
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  total_pnl DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wheel cycles
CREATE TABLE IF NOT EXISTS wheel_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'wes',
  underlying TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('selling_puts', 'assigned', 'selling_calls', 'called_away', 'completed')),
  round_number INTEGER DEFAULT 1,
  cost_basis DECIMAL(10,2),
  total_premium DECIMAL(10,2) DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trade log
CREATE TABLE IF NOT EXISTS options_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID REFERENCES options_positions(id),
  strategy_id UUID REFERENCES options_strategies(id),
  wheel_cycle_id UUID REFERENCES wheel_cycles(id),
  action TEXT NOT NULL CHECK (action IN ('buy_to_open', 'sell_to_open', 'buy_to_close', 'sell_to_close', 'exercise', 'assignment', 'expiration')),
  option_symbol TEXT NOT NULL,
  underlying TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price DECIMAL(10,4) NOT NULL,
  fees DECIMAL(10,4) DEFAULT 0,
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  alpaca_order_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- IV tracking for watchlist
CREATE TABLE IF NOT EXISTS iv_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  iv_rank DECIMAL(5,2),
  iv_percentile DECIMAL(5,2),
  current_iv DECIMAL(5,2),
  hv_30 DECIMAL(5,2),
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key after both tables exist
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_options_positions_status ON options_positions(status);
CREATE INDEX IF NOT EXISTS idx_options_positions_underlying ON options_positions(underlying);
CREATE INDEX IF NOT EXISTS idx_options_positions_expiration ON options_positions(expiration);
CREATE INDEX IF NOT EXISTS idx_options_trades_executed ON options_trades(executed_at);
CREATE INDEX IF NOT EXISTS idx_iv_history_symbol ON iv_history(symbol, recorded_at);
CREATE INDEX IF NOT EXISTS idx_wheel_cycles_underlying ON wheel_cycles(underlying);
CREATE INDEX IF NOT EXISTS idx_wheel_cycles_phase ON wheel_cycles(phase);
