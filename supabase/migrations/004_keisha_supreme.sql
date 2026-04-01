-- Keisha Supreme: Memory, Conversations, Signal Calibration
-- Migration 004

-- Keisha recommendation tracking with accuracy measurement
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

-- Signal calibration: track which signal sources actually perform
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

-- Conversation memory with ticker threading
CREATE TABLE IF NOT EXISTS keisha_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_message text NOT NULL,
  keisha_response text NOT NULL,
  symbols_mentioned text[],
  sentiment text,
  topics text[],
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_keisha_convos_symbols ON keisha_conversations USING GIN (symbols_mentioned);
CREATE INDEX IF NOT EXISTS idx_keisha_convos_created ON keisha_conversations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_keisha_recs_created ON keisha_recommendations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_keisha_recs_symbol ON keisha_recommendations (symbol);
