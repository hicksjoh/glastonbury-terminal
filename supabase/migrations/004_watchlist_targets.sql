-- Add buy/sell target columns to watchlist table
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS buy_target numeric(12,4);
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS sell_target numeric(12,4);
