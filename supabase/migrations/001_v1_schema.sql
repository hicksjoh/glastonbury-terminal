-- Glastonbury Terminal v1.0 Schema Migration
-- Run via Supabase SQL Editor or CLI

-- Wealth tracking
CREATE TABLE IF NOT EXISTS wealth_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_class text NOT NULL,
  name text NOT NULL,
  current_value numeric NOT NULL,
  cost_basis numeric,
  last_updated timestamp DEFAULT now(),
  metadata jsonb DEFAULT '{}'
);

-- CR3 Territories
CREATE TABLE IF NOT EXISTS territories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  territory_id text UNIQUE NOT NULL,
  name text NOT NULL,
  region text NOT NULL,
  ar_agreement text NOT NULL,
  status text DEFAULT 'developing',
  strategy text DEFAULT 'sell',
  fees_paid numeric DEFAULT 0,
  royalties_earned numeric DEFAULT 0,
  units_sold integer DEFAULT 0,
  home_value_index numeric,
  permit_count integer DEFAULT 0,
  projected_breakeven date,
  zip_codes jsonb DEFAULT '[]',
  metadata jsonb DEFAULT '{}',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Cash Flow
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

-- Tax tracking
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

-- Trade Journal
CREATE TABLE IF NOT EXISTS trade_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
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
  created_at timestamp DEFAULT now()
);

-- Keisha conversations
CREATE TABLE IF NOT EXISTS keisha_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text DEFAULT 'general',
  messages jsonb DEFAULT '[]',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Market regime
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

-- Agent actions
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

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  priority text DEFAULT 'P2',
  title text NOT NULL,
  message text,
  read boolean DEFAULT false,
  link text,
  created_at timestamp DEFAULT now()
);

-- User settings
CREATE TABLE IF NOT EXISTS user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text UNIQUE NOT NULL,
  setting_value jsonb NOT NULL,
  updated_at timestamp DEFAULT now()
);

-- Watchlists
CREATE TABLE IF NOT EXISTS watchlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tickers jsonb DEFAULT '[]',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Monte Carlo scenarios
CREATE TABLE IF NOT EXISTS monte_carlo_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  parameters jsonb NOT NULL,
  results jsonb,
  created_at timestamp DEFAULT now()
);

-- Seed territories
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

-- Seed wealth assets
INSERT INTO wealth_assets (asset_class, name, current_value, cost_basis, metadata) VALUES
  ('franchise', 'CR3 American Exteriors — Seacoast FL (13 territories)', 650000, 325000, '{"territories": 13, "agreement": "seacoast"}'),
  ('franchise', 'CR3 American Exteriors — West Coast FL (10 territories)', 500000, 100000, '{"territories": 10, "agreement": "westcoast"}'),
  ('real_estate', 'Miami Shores Property', 580000, 420000, '{"address": "Miami Shores, FL"}'),
  ('rsu', 'Anthropic RSUs (5,749 shares)', 1489000, 0, '{"shares": 5749, "grant_price": 259.14, "vesting": "quarterly"}'),
  ('cash', 'Operating Cash', 75000, 75000, '{}')
ON CONFLICT DO NOTHING;

-- Enable realtime on key tables
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_actions;
ALTER PUBLICATION supabase_realtime ADD TABLE market_regime;
