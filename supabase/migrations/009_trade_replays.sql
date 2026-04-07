CREATE TABLE IF NOT EXISTS trade_replays (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT CHECK (side IN ('long', 'short')),
  entry_price NUMERIC,
  exit_price NUMERIC,
  pnl NUMERIC,
  entry_grade TEXT CHECK (entry_grade IN ('A','B','C','D','F')),
  exit_grade TEXT CHECK (exit_grade IN ('A','B','C','D','F')),
  optimal_exit_price NUMERIC,
  optimal_pnl NUMERIC,
  money_left_on_table NUMERIC,
  replay_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replays_user ON trade_replays(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_replays_trade ON trade_replays(trade_id);

ALTER TABLE trade_replays ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users read own replays" ON trade_replays FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users insert own replays" ON trade_replays FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
