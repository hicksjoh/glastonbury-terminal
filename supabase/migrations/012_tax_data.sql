-- ═══════════════════════════════════════════════════════════════════════════
--  012_tax_data.sql — Tax persistence layer
--  Tables: tax_profiles, wash_sale_events, tax_harvests, quarterly_estimates
-- ═══════════════════════════════════════════════════════════════════════════

-- Tax profile (user preferences)
CREATE TABLE IF NOT EXISTS tax_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  filing_status TEXT NOT NULL DEFAULT 'single' CHECK (filing_status IN ('single', 'mfj', 'mfs', 'hoh')),
  projected_ordinary_income DECIMAL(12,2) DEFAULT 0,
  ytd_tax_paid DECIMAL(12,2) DEFAULT 0,
  state TEXT, -- for future state tax support
  section_475_elected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Wash sale events (historical log)
CREATE TABLE IF NOT EXISTS wash_sale_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  sell_date DATE NOT NULL,
  sell_price DECIMAL(12,4),
  sell_quantity DECIMAL(12,4),
  realized_loss DECIMAL(12,2),
  conflicting_buy_date DATE,
  conflicting_buy_price DECIMAL(12,4),
  disallowed_loss DECIMAL(12,2),
  adjusted_basis DECIMAL(12,4),
  window_start DATE,
  window_end DATE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'overridden')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tax-loss harvesting log (what was harvested and when)
CREATE TABLE IF NOT EXISTS tax_harvests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  harvest_date DATE NOT NULL,
  quantity DECIMAL(12,4),
  loss_amount DECIMAL(12,2),
  tax_savings_estimate DECIMAL(12,2),
  replacement_ticker TEXT,
  replacement_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Quarterly tax estimates (tracking payments)
CREATE TABLE IF NOT EXISTS quarterly_estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  tax_year INT NOT NULL,
  quarter INT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  estimated_amount DECIMAL(12,2),
  actual_paid DECIMAL(12,2) DEFAULT 0,
  due_date DATE NOT NULL,
  paid_date DATE,
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'paid', 'overdue', 'skipped')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tax_year, quarter)
);

-- ═══════════════════════════════════════════════════════════════════════════
--  RLS Policies
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE tax_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE wash_sale_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_harvests ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarterly_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own tax profile" ON tax_profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own wash sales" ON wash_sale_events FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own harvests" ON tax_harvests FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own estimates" ON quarterly_estimates FOR ALL USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════
--  Indexes
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX idx_wash_sales_user_ticker ON wash_sale_events(user_id, ticker);
CREATE INDEX idx_wash_sales_window ON wash_sale_events(window_start, window_end);
CREATE INDEX idx_harvests_user_date ON tax_harvests(user_id, harvest_date);
CREATE INDEX idx_estimates_user_year ON quarterly_estimates(user_id, tax_year);
