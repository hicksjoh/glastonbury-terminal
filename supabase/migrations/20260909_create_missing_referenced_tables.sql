-- ----------------------------------------------------------------------------
-- Create the four declared-but-absent tables that application code references.
--
-- A sweep of every `CREATE TABLE IF NOT EXISTS` across supabase/migrations/
-- against live prod (2026-09-09) found 19 declared tables missing. Only these
-- four are referenced by any code. The other 15 are dead declarations and are
-- deliberately NOT created — creating them would add unused surface area.
--
-- Not created (declared, zero code references):
--   agent_logs, backtest_results, cashflow, earnings_tracking, events,
--   flow_alerts, iv_history, options_positions, options_strategies,
--   options_trades, screener_presets, sentiment_history, settings,
--   wealth_entries, wheel_cycles
--
-- DDL is copied verbatim from the migrations that already declare each table,
-- so a clean run of those files remains a no-op.
--
-- RLS: enabled with NO policies on all four. Every consumer uses
-- createServiceClient() (service_role bypasses RLS); anon/authenticated get
-- nothing. Matches the kv_cache / live_trading_acks pattern, and avoids
-- reintroducing the "RLS POLICY ALWAYS TRUE" warnings that
-- 20260416_security_hardening.sql exists to clean up.
--
-- APPLIED TO PROD 2026-09-09 (project vmpxcauwzsswxqhglgdv) via
-- supabase mcp apply_migration `create_four_missing_referenced_tables`.
-- Post-apply security advisors: zero ERROR-level.
-- ----------------------------------------------------------------------------

-- 1. briefings (001_create_tables.sql)
--    Consumers: /api/briefing/scheduled (cron write — was 500 "Failed to save
--    briefing"), /api/briefing/today (read — was silently {"briefing":null}),
--    and src/lib/mcp/server.ts `terminal_get_latest_briefing`.
CREATE TABLE IF NOT EXISTS public.briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  market_data_json jsonb,
  portfolio_data_json jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_briefings_created ON public.briefings (created_at DESC);
ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;

-- 2. live_trading_acks (20260803_live_trading_acks.sql)
--    Consumer: src/lib/live-ack.ts. An absent table fails CLOSED — mint and
--    verify both throw — so live trading was unusable, not unguarded. This
--    table must exist before TRADING_MODE=live is ever set.
CREATE TABLE IF NOT EXISTS public.live_trading_acks (
  token       TEXT PRIMARY KEY,
  user_hint   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_live_trading_acks_expires
  ON public.live_trading_acks (expires_at)
  WHERE revoked_at IS NULL;
ALTER TABLE public.live_trading_acks ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.live_trading_acks IS
  'Live-mode order-submission acknowledgments. Server verifies the token '
  'from the client on every /v2/orders POST when TRADING_MODE=live. '
  'See src/lib/live-ack.ts.';

-- 3. scanner_signals (001_create_tables.sql)
--    Consumer: /api/keisha/calibrate, whose query is wrapped in try/catch —
--    so the missing table degraded silently to sampleSize: 0 on every source.
--    Calibration could never learn anything from acted-on signals.
CREATE TABLE IF NOT EXISTS public.scanner_signals (
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
CREATE INDEX IF NOT EXISTS idx_scanner_signals_symbol ON public.scanner_signals (symbol);
CREATE INDEX IF NOT EXISTS idx_scanner_signals_created ON public.scanner_signals (created_at DESC);
ALTER TABLE public.scanner_signals ENABLE ROW LEVEL SECURITY;

-- 4. wealth_facts (006_wealth_facts.sql, including its seed)
--    Consumer: src/lib/wealth-facts.ts loadWealthFacts(), which returns an
--    empty block on error — so Keisha's system prompt silently carried no
--    wealth facts at all. Seed copied verbatim from 006.
CREATE TABLE IF NOT EXISTS public.wealth_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value_json jsonb NOT NULL,
  display_label text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wealth_facts_key ON public.wealth_facts (key);
CREATE INDEX IF NOT EXISTS idx_wealth_facts_updated ON public.wealth_facts (updated_at DESC);
ALTER TABLE public.wealth_facts ENABLE ROW LEVEL SECURITY;

INSERT INTO public.wealth_facts (key, value_json, display_label, source) VALUES
  ('master_target_2032',         '56670000'::jsonb,     'Master Target ($50M Empire by 2032 cumulative)', 'manual'),
  ('target_2026_foundation',     '580000'::jsonb,       'Foundation Year 2026 Target',                    'manual'),
  ('cr3_total_territories',      '23'::jsonb,           'CR3 Total Territories',                          'manual'),
  ('cr3_seacoast_territories',   '13'::jsonb,           'CR3 Seacoast FL Territories',                    'manual'),
  ('cr3_west_coast_territories', '10'::jsonb,           'CR3 West Coast FL Territories',                  'manual'),
  ('cr3_projected_revenue_2026', '1720000'::jsonb,      'CR3 Projected 2026 Revenue (all territories)',   'manual'),
  ('cr3_strategy_split',         '{"operate": 3, "sell": 17, "hybrid": 3}'::jsonb,
                                                        'CR3 Strategy Split (Operate / Sell / Hybrid)',   'manual'),
  ('cr3_top_performers',
   '[{"name":"Naples","multiplier":1.8},{"name":"Boca Raton","multiplier":1.5},{"name":"Sarasota","multiplier":1.4},{"name":"Jupiter","multiplier":1.4},{"name":"Fort Lauderdale","multiplier":1.3}]'::jsonb,
                                                        'CR3 Top Performer Territories (revenue multiplier)', 'manual'),
  ('anthropic_rsus_remaining',   '5749'::jsonb,         'Anthropic RSUs Remaining',                       'manual'),
  ('anthropic_rsu_grant_price',  '259.14'::jsonb,       'Anthropic RSU Grant Price',                      'manual'),
  ('miami_shores_property_value','580000'::jsonb,       'Miami Shores Property Value',                    'manual'),
  ('cr3_equity_value',           '720000'::jsonb,       'CR3 American Exteriors Equity (off-brokerage)',  'manual'),
  ('revenue_trajectory_table',
   '[
      {"year":2026,"annual":580000,"cumulative":580000,"phase":"Foundation Year"},
      {"year":2027,"annual":1900000,"cumulative":2500000,"phase":"Growth Sprint"},
      {"year":2028,"annual":4370000,"cumulative":6870000,"phase":"Scale Phase"},
      {"year":2029,"annual":7300000,"cumulative":14170000,"phase":"Expansion"},
      {"year":2030,"annual":10900000,"cumulative":25070000,"phase":"Acceleration"},
      {"year":2031,"annual":14300000,"cumulative":39370000,"phase":"Dominance"},
      {"year":2032,"annual":17300000,"cumulative":56670000,"phase":"Empire ($50M)"}
    ]'::jsonb,
                                                        '$50M Revenue Trajectory (year-by-year)',         'manual')
ON CONFLICT (key) DO NOTHING;
