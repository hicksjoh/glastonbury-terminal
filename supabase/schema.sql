-- Portfolio Snapshots: daily wealth tracking
CREATE TABLE portfolio_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  total_equity NUMERIC(15,2) NOT NULL,
  cash NUMERIC(15,2) DEFAULT 0,
  pnl NUMERIC(15,2) DEFAULT 0,
  cr3_value NUMERIC(15,2) DEFAULT 0,
  rsu_value NUMERIC(15,2) DEFAULT 0,
  property_value NUMERIC(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Watchlist: stocks to watch
CREATE TABLE watchlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL UNIQUE,
  company_name VARCHAR(255),
  current_price NUMERIC(12,4),
  fair_value NUMERIC(12,4),
  moat VARCHAR(20) CHECK (moat IN ('wide', 'narrow', 'none')),
  stars INTEGER CHECK (stars BETWEEN 1 AND 5),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trades: paper and live trade history
CREATE TABLE trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  alpaca_order_id VARCHAR(255),
  symbol VARCHAR(10) NOT NULL,
  side VARCHAR(10) CHECK (side IN ('buy', 'sell')),
  qty NUMERIC(12,4),
  order_type VARCHAR(20) CHECK (order_type IN ('market', 'limit', 'stop', 'stop_limit')),
  limit_price NUMERIC(12,4),
  status VARCHAR(20) CHECK (status IN ('pending', 'filled', 'cancelled', 'rejected', 'expired')),
  filled_avg_price NUMERIC(12,4),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  filled_at TIMESTAMPTZ,
  is_paper BOOLEAN DEFAULT TRUE
);

-- Strategies: automated strategy configs
CREATE TABLE strategies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) CHECK (type IN ('covered_call_wheel', 'tax_loss_harvest', 'auto_rebalance', 'rsu_diversification')),
  status VARCHAR(20) CHECK (status IN ('active', 'paused', 'paper')) DEFAULT 'paper',
  params JSONB DEFAULT '{}',
  total_return NUMERIC(15,2) DEFAULT 0,
  total_return_pct NUMERIC(8,4) DEFAULT 0,
  trades_executed INTEGER DEFAULT 0,
  last_run TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Log: all agent actions
CREATE TABLE audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  agent VARCHAR(100) NOT NULL,
  action VARCHAR(255) NOT NULL,
  details TEXT,
  status VARCHAR(20) CHECK (status IN ('success', 'failed', 'pending')) DEFAULT 'pending',
  metadata JSONB DEFAULT '{}'
);

-- Roadmap Entries: $50M roadmap tracking
CREATE TABLE roadmap_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  year INTEGER NOT NULL UNIQUE,
  engine VARCHAR(255),
  projected NUMERIC(15,2) NOT NULL,
  actual NUMERIC(15,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed roadmap data
INSERT INTO roadmap_entries (year, engine, projected, actual) VALUES
(2026, 'Foundation', 580000, 580000),
(2027, 'CR3 Scale', 1200000, NULL),
(2028, 'Expansion', 2800000, NULL),
(2029, 'Franchise Growth', 6500000, NULL),
(2030, 'IPO Catalyst', 15000000, NULL),
(2031, 'Portfolio Compounding', 28000000, NULL),
(2032, '$50M Target', 50000000, NULL);

-- Alerts: custom alert rules engine
CREATE TABLE alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  conditions JSONB NOT NULL,
  logic TEXT DEFAULT 'AND',
  action TEXT DEFAULT 'notify',
  is_active BOOLEAN DEFAULT true,
  last_triggered TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Screener Presets: saved screen configurations
CREATE TABLE screener_presets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  filters JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Row Level Security (enable for production)
ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadmap_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE screener_presets ENABLE ROW LEVEL SECURITY;
