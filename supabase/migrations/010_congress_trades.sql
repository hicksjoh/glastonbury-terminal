CREATE TABLE IF NOT EXISTS congress_trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  politician TEXT NOT NULL,
  party TEXT CHECK (party IN ('D', 'R', 'I')),
  state TEXT,
  ticker TEXT NOT NULL,
  transaction_type TEXT CHECK (transaction_type IN ('buy', 'sell', 'exchange')),
  amount_range TEXT,
  date_filed DATE,
  date_traded DATE,
  filing_url TEXT,
  source TEXT DEFAULT 'senate_efds',
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(politician, ticker, date_traded, transaction_type)
);

CREATE INDEX IF NOT EXISTS idx_congress_ticker ON congress_trades(ticker);
CREATE INDEX IF NOT EXISTS idx_congress_date ON congress_trades(date_traded DESC);
