-- Wave 4: Dynamic wealth facts
-- ----------------------------------------------------------------------------
-- Until now, Keisha's system prompt at src/lib/prompts/keisha-system.ts
-- carried hardcoded portfolio numbers (RSU counts, territory counts, the
-- $50M trajectory table, top-performer multipliers, Miami Shores property
-- value, etc.). Those numbers drift over time and updating them required
-- editing TypeScript and shipping a deploy.
--
-- This table stores those facts in Supabase so they can be updated by an
-- admin form / cron job / Alpaca-sync without touching code. Keisha's
-- buildFullPortfolioContext loads them via src/lib/wealth-facts.ts and
-- prepends them to the dynamic (uncached) part of the system message,
-- which means stale numbers can be refreshed without busting the prompt
-- cache for the static system prompt.
--
-- Seed values match what was hardcoded in keisha-system.ts as of 2026-04-28
-- so behavior does not regress on day one.

CREATE TABLE IF NOT EXISTS wealth_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value_json jsonb NOT NULL,
  display_label text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wealth_facts_key ON wealth_facts (key);
CREATE INDEX IF NOT EXISTS idx_wealth_facts_updated ON wealth_facts (updated_at DESC);

-- ----------------------------------------------------------------------------
-- Seed values (extracted from src/lib/prompts/keisha-system.ts, lines 9-42,
-- and from src/lib/keisha-context.ts:915 STATIC HOLDINGS block)
-- ----------------------------------------------------------------------------

INSERT INTO wealth_facts (key, value_json, display_label, source) VALUES
  ('master_target_2032',         '56670000'::jsonb,     'Master Target ($50M Empire by 2032 cumulative)', 'manual'),
  ('target_2026_foundation',     '580000'::jsonb,       'Foundation Year 2026 Target',                    'manual'),
  ('cr3_total_territories',      '23'::jsonb,           'CR3 Total Territories',                           'manual'),
  ('cr3_seacoast_territories',   '13'::jsonb,           'CR3 Seacoast FL Territories',                     'manual'),
  ('cr3_west_coast_territories', '10'::jsonb,           'CR3 West Coast FL Territories',                   'manual'),
  ('cr3_projected_revenue_2026', '1720000'::jsonb,      'CR3 Projected 2026 Revenue (all territories)',    'manual'),
  ('cr3_strategy_split',         '{"operate": 3, "sell": 17, "hybrid": 3}'::jsonb,
                                                        'CR3 Strategy Split (Operate / Sell / Hybrid)',    'manual'),
  ('cr3_top_performers',
   '[{"name":"Naples","multiplier":1.8},{"name":"Boca Raton","multiplier":1.5},{"name":"Sarasota","multiplier":1.4},{"name":"Jupiter","multiplier":1.4},{"name":"Fort Lauderdale","multiplier":1.3}]'::jsonb,
                                                        'CR3 Top Performer Territories (revenue multiplier)', 'manual'),
  ('anthropic_rsus_remaining',   '5749'::jsonb,         'Anthropic RSUs Remaining',                        'manual'),
  ('anthropic_rsu_grant_price',  '259.14'::jsonb,       'Anthropic RSU Grant Price',                       'manual'),
  ('miami_shores_property_value','580000'::jsonb,       'Miami Shores Property Value',                     'manual'),
  ('cr3_equity_value',           '720000'::jsonb,       'CR3 American Exteriors Equity (off-brokerage)',   'manual'),
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
                                                        '$50M Revenue Trajectory (year-by-year)',          'manual')
ON CONFLICT (key) DO NOTHING;
