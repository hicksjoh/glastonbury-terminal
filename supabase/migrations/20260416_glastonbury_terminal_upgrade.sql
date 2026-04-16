-- ============================================================================
-- 20260416_glastonbury_terminal_upgrade.sql
-- ----------------------------------------------------------------------------
-- Master migration for the 12-phase Glastonbury Terminal upgrade.
-- Creates tables, enums, indexes, helper functions, seed data, and RLS policies
-- for: Keisha briefings, Trading Crew v2, Earnings Co-Pilot, Deep Research,
-- Semantic Search (pgvector), CR3 Storm Watch, Tax Harvester, Behavioral Coach,
-- Prediction Markets, Bull/Bear Debate, and unified Agent Activity + Alerts.
--
-- Idempotent. Safe to re-run. No data is dropped.
-- ----------------------------------------------------------------------------

BEGIN;

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----------------------------------------------------------------------------
-- Helper: updated_at trigger function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- Enum types (idempotent via DO blocks)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE crew_judge_verdict AS ENUM ('BULL', 'BEAR', 'NEUTRAL', 'PASS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE crew_run_status AS ENUM ('pending', 'running', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE earnings_session_status AS ENUM ('scheduled', 'live', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE deep_research_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE doc_chunk_type AS ENUM ('filing', 'transcript', 'journal', 'news', 'research', 'debate');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE storm_threat_level AS ENUM ('watch', 'warning', 'direct_hit', 'clear');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tax_harvest_status AS ENUM ('suggested', 'queued', 'executed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE prediction_market_source AS ENUM ('kalshi', 'polymarket');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE debate_decision AS ENUM ('took_trade', 'passed', 'modified', 'deferred');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE alert_severity AS ENUM ('info', 'low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 1. KEISHA BRIEFINGS (Phase 1)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.keisha_briefings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL DEFAULT 'wes',
  briefing_text   text NOT NULL,
  context_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  model           text NOT NULL,
  token_input     integer,
  token_output    integer,
  cost_usd        numeric(10, 6),
  latency_ms      integer,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_keisha_briefings_user_created
  ON public.keisha_briefings (user_id, created_at DESC);

-- ============================================================================
-- 2. TRADING CREW RUNS (Phase 3)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.crew_runs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                text NOT NULL DEFAULT 'wes',
  ticker                 text NOT NULL,
  inputs_json            jsonb NOT NULL DEFAULT '{}'::jsonb,
  fundamentals_output    jsonb,
  technicals_output      jsonb,
  options_flow_output    jsonb,
  sentiment_output       jsonb,
  judge_verdict          crew_judge_verdict,
  judge_confidence       numeric(5, 2),
  judge_rationale        text,
  suggested_trade        jsonb,
  total_cost_usd         numeric(10, 6),
  total_latency_ms       integer,
  status                 crew_run_status NOT NULL DEFAULT 'pending',
  created_at             timestamptz NOT NULL DEFAULT NOW(),
  completed_at           timestamptz
);
CREATE INDEX IF NOT EXISTS idx_crew_runs_user_created
  ON public.crew_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crew_runs_ticker
  ON public.crew_runs (ticker, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crew_runs_status
  ON public.crew_runs (status);

-- ============================================================================
-- 3. EARNINGS SESSIONS + TRANSCRIPT CHUNKS + MEMOS (Phase 4)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.earnings_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL DEFAULT 'wes',
  ticker       text NOT NULL,
  call_date    date NOT NULL,
  quarter      text,
  source_url   text,
  status       earnings_session_status NOT NULL DEFAULT 'scheduled',
  started_at   timestamptz,
  ended_at     timestamptz,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_earnings_sessions_user_ticker
  ON public.earnings_sessions (user_id, ticker, call_date DESC);
CREATE INDEX IF NOT EXISTS idx_earnings_sessions_status
  ON public.earnings_sessions (status);

CREATE TABLE IF NOT EXISTS public.earnings_transcript_chunks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.earnings_sessions(id) ON DELETE CASCADE,
  seq               integer NOT NULL,
  speaker           text,
  chunk_text        text NOT NULL,
  timestamp_ms      bigint,
  sentiment_score   numeric(5, 4),
  sentiment_tags    text[],
  created_at        timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_etc_session_seq
  ON public.earnings_transcript_chunks (session_id, seq);

CREATE TABLE IF NOT EXISTS public.earnings_memos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.earnings_sessions(id) ON DELETE CASCADE,
  memo_text         text NOT NULL,
  keisha_take       text,
  guidance_delta    text,
  key_quotes        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_earnings_memos_session
  ON public.earnings_memos (session_id);

-- ============================================================================
-- 4. DEEP RESEARCH MEMOS (Phase 5)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.deep_research_memos (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     text NOT NULL DEFAULT 'wes',
  ticker                      text,
  topic                       text NOT NULL,
  prompt                      text NOT NULL,
  memo_markdown               text,
  memo_word_count             integer,
  sources_cited               jsonb NOT NULL DEFAULT '[]'::jsonb,
  managed_agent_session_id    text,
  total_cost_usd              numeric(10, 6),
  total_runtime_seconds       integer,
  status                      deep_research_status NOT NULL DEFAULT 'pending',
  created_at                  timestamptz NOT NULL DEFAULT NOW(),
  completed_at                timestamptz
);
CREATE INDEX IF NOT EXISTS idx_drm_user_created
  ON public.deep_research_memos (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drm_ticker
  ON public.deep_research_memos (ticker);
CREATE INDEX IF NOT EXISTS idx_drm_status
  ON public.deep_research_memos (status);

-- ============================================================================
-- 5. DOC CHUNKS + SEMANTIC SEARCH (Phase 6)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.doc_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type      doc_chunk_type NOT NULL,
  ticker        text,
  source_url    text,
  source_id     text,
  chunk_text    text NOT NULL,
  chunk_index   integer NOT NULL,
  embedding     vector(1024),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_type_ticker
  ON public.doc_chunks (doc_type, ticker);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_source
  ON public.doc_chunks (source_id);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_embedding
  ON public.doc_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE OR REPLACE FUNCTION public.match_doc_chunks(
  query_embedding vector(1024),
  match_count     int DEFAULT 20,
  filter_ticker   text DEFAULT NULL,
  filter_doc_type text DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  doc_type    doc_chunk_type,
  ticker      text,
  source_url  text,
  source_id   text,
  chunk_text  text,
  chunk_index integer,
  metadata    jsonb,
  similarity  float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.doc_type,
    dc.ticker,
    dc.source_url,
    dc.source_id,
    dc.chunk_text,
    dc.chunk_index,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.doc_chunks dc
  WHERE dc.embedding IS NOT NULL
    AND (filter_ticker   IS NULL OR dc.ticker   = filter_ticker)
    AND (filter_doc_type IS NULL OR dc.doc_type::text = filter_doc_type)
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================================
-- 6. CR3 TERRITORIES (Phase 7) — Seed all 13 Seacoast FL territories
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.cr3_territories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  territory_id  text UNIQUE NOT NULL,
  region        text NOT NULL,
  county        text,
  zip_codes     text[] NOT NULL DEFAULT ARRAY[]::text[],
  ar_type       text,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cr3_territories_region
  ON public.cr3_territories (region);

INSERT INTO public.cr3_territories (territory_id, region, county, zip_codes, ar_type) VALUES
  ('MIAMI_FL-01',    'Seacoast FL', 'Miami-Dade North',      ARRAY['33054','33161','33162','33168','33169','33056'], 'Seacoast FL'),
  ('MIAMI_FL-02',    'Seacoast FL', 'Miami-Dade Central',    ARRAY['33127','33136','33137','33150','33142','33147'], 'Seacoast FL'),
  ('MIAMI_FL-03',    'Seacoast FL', 'Miami-Dade West',       ARRAY['33126','33144','33155','33165','33175','33184'], 'Seacoast FL'),
  ('MIAMI_FL-04',    'Seacoast FL', 'Miami-Dade South',      ARRAY['33156','33157','33158','33176','33177','33186','33189','33190'], 'Seacoast FL'),
  ('MIAMI_FL-05',    'Seacoast FL', 'Miami-Dade Far South',  ARRAY['33030','33031','33032','33033','33034','33035'], 'Seacoast FL'),
  ('FTLAUD_FL-01',   'Seacoast FL', 'Broward South',         ARRAY['33004','33009','33019','33020','33021','33023'], 'Seacoast FL'),
  ('FTLAUD_FL-02',   'Seacoast FL', 'Broward Central',       ARRAY['33060','33062','33063','33064','33065','33066','33067','33068','33069'], 'Seacoast FL'),
  ('FTLAUD_FL-03',   'Seacoast FL', 'Broward West',          ARRAY['33024','33025','33026','33027','33028','33029','33071','33073','33076'], 'Seacoast FL'),
  ('STLUCIE_FL-01',  'Seacoast FL', 'Saint Lucie',           ARRAY[]::text[], 'Seacoast FL'),
  ('WESTPALM_FL-01', 'Seacoast FL', 'Palm Beach South',      ARRAY['33426','33432','33433','33434','33436','33437','33462','33472','33484'], 'Seacoast FL'),
  ('WESTPALM_FL-02', 'Seacoast FL', 'Palm Beach Central-North', ARRAY['33401','33402','33403','33404','33405','33406','33407','33408','33409','33410','33411','33412','33413','33414','33415','33416','33417','33418'], 'Seacoast FL'),
  ('WESTPALM_FL-03', 'Seacoast FL', 'Palm Beach',            ARRAY[]::text[], 'Seacoast FL'),
  ('ORLANDO_FL-08',  'Seacoast FL', 'Orange',                ARRAY[]::text[], 'Seacoast FL')
ON CONFLICT (territory_id) DO UPDATE SET
  region    = EXCLUDED.region,
  county    = EXCLUDED.county,
  zip_codes = EXCLUDED.zip_codes,
  ar_type   = EXCLUDED.ar_type;

-- ============================================================================
-- 7. STORM ALERTS (Phase 7)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.storm_alerts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storm_id                    text NOT NULL,
  storm_name                  text NOT NULL,
  category                    text,
  cone_geojson                jsonb,
  impacted_territory_ids      text[] NOT NULL DEFAULT ARRAY[]::text[],
  impacted_zips               text[] NOT NULL DEFAULT ARRAY[]::text[],
  threat_level                storm_threat_level NOT NULL DEFAULT 'watch',
  recommended_long_basket     text[] NOT NULL DEFAULT ARRAY[]::text[],
  recommended_short_basket    text[] NOT NULL DEFAULT ARRAY[]::text[],
  suggested_sizing_notes      text,
  alert_sent_at               timestamptz,
  alert_sent_channels         text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at                  timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_storm_alerts_storm
  ON public.storm_alerts (storm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storm_alerts_threat
  ON public.storm_alerts (threat_level);

-- ============================================================================
-- 8. TAX HARVEST SUGGESTIONS (Phase 8)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tax_harvest_suggestions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   text NOT NULL DEFAULT 'wes',
  week_of                   date NOT NULL,
  position_ticker           text NOT NULL,
  position_cost_basis       numeric(14, 4),
  position_market_value     numeric(14, 4),
  unrealized_loss           numeric(14, 4),
  suggested_harvest_qty     numeric(14, 4),
  swap_candidate_ticker     text,
  swap_correlation          numeric(5, 4),
  wash_sale_safe            boolean NOT NULL DEFAULT true,
  estimated_tax_savings_usd numeric(14, 4),
  status                    tax_harvest_status NOT NULL DEFAULT 'suggested',
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ths_user_week
  ON public.tax_harvest_suggestions (user_id, week_of DESC);
CREATE INDEX IF NOT EXISTS idx_ths_status
  ON public.tax_harvest_suggestions (status);

-- ============================================================================
-- 9. COACH REVIEWS (Phase 10)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coach_reviews (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                         text NOT NULL DEFAULT 'wes',
  week_of                         date NOT NULL,
  review_markdown                 text NOT NULL,
  patterns_detected               jsonb NOT NULL DEFAULT '[]'::jsonb,
  primary_rule_for_next_week      text,
  trade_count                     integer,
  pnl_usd                         numeric(14, 4),
  created_at                      timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_coach_reviews_user_week UNIQUE (user_id, week_of)
);
CREATE INDEX IF NOT EXISTS idx_coach_reviews_user_week
  ON public.coach_reviews (user_id, week_of DESC);

-- ============================================================================
-- 10. PREDICTION MARKET SNAPSHOTS (Phase 11)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.prediction_market_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source          prediction_market_source NOT NULL,
  market_ticker   text NOT NULL,
  market_name     text NOT NULL,
  yes_price       numeric(7, 4),
  no_price        numeric(7, 4),
  volume_24h      numeric(16, 2),
  delta_24h       numeric(7, 4),
  category        text,
  snapshot_at     timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pms_ticker_snap
  ON public.prediction_market_snapshots (market_ticker, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_pms_source_snap
  ON public.prediction_market_snapshots (source, snapshot_at DESC);

-- ============================================================================
-- 11. TRADE DEBATES (Phase 12)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.trade_debates (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  text NOT NULL DEFAULT 'wes',
  ticker                   text NOT NULL,
  proposed_trade           jsonb NOT NULL DEFAULT '{}'::jsonb,
  bull_rounds              jsonb NOT NULL DEFAULT '[]'::jsonb,
  bear_rounds              jsonb NOT NULL DEFAULT '[]'::jsonb,
  moderator_verdict        text,
  moderator_confidence     numeric(5, 2),
  key_tension_points       jsonb NOT NULL DEFAULT '[]'::jsonb,
  wes_decision             debate_decision,
  linked_trade_id          uuid,
  created_at               timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trade_debates_user_created
  ON public.trade_debates (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_debates_ticker
  ON public.trade_debates (ticker, created_at DESC);

-- ============================================================================
-- 12. AGENT ACTIVITY (unified across all agents)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agent_activity (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name      text NOT NULL,
  action          text NOT NULL,
  user_id         text NOT NULL DEFAULT 'wes',
  input_summary   text,
  output_summary  text,
  model           text,
  tokens_in       integer,
  tokens_out      integer,
  cost_usd        numeric(10, 6),
  latency_ms      integer,
  status          text NOT NULL DEFAULT 'ok',
  error_message   text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_activity_user_created
  ON public.agent_activity (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_activity_agent_created
  ON public.agent_activity (agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_activity_status
  ON public.agent_activity (status);

-- ============================================================================
-- 13. ALERTS (unified notification inbox)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL DEFAULT 'wes',
  source      text NOT NULL,
  severity    alert_severity NOT NULL DEFAULT 'info',
  title       text NOT NULL,
  body        text,
  link        text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  acked_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alerts_user_created
  ON public.alerts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unacked
  ON public.alerts (user_id, created_at DESC) WHERE acked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_severity
  ON public.alerts (severity) WHERE acked_at IS NULL;

-- ============================================================================
-- RLS: enable on every new table + single service_role_full_access policy each
-- ============================================================================
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'keisha_briefings',
    'crew_runs',
    'earnings_sessions',
    'earnings_transcript_chunks',
    'earnings_memos',
    'deep_research_memos',
    'doc_chunks',
    'cr3_territories',
    'storm_alerts',
    'tax_harvest_suggestions',
    'coach_reviews',
    'prediction_market_snapshots',
    'trade_debates',
    'agent_activity',
    'alerts'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS service_role_full_access ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY service_role_full_access ON public.%I
         AS PERMISSIVE
         FOR ALL
         TO service_role
         USING (true)
         WITH CHECK (true);',
      t
    );
  END LOOP;
END $$;

COMMIT;
