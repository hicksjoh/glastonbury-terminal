# Glastonbury Terminal — QA & Fix Prompt

## PROJECT
- **Path**: `/Users/wesley/Projects/glastonbury-terminal`
- **Live URL**: https://terminal.johnwesleyhicks.com
- **Stack**: Next.js 14, TypeScript, Tailwind, Recharts, Alpaca, FMP, Supabase, Claude API

## INSTRUCTIONS
Run a full QA pass on every page and API route. For each issue found: diagnose root cause, fix it, and verify the fix. Work through all sections below sequentially. After all fixes, run `npm run build`, commit, and push to deploy.

---

## PHASE 1: CRITICAL FIXES

### 1A. Risk Dashboard Stuck Loading
**Page**: `/risk`
**Issue**: Shows "Calculating risk metrics..." indefinitely and never renders.
**Diagnose**: Check `src/app/risk/page.tsx` and `src/app/api/risk/route.ts`. The likely cause is:
- The API route errors out when portfolio has 0 open positions (Wes currently has $100K cash, no positions)
- Missing error handling or empty-state for when there's nothing to calculate risk on
**Fix**: 
- Add a graceful empty state: "No open positions — risk metrics will populate when you hold positions. Your portfolio is 100% cash."
- Show placeholder cards with VaR: $0, Max Drawdown: 0%, Beta: 0, Sharpe: N/A
- The stress test section should show: "Add positions to run stress tests"
- Ensure the API route returns valid JSON even with empty positions array — never hang or throw unhandled errors

### 1B. Sectors Showing +0.00% With No Drill-Down Data
**Page**: `/sectors`
**Issue**: All 8 sectors show +0.00% even though there should be last-close data available.
**Diagnose**: Check where sector data is fetched. If using FMP `/api/v3/sectors-performance`, verify:
- The FMP_API_KEY is set in `.env.local`
- The API call actually fires on page load
- The response is mapped correctly to the UI
**Fix**:
- Verify FMP call works, fix any mapping issues
- When markets are closed, show previous trading day's sector performance (not 0.00%)
- Test the drill-down: clicking a sector should expand to show top 5 stocks. Verify this works with FMP data
- If FMP key is missing or quota exceeded, show a friendly message instead of 0.00%

---

## PHASE 1.5: NEWS PAGE UI OVERHAUL — Make It Visual & Premium

### Current State
The News page is a flat vertical list of text headlines with small source/ticker badges. It works but feels like an RSS feed, not a financial terminal. We need to make it look more like Bloomberg Terminal's news section or Koyfin's news feed — scannable, visual, and information-dense.

### Redesign Requirements

**Layout: Split into 3 sections**

**Section 1: Sentiment Summary Bar (top of page, below filters)**
- Horizontal bar showing today's aggregate sentiment at a glance
- Format: `📊 Today's Sentiment: 68% Bullish • 22% Neutral • 10% Bearish — 47 articles analyzed`
- Use a horizontal stacked bar chart (thin, ~8px tall) with green/gray/red segments proportional to sentiment percentages
- Updates in real-time as new articles come in
- This gives Wes an instant read on market mood without scrolling

**Section 2: Featured Story Cards (top 3-5 most recent or most impactful)**
- Display the top 3-5 stories as larger card tiles in a horizontal row
- Each card: ~300px wide, dark card background (#1a1a2e border with subtle glow)
- Card contents:
  - **THUMBNAIL IMAGE** at the top of each card (~300px wide x 160px tall, object-cover, rounded-t-lg)
    - Benzinga API includes `images` array in news responses — use the first image URL
    - Finnhub API includes `image` field in news responses — use that URL
    - If no image available: show a gradient placeholder card matching the sentiment color (green gradient for bullish, red for bearish, dark gray for neutral) with the ticker symbol in large text as a visual fallback
    - Use `next/image` with `unoptimized={true}` for external URLs, or a regular `<img>` tag with lazy loading
    - Add `onerror` handler to swap to the gradient fallback if image URL is broken
  - Below the image:
  - Headline (bold, 2 lines max with ellipsis overflow)
  - Source badge (Benzinga orange / Finnhub blue) + time ago
  - Ticker badges (gold, same as current)
  - Sentiment badge (large, right-aligned): green circle for Bullish, red for Bearish, gray for Neutral
  - 1-line preview/summary text if available from the API (gray, smaller font)
- Cards should be horizontally scrollable if more than fit the viewport
- Clicking a card opens the article URL in a new tab

**Section 3: Full Feed (below cards)**
- Keep the existing vertical list for the full feed BUT enhance each row:
  - **THUMBNAIL**: Add a small image thumbnail on the left side of each row (~80px x 60px, rounded, object-cover)
    - Same image source logic as featured cards (Benzinga `images[0]`, Finnhub `image` field)
    - If no image: show a small colored square with the first ticker symbol initial
  - Add a thin left border color: green for Bullish, red for Bearish, gray for Neutral (like a severity indicator)
  - Source badge should be more prominent: colored pill (orange for Benzinga, blue for Finnhub)
  - Ticker badges stay gold
  - Sentiment badge on the right side (already there — keep it)
  - Add a subtle hover effect: slight background lighten + left border thickens
  - Add relative timestamp: "2m ago", "15m ago", "1h ago" (already there — keep it)
  - If the article has a summary/snippet from the API, show first 100 chars as a subtitle in gray
  - Row layout should be: [Thumbnail 80x60] [Headline + subtitle + badges] [Sentiment badge right-aligned]

**Section 4: Sidebar Market Pulse (optional, right side)**
- If viewport is wide enough (>1400px), add a narrow right sidebar with:
  - "Trending Tickers" — top 5 most-mentioned tickers in today's news
  - "Sentiment Shift" — any tickers that flipped from bearish to bullish (or vice versa) in last 4 hours
- On narrower viewports, hide this sidebar

### Image Data — Make Sure APIs Pass Image URLs Through
- **Benzinga (via Alpaca)**: The Alpaca news endpoint returns `images` array with `{size, url}` objects. Make sure the news API route (`src/app/api/` — find wherever Alpaca news is fetched) passes this `images` field through to the frontend. Use the "large" or "thumb" size image.
- **Finnhub**: The `/v1/news` endpoint returns an `image` string field (direct URL). Make sure the Finnhub API route passes this through.
- **Unified format**: When merging news from both sources, normalize to a single `imageUrl` field on each news item:
  ```typescript
  interface NewsItem {
    headline: string;
    source: 'benzinga' | 'finnhub';
    datetime: number;
    url: string;
    symbols: string[];
    summary?: string;
    sentiment?: 'bullish' | 'bearish' | 'neutral';
    imageUrl?: string;  // <-- ADD THIS
  }
  ```
- **Next.js image domains**: If using `next/image`, add `images.benzinga.com` and `static2.finnhub.io` (and any other CDN domains) to `next.config.js` under `images.remotePatterns`. Or use `unoptimized={true}` to skip domain restrictions.

### Color System for Sentiment
- Bullish: `#22c55e` (green) with `bg-green-500/10` background
- Bearish: `#ef4444` (red) with `bg-red-500/10` background  
- Neutral: `#6b7280` (gray) with `bg-gray-500/10` background

### Typography
- Headlines: `text-base font-semibold text-white` (featured cards: `text-lg`)
- Source/time: `text-xs text-gray-400`
- Preview text: `text-sm text-gray-500`
- Sentiment label: `text-xs font-bold uppercase`

### Animation & Polish
- Featured cards fade in with a subtle stagger animation on load
- New articles that appear on refresh slide in from the top with a brief highlight glow
- Smooth transitions on filter changes (fade out old results, fade in new)
- Loading skeleton states while fetching (gray pulsing placeholder cards)

### Responsive
- Desktop (>1200px): Featured cards row + full feed + optional sidebar
- Tablet (768-1200px): Featured cards row + full feed, no sidebar
- Mobile (<768px): Stack everything vertically, featured cards become full-width

---

## PHASE 2: FEATURE VERIFICATION & POLISH

### 2A. News Sentiment System
**Page**: `/news`
**Verify**:
- [ ] Sentiment badges (Bullish/Bearish/Neutral) appear on ALL headlines, not just some
- [ ] Clicking "Bullish" filter shows only bullish headlines
- [ ] Clicking "Bearish" filter shows only bearish headlines  
- [ ] Clicking "Neutral" filter shows only neutral headlines
- [ ] "Finnhub" source filter shows Finnhub-sourced articles (verify FINNHUB_API_KEY is being used)
- [ ] Clicking "Benzinga" shows only Benzinga articles
- [ ] "All Sources" shows merged feed sorted by time
- [ ] Sentiment scoring uses Claude Haiku (not Sonnet) to keep costs minimal
- [ ] Headlines are cached so the same headline isn't re-scored on refresh
**Fix any failures found.**

### 2B. Watchlist Sparklines
**Page**: `/watchlist`
**Verify**:
- [ ] "7D" column header exists between SYMBOL and PRICE
- [ ] When tickers are added (add AAPL, MSFT, NVDA for testing), sparklines render as tiny SVG lines
- [ ] Green sparkline if stock is up over 7 days, red if down
- [ ] Sparklines don't re-fetch on every 30s refresh (should only refresh every 5 minutes)
- [ ] If no tickers, the column header still shows but rows are empty (current behavior — fine)
**Fix any failures found.**

### 2C. Sector Drill-Down
**Page**: `/sectors`
**Verify**:
- [ ] Clicking a sector card expands it (or opens a dropdown/modal)
- [ ] Expanded view shows top 5 stocks in that sector by % change
- [ ] Each stock shows: ticker, company name, % change
- [ ] Close/collapse button works to return to overview
- [ ] Transition animation is smooth
**Fix any failures found.**

### 2D. Stock Screener
**Page**: `/screener`
**Verify**:
- [ ] All 3 presets load correct filters: "Dividend Aristocrats", "Growth Monsters", "Value Plays"
- [ ] Clicking "Run Screen" returns results from FMP
- [ ] "+ Add Filter" adds a new filter row
- [ ] Filter dropdowns include: Market Cap, P/E, ROE, ROA, Net Margin, Dividend Yield, Beta, Revenue Growth, Volume, Sector
- [ ] Results display in a sortable table
- [ ] Multiple filters combine with AND logic
- [ ] Handle FMP rate limits gracefully (show message, not crash)
**Fix any failures found.**

### 2E. Strategy Benchmark Charts
**Page**: `/strategies`
**Verify**:
- [ ] Each strategy card shows benchmark comparison area
- [ ] "No trade history" message is displayed for strategies with 0 trades in Supabase
- [ ] When trades exist, a Recharts LineChart renders with gold (strategy) and gray dashed (SPY) lines
- [ ] Time period selector (1W, 1M, 3M, ALL) is present and functional
**Fix any failures found.**

### 2F. Custom Alerts
**Page**: `/alerts`
**Verify**:
- [ ] 3 preset templates shown: Dip Buy Alert, Volatility Spike, Earnings Play
- [ ] Clicking "+ New Alert" opens a builder form
- [ ] Builder has: name field, symbol input, metric dropdown, operator dropdown, value input
- [ ] Can add multiple conditions (AND/OR toggle)
- [ ] Action selector: "Notify me" / "Log to audit" / "Ask Keisha to analyze"
- [ ] Pause/Enable buttons work on existing alerts
- [ ] Alert evaluation runs on dashboard refresh cycle
- [ ] Triggered alerts appear somewhere (bell icon, toast, or in alert history)
**Fix any failures found.**

### 2G. Agent Action Explanations
**Page**: Dashboard `/` — Agent Activity section
**Verify**:
- [ ] Each agent action in the activity feed has a subtitle/reason explaining WHY the action was taken
- [ ] Reason text is gray, smaller font, below the main action description
- [ ] Audit log entries in Supabase include a reason/details field
**Fix any failures found.**

### 2H. Offline Cache
**Verify**:
- [ ] `src/lib/cache.ts` exists with cacheSet/cacheGet functions
- [ ] Dashboard data is cached after successful fetch
- [ ] If you temporarily break an API call (bad key), cached data shows with amber "Showing cached data" banner
- [ ] CONNECTIONS panel on dashboard shows real connection status (green = connected, red = disconnected)
**Fix any failures found.**

---

## PHASE 3: KEISHA AI CONTEXT UPDATE

### 3A. Update Keisha's System Prompt to Know About New Features
**File**: `src/lib/claude.ts` (find the Keisha system prompt)
**What**: Keisha needs to know about ALL the new features so she can reference them, direct Wes to use them, and pull data from them.

**Add to Keisha's system prompt** (in the capabilities/context section):

```
## NEW TERMINAL FEATURES (recently added)

You now have access to these new capabilities in the Glastonbury Terminal:

### News Sentiment Analysis
- The News page now scores every headline as BULLISH, BEARISH, or NEUTRAL using AI sentiment analysis
- Sources: Benzinga (via Alpaca) AND Finnhub (free tier, real-time market news)
- You can reference sentiment trends in your briefings: "Market sentiment is running 70% bullish today based on 45 headlines analyzed"
- Filter by sentiment or source available on the News page

### Stock Screener (Advanced)
- Full compound screener at /screener with 20+ metrics
- Filters: Market Cap, P/E, Forward P/E, P/B, P/S, ROE, ROA, Net Margin, Dividend Yield, Beta, Revenue Growth, Volume, Sector, Industry
- Pre-built screens: "Dividend Aristocrats", "Growth Monsters", "Value Plays"
- When Wes asks "find me stocks that...", suggest using the Stock Screener and recommend filter criteria

### Risk Dashboard
- Portfolio risk analysis at /risk: Value-at-Risk (95% confidence), Max Drawdown, Portfolio Beta, Sharpe Ratio
- Stress test scenarios: 2008 Crisis, COVID Crash, Rate Shock, Tech Correction, Custom
- Correlation matrix showing diversification analysis
- When discussing risk, reference these metrics and suggest Wes check the Risk Dashboard

### Custom Alerts Engine
- Compound alert rules at /alerts with AND/OR logic
- Metrics: Price, % Change, Volume, P/E, RSI, VIX levels
- Active presets: "Dip Buy Alert" (AAPL < $170 AND RSI < 30), "Volatility Spike" (VIX > 25)
- When Wes mentions wanting to watch for something, suggest creating a custom alert

### Strategy Benchmarking
- Each strategy on /strategies now shows performance vs SPY benchmark
- Tracks Alpha (excess return over S&P 500)
- When discussing strategy performance, reference the benchmark comparison

### Sector Drill-Down
- Sector Performance page now supports click-to-expand showing top 5 movers per sector
- Reference sector-level trends in morning briefs

### Watchlist Sparklines
- 7-day price sparklines now show next to each watchlist ticker
- Quick visual trend indicator

### Offline Cache
- Terminal now caches data gracefully — if APIs disconnect, shows last-known data with staleness indicator
```

### 3B. Update Keisha's Morning Briefing to Include New Data
**File**: `src/app/api/briefing/route.ts`
**What**: The morning briefing should pull from new features when available.
**Add to briefing context**:
- Aggregate news sentiment: count of bullish vs bearish headlines from last 12 hours
- Any triggered alerts from the alerts system
- Risk metrics summary (if positions exist): current VaR, portfolio beta
- Top sector movers from sector data

### 3C. Enable Keisha to Query New Features
**What**: When Wes asks Keisha questions like "what are the risks in my portfolio?" or "run a screen for dividend stocks", Keisha should be able to reference or link to the appropriate page.
**How**: In Keisha's response generation, when she detects intent related to new features, she should include a link/suggestion:
- Risk questions → "Check your Risk Dashboard at /risk for full VaR and stress test analysis"
- Screening questions → "I'd suggest running the Stock Screener at /screener — try the 'Dividend Aristocrats' preset"
- Alert questions → "You can set that up as a Custom Alert at /alerts"
- Sentiment questions → "The News page at /news now shows real-time sentiment — currently running X% bullish"

---

## PHASE 4: FINAL VERIFICATION

1. Run `npm run build` — must pass with 0 errors
2. Run `npm run test:smoke` — fix any failures
3. Visit every page in the browser and verify no console errors:
   - `/` (Dashboard)
   - `/news`
   - `/watchlist`
   - `/sectors`
   - `/calendar`
   - `/trading`
   - `/screener`
   - `/risk`
   - `/strategies`
   - `/alerts`
   - `/monte-carlo`
   - `/keisha`
4. Test Keisha: ask her "What new features do I have?" — she should list them
5. Test Keisha: ask "What's the market sentiment today?" — she should reference the news sentiment data
6. Git commit: `fix: QA pass — risk dashboard empty state, sector data, Keisha context update`
7. Git push to trigger Vercel deploy
