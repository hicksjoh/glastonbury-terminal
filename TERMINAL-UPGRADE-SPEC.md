# Glastonbury Terminal — Full Upgrade Spec (All 3 Waves)

## PROJECT CONTEXT
- **Project**: `/Users/wesley/Projects/glastonbury-terminal`
- **Stack**: Next.js 14 (App Router), TypeScript, Tailwind CSS, Recharts, Lightweight Charts
- **APIs**: Alpaca (paper trading), FMP (Financial Modeling Prep), Supabase (PostgreSQL), Anthropic Claude (Keisha AI)
- **Deploy**: Vercel (auto-deploys on push to main)
- **Domain**: terminal.johnwesleyhicks.com

## EXECUTION INSTRUCTIONS
**Step 0 (before anything else):** Add the Finnhub API key to `.env.local` — check if FINNHUB_API_KEY already exists, if not run: `echo "FINNHUB_API_KEY=d75hpq9r01qk56kcr2e0d75hpq9r01qk56kcr2eg" >> .env.local`

Then execute all 3 waves sequentially. After completing each wave:
1. Run `npm run build` to verify no build errors
2. Run `npm run test:smoke` if Playwright is configured
3. Git commit with message: `feat: Wave X — [description]`
4. Confirm success, then proceed to next wave
5. After all 3 waves, do a final `git push` to trigger Vercel deploy

If a build fails, fix the error before moving to the next wave.

---

## WAVE 1: Quick Wins (UI Enhancements)

### 1A. Watchlist Sparklines
**File**: `src/app/watchlist/page.tsx`
**What**: Add tiny 7-day price sparkline charts next to each ticker in the Watchlist table.
**How**:
- For each watchlist symbol, fetch 7-day historical bars from Alpaca Data API (`/v2/stocks/{symbol}/bars?timeframe=1Day&limit=7`) or use FMP historical endpoint
- Create a small `<SparklineChart />` component in `src/components/SparklineChart.tsx`
  - Use an inline SVG polyline (no library needed) — ~40px tall, ~100px wide
  - Color: green (#22c55e) if last close > first close, red (#ef4444) if down
  - No axes, no labels — just the line
- Add the sparkline as a new column in the watchlist table between SYMBOL and PRICE
- Cache the sparkline data in state so it doesn't re-fetch on every 30s watchlist refresh (only refresh sparklines every 5 minutes)

### 1B. Sector Heatmap Drill-Down
**File**: `src/app/sectors/page.tsx`
**What**: Make sector cards clickable to expand and show top 5 movers within that sector.
**How**:
- When a sector card is clicked, expand it (or show a dropdown/modal) with the top 5 stocks in that sector by % change
- Use FMP sector endpoint: `/api/v3/stock-screener?sector={sector}&limit=5&sort=changesPercentage` or `/api/v3/sectors-performance`
- For each stock in the drill-down, show: ticker, company name, % change, mini sparkline
- Add a close/collapse button to return to the overview
- Animate the expansion with Tailwind transitions (`transition-all duration-300`)
- If FMP key isn't set, gracefully show "Connect FMP API for drill-down data"

### 1C. Agent Action Explanations
**Files**: `src/lib/claude.ts`, `src/app/api/strategies/route.ts`, and the agent activity log component
**What**: Add a "reason" field to every agent action logged in the audit_log table.
**How**:
- In the Supabase `audit_log` table, ensure there's a `details` or `metadata` JSONB column (check existing schema in `supabase/schema.sql`)
- When strategies execute actions (covered call wheel sells a call, tax-loss harvester sells a position, rebalancer trades), include a human-readable `reason` string in the audit log entry. Examples:
  - "Sold AAPL 185C: 30 DTE reached, IV rank 42%, theta decay optimal"
  - "Harvested TSLA loss: -$340 realized, offsetting $520 in gains this quarter"
  - "Rebalanced: Tech allocation drifted to 38% (target 30%), sold 5 shares NVDA"
- In the Agent Activity component on the dashboard, display this reason as a subtitle under each action (gray text, smaller font)
- The reason should come from the strategy logic itself — when making a decision, format WHY the decision was made

### 1D. Offline/Cache Mode
**File**: Create `src/lib/cache.ts` and update key data-fetching components
**What**: Cache last-known dashboard data so the terminal shows stale data gracefully if APIs are down.
**How**:
- Create a simple cache utility using sessionStorage:
  - `cacheSet(key, data, ttlMs = 300000)` — stores data with expiry timestamp
  - `cacheGet(key)` — returns data if not expired, null otherwise
- In key API-calling hooks/components (dashboard stats, watchlist, positions), wrap fetch calls:
  1. Try live fetch
  2. On success: cache the result with 5-minute TTL
  3. On failure: return cached data + set a `isStale` flag
- When showing stale data, display a small amber banner at the top: "Showing cached data from X minutes ago — live feed reconnecting..."
- Add connection status indicators to the CONNECTIONS panel on the dashboard — make the green dots actually reflect real connection status via a health check ping

**WAVE 1 COMMIT**: `feat: Wave 1 — watchlist sparklines, sector drill-down, agent explanations, offline cache`

---

## WAVE 2: Data Features

### 2A. News Sentiment Scoring
**Files**: `src/app/news/page.tsx`, create `src/app/api/sentiment/route.ts`
**What**: Add bullish/bearish/neutral sentiment badges to every news headline.
**How**:
- Create a new API route `src/app/api/sentiment/route.ts` that accepts an array of headlines and returns sentiment scores
- Use the existing Anthropic Claude connection (from `src/lib/claude.ts`) with a lightweight prompt:
  - "Classify each headline as BULLISH, BEARISH, or NEUTRAL. Return JSON array with format: [{index, sentiment, confidence}]"
  - Use `claude-haiku` (cheapest model) for this — sentiment classification doesn't need Sonnet
  - Batch headlines in groups of 10-20 per API call to minimize cost
- On the News page, add a colored badge next to each headline:
  - BULLISH = green badge
  - BEARISH = red badge
  - NEUTRAL = gray badge
- Add a filter option: "Show only Bullish" / "Show only Bearish" alongside existing category tabs
- Cache sentiment results in memory (Map) keyed by headline hash — don't re-score the same headline
- Rate limit: only score headlines that are less than 24 hours old

### 2B. Screener Depth Upgrade
**File**: `src/app/screener/page.tsx` (check actual path — may be at a different route)
**What**: Expand the stock screener to support 20+ filter criteria with compound conditions.
**How**:
- Add these filter categories (using FMP endpoints already available):
  - **Valuation**: P/E, Forward P/E, P/B, P/S, PEG, EV/EBITDA
  - **Profitability**: ROE, ROA, Net Margin, Gross Margin, Operating Margin
  - **Growth**: Revenue Growth (YoY), EPS Growth, Dividend Growth
  - **Dividends**: Dividend Yield, Payout Ratio, Ex-Dividend Date
  - **Technical**: 52-Week High/Low %, RSI, Average Volume, Beta
  - **Size**: Market Cap (Mega/Large/Mid/Small/Micro), Sector, Industry
- Each filter should have: field selector dropdown, operator (>, <, =, between), value input
- Allow adding multiple filters (AND logic) with a "+ Add Filter" button
- FMP endpoint: `/api/v3/stock-screener?marketCapMoreThan=X&betaMoreThan=Y&volumeMoreThan=Z&sector=Technology&limit=50`
- Display results in a sortable table with all key metrics visible
- Add a "Save Screen" button that stores filter presets in Supabase (create a `screener_presets` table if needed)
- Pre-build 3 starter presets: "Dividend Aristocrats" (yield>3%, payout<60%), "Growth Monsters" (revGrowth>20%, epsGrowth>15%), "Value Plays" (P/E<15, ROE>15%)

### 2C. Strategy vs. Benchmark Charts
**File**: `src/app/strategies/page.tsx`
**What**: Add a performance chart to each strategy card showing its returns vs SPY.
**How**:
- For each active strategy, pull its trade history from Supabase `trades` table filtered by strategy name
- Calculate cumulative return over time (daily or per-trade resolution)
- Pull SPY daily returns from Alpaca for the same period
- Use Recharts `<LineChart>` (already in the project) to render an overlay:
  - Strategy line: gold (#f0c674)
  - SPY benchmark: gray (#6b7280) dashed line
  - Chart height: ~150px, embedded below each strategy card's stats
- Show key stats: Alpha (strategy return - SPY return), Sharpe-like ratio if possible
- If a strategy has no trades yet, show "No trade history — benchmark comparison will appear after first execution"
- Add a time period selector: 1W, 1M, 3M, ALL

**WAVE 2 COMMIT**: `feat: Wave 2 — news sentiment scoring, screener upgrade, strategy benchmarks`

---

## WAVE 3: New Features & Systems

### 3A. Risk Dashboard (New Page)
**Files**: Create `src/app/risk/page.tsx`, create `src/app/api/risk/route.ts`, update sidebar
**What**: Full risk analysis page with VaR, stress testing, and correlation matrix.
**How**:

**Add to Sidebar**: Add "Risk" link in the TOOLS section (between Screener and Strategies), icon: Shield or AlertTriangle from lucide-react

**Page Layout** (3 sections):

**Section 1: Portfolio Risk Summary Cards**
- Value at Risk (VaR) — 95% confidence, 1-day horizon
  - Calculate using historical simulation: pull 252 trading days of daily returns for each position from Alpaca/FMP
  - Sort portfolio daily P&L, VaR = 5th percentile loss
  - Display as: "1-Day VaR (95%): -$X,XXX" with a red card
- Max Drawdown — largest peak-to-trough decline in portfolio value
- Beta — portfolio beta vs SPY (weighted average of position betas)
- Sharpe Ratio — (portfolio return - risk free rate) / portfolio std dev

**Section 2: Stress Test Scenarios**
- Pre-built scenarios with sliders:
  - "2008 Financial Crisis" — apply -38% to equities, +20% to bonds
  - "COVID Crash (March 2020)" — apply -34% to equities
  - "Interest Rate Shock (+2%)" — apply sector-specific impacts
  - "Tech Correction (-20%)" — apply -20% to tech holdings, -5% to others
  - Custom: let user set % change per sector
- For each scenario, show: projected portfolio value, projected loss, which positions hurt most
- Display as a table with color-coded impact (green = gains, red = losses)

**Section 3: Correlation Matrix**
- Pull daily returns for top 10 portfolio holdings (or watchlist items)
- Calculate pairwise Pearson correlation
- Display as a heatmap grid (Recharts or custom SVG):
  - Dark red = high positive correlation (>0.8)
  - White = no correlation (~0)
  - Dark blue = negative correlation
- Highlight diversification warnings: "AAPL and MSFT are 0.87 correlated — consider diversifying"

**API Route** (`src/app/api/risk/route.ts`):
- Accept portfolio positions as input
- Fetch historical price data from FMP: `/api/v3/historical-price-full/{symbol}?timeseries=252`
- Calculate all risk metrics server-side (VaR, correlations, stress tests)
- Return structured JSON for the frontend

### 3B. Custom Alert Rules Engine
**Files**: Create `src/app/api/alerts/route.ts`, create `src/app/alerts/page.tsx`, create Supabase table
**What**: Let Wes define compound alert conditions that trigger notifications.
**How**:

**Database**: Create `alerts` table in Supabase:
```sql
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
```

**Alert Builder UI**:
- Form with dynamic rows: [Symbol] [Metric] [Operator] [Value]
  - Metrics: Price, % Change, Volume, P/E, RSI, VIX, 52-Week High/Low Distance
  - Operators: >, <, =, crosses above, crosses below
- Logic toggle: ALL conditions (AND) / ANY condition (OR)
- Action selector: "Notify me" / "Log to audit" / "Ask Keisha to analyze"
- Pre-built templates:
  - "Dip Buy Alert": AAPL price < $170 AND RSI < 30
  - "Volatility Spike": VIX > 25 AND portfolio beta > 1.2
  - "Earnings Play": any watchlist stock within 7 days of earnings

**Evaluation Engine** (API route):
- On each watchlist/dashboard refresh cycle (every 30s), evaluate all active alerts
- Compare current market data against alert conditions
- If triggered: log to audit_log, show toast notification on dashboard, optionally send to Keisha for analysis
- Cool-down: don't re-trigger the same alert within 1 hour

**Dashboard Integration**:
- Add a small "Alerts" bell icon in the top bar (near the market status banner)
- Show count of triggered alerts as a badge
- Clicking opens a dropdown with recent alert triggers

### 3C. Finnhub News Integration (Free Tier)
**Files**: Update `src/app/news/page.tsx`, create `src/app/api/news/finnhub/route.ts`
**What**: Add Finnhub as a second news source alongside Benzinga/Alpaca.
**How**:

**Setup**:
- FINNHUB_API_KEY is already in `.env.local` — no action needed
- Free tier: 60 API calls/minute, market news + company news

**API Route** (`src/app/api/news/finnhub/route.ts`):
- Endpoint: `https://finnhub.io/api/v1/news?category=general&token={key}`
- Also: `https://finnhub.io/api/v1/company-news?symbol={sym}&from={date}&to={date}&token={key}`
- Map Finnhub response to match existing news item format: { headline, source, datetime, url, symbols }
- Cache results for 2 minutes to stay within rate limits

**News Page Updates**:
- Add a "Source" filter row: [All Sources] [Benzinga] [Finnhub]
- Merge and sort by timestamp when "All Sources" is selected
- Each headline shows source badge: "benzinga" (orange) or "finnhub" (blue)
- Finnhub news items also get sentiment scored by the Wave 2 sentiment system

**Fallback**: If `FINNHUB_API_KEY` is not set, just show Benzinga only (current behavior). No errors.

**WAVE 3 COMMIT**: `feat: Wave 3 — risk dashboard, custom alerts engine, Finnhub news integration`

---

## FINAL STEPS (After All 3 Waves)

1. Run full build: `npm run build`
2. Run smoke tests: `npm run test:smoke` (fix any failures)
3. Git push to main to trigger Vercel deploy
4. Final commit: `docs: update README with new features from upgrade waves`

---

## ENVIRONMENT VARIABLES — FIRST STEP
**BEFORE starting any wave**, append this line to `.env.local` if it's not already there:
```
FINNHUB_API_KEY=d75hpq9r01qk56kcr2e0d75hpq9r01qk56kcr2eg
```
Run: `echo "FINNHUB_API_KEY=d75hpq9r01qk56kcr2e0d75hpq9r01qk56kcr2eg" >> .env.local`

No other new API keys needed. Everything else uses existing Alpaca, FMP, Supabase, and Anthropic connections.

## ESTIMATED COST IMPACT
- Sentiment scoring via Claude Haiku: ~$0.01-0.05/day (trivial)
- Finnhub: Free tier (60 calls/min)
- All other features: $0 (pure code + existing APIs)
- **Total monthly cost increase: effectively $0**
