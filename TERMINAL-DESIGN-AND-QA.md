# Glastonbury Terminal — Design System + QA + News Overhaul + Keisha Update
# ONE PROMPT TO RULE THEM ALL

## PROJECT CONTEXT
- **Path**: `/Users/wesley/Projects/glastonbury-terminal`
- **Stack**: Next.js 14 (App Router), TypeScript, Tailwind CSS, Recharts
- **APIs**: Alpaca, FMP, Supabase, Anthropic Claude, Finnhub
- **Deploy**: Vercel (auto-deploys on push to main)
- **Domain**: terminal.johnwesleyhicks.com
- **Brand**: The Glastonbury Group — Afrofuturist Quiet Luxury aesthetic

## EXECUTION ORDER
1. Download & integrate brand logos
2. Create DESIGN-SYSTEM.md as the source of truth
3. Apply design system across all pages (visual consistency pass)
4. Fix critical bugs (Risk page, Sectors data)
5. News page visual overhaul with images & sentiment
6. Update Keisha AI context with all new features
7. Build, test, push

Do NOT ask questions. Use your judgment. Fix build errors as you go.

---

## PHASE 1: BRAND LOGO INTEGRATION

### 1A. Get Logos Into Project
First check if logos already exist: `ls ~/Blue\ Host/glastonbury-logo.png`

Copy the existing logo and create the needed variants:
```bash
mkdir -p public/brand
cp ~/Blue\ Host/glastonbury-logo.png public/brand/glastonbury-full-logo.png
# If these URLs have expired, the logos are also at ~/Blue Host/glastonbury-logo.png
# Copy that file as the full wordmark. For the G monogram, extract or create one.
# The full wordmark is "THE GLASTONBURY GROUP" in art deco geometric thin-line typography, black on transparent.
# The G monogram is a single geometric "G" letter in the same style.
# The circle logo is a minimalist circle design studio style logo.
```

If the Canva export URLs have expired, copy from `~/Blue Host/glastonbury-logo.png` as the primary logo. The logo is black linework on transparent — it needs CSS `filter: invert(1) brightness(1.8)` to appear white on the dark terminal theme.

### 1B. Integrate Logos Into Terminal
**Sidebar** (`src/components/layout/Sidebar.tsx` or AppShell):
- Replace the current plain "G" text/icon in the sidebar header with the actual G monogram image
- Size: 32x32px, with `filter: invert(1) brightness(1.8)` for white on dark
- Keep "Glastonbury Terminal" text below it but style it with the design system font
- "THE GLASTONBURY GROUP" subtitle stays, smaller, in the accent color

**Login Page** (`src/app/login/page.tsx`):
- Center the full wordmark logo above the password field
- Size: 400px wide, auto height
- Add subtle glow: `filter: invert(1) brightness(1.8) drop-shadow(0 0 20px rgba(138, 92, 246, 0.3))`

**Favicon** (`public/favicon.ico` or `src/app/favicon.ico`):
- Use the G monogram to generate a 32x32 favicon
- If you can't convert PNG to ICO easily, use the PNG directly via `<link rel="icon" type="image/png">`

**Dashboard watermark** (optional, subtle):
- Place the full wordmark as a very faint watermark in the dashboard hero section
- Opacity: 0.03-0.05, positioned behind the "Good evening, Wes" text
- Creates depth without distraction

---

## PHASE 2: DESIGN SYSTEM — Create DESIGN-SYSTEM.md

Create `DESIGN-SYSTEM.md` in the project root. This becomes the SINGLE SOURCE OF TRUTH.
Claude Code should also update `tailwind.config.ts` to formalize these tokens.

### Brand Identity
- **Name**: The Glastonbury Group
- **Aesthetic**: Afrofuturist Quiet Luxury — think Black Panther's Wakanda meets a Goldman Sachs trading floor
- **Mood**: Powerful, sophisticated, futuristic, premium, dark
- **Logo Style**: Art deco geometric thin-line typography

### Color Tokens
Audit the current codebase for ALL hex/rgb values. Consolidate into this system:

| Token Name | Hex | Tailwind Class | Usage |
|------------|-----|---------------|-------|
| `bg-primary` | `#0a0a1a` | `bg-[#0a0a1a]` | Main background, page bg |
| `bg-surface` | `#12122a` | `bg-[#12122a]` | Cards, panels, elevated surfaces |
| `bg-surface-hover` | `#1a1a3e` | `bg-[#1a1a3e]` | Card hover state |
| `bg-sidebar` | `#0d0d20` | `bg-[#0d0d20]` | Sidebar background |
| `accent-purple` | `#8a5cf6` | `text-[#8a5cf6]` | Primary accent, active states, links |
| `accent-purple-hover` | `#a78bfa` | `text-[#a78bfa]` | Hover state for purple elements |
| `accent-gold` | `#f0c674` | `text-[#f0c674]` | Secondary accent, CTAs, important values |
| `accent-gold-dim` | `#b89a4a` | `text-[#b89a4a]` | Muted gold for subtitles |
| `text-primary` | `#ffffff` | `text-white` | Primary text, headings |
| `text-secondary` | `#a0a0b8` | `text-[#a0a0b8]` | Secondary text, descriptions |
| `text-muted` | `#6b7280` | `text-gray-500` | Timestamps, placeholders |
| `success` | `#22c55e` | `text-green-500` | Positive P&L, bullish, connected |
| `danger` | `#ef4444` | `text-red-500` | Negative P&L, bearish, errors |
| `warning` | `#f59e0b` | `text-amber-500` | Warnings, stale data |
| `border-default` | `#1e1e3a` | `border-[#1e1e3a]` | Card borders, dividers |
| `border-glow` | `rgba(138,92,246,0.2)` | — | Focus/active border glow |

### Typography
| Element | Font | Weight | Size | Tracking |
|---------|------|--------|------|----------|
| Page title | Inter | 700 (Bold) | 2rem (text-3xl) | -0.02em |
| Section heading | Inter | 600 (Semibold) | 1.25rem (text-xl) | -0.01em |
| Card title | Inter | 600 | 1rem (text-base) | normal |
| Body text | Inter | 400 | 0.875rem (text-sm) | normal |
| Monospace values | JetBrains Mono | 500 | varies | 0.02em |
| Stat numbers | JetBrains Mono | 700 | 1.5-2.5rem | 0.05em |
| Badge/label | Inter | 600 | 0.75rem (text-xs) | 0.05em (uppercase) |

### Component Standards

**Cards** (the most-used component):
- Background: `bg-surface` (#12122a)
- Border: 1px solid `border-default` (#1e1e3a)
- Border radius: 12px (rounded-xl)
- Padding: 24px (p-6)
- Hover: background shifts to `bg-surface-hover`, border glows with `border-glow`
- Transition: `transition-all duration-200`

**Stat Cards** (dashboard KPIs):
- Same card base
- Label: `text-xs uppercase tracking-widest text-secondary`
- Value: `text-2xl font-mono font-bold text-white`
- Subtitle: `text-xs text-muted`
- Accent bar: 2px top border in the relevant color (gold for money, purple for progress, green for gains)

**Buttons**:
- Primary: `bg-accent-gold text-black font-semibold rounded-lg px-4 py-2`
- Secondary: `border border-accent-purple text-accent-purple rounded-lg px-4 py-2`
- Ghost: `text-secondary hover:text-white px-4 py-2`
- Danger: `bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg`

**Badges/Pills**:
- Source badge: colored background with white text, rounded-full, px-2 py-0.5, text-xs font-bold
- Benzinga: `bg-orange-500/20 text-orange-400`
- Finnhub: `bg-blue-500/20 text-blue-400`
- Sentiment: bullish=`bg-green-500/15 text-green-400`, bearish=`bg-red-500/15 text-red-400`, neutral=`bg-gray-500/15 text-gray-400`
- Ticker: `bg-yellow-500/15 text-yellow-400 font-mono`
- Status: active=`bg-green-500/15 text-green-400`, paused=`bg-gray-500/15 text-gray-400`, paper=`bg-blue-500/15 text-blue-400`

**Sidebar Navigation**:
- Inactive: `text-secondary hover:text-white hover:bg-white/5`
- Active: `text-accent-gold bg-white/5 border-l-2 border-accent-gold` (or accent-purple)
- Section headers: `text-xs uppercase tracking-widest text-muted mb-2`
- Icons: lucide-react, 18px, stroke-width 1.5

**Tables**:
- Header: `text-xs uppercase tracking-widest text-muted border-b border-border-default`
- Rows: `hover:bg-surface-hover transition-colors`
- Alternating: NO alternating row colors (clean dark look)
- Values: right-aligned for numbers, left for text

**Charts**:
- Recharts color palette: `#8a5cf6` (purple), `#f0c674` (gold), `#22c55e` (green), `#ef4444` (red), `#3b82f6` (blue)
- Grid lines: `#1e1e3a` (barely visible)
- Axis text: `#6b7280` (muted)
- Tooltip: dark bg with white text, rounded-lg, shadow-xl

### Spacing Scale
- Page padding: 32px (p-8)
- Card gap: 24px (gap-6)
- Section gap: 32px (gap-8)
- Inner card padding: 24px (p-6)
- Tight spacing (badges, inline): 8px (gap-2)

### Motion & Animation
- Default transition: `transition-all duration-200 ease-out`
- Card hover: `transform hover:scale-[1.01] transition-transform`
- Page enter: fade in from opacity-0, 300ms
- Loading: pulse animation on skeleton placeholders
- Glow effects: `shadow-[0_0_15px_rgba(138,92,246,0.15)]` for focused/active elements

### Shadows & Elevation
- Level 0 (flat): no shadow
- Level 1 (card): `shadow-lg shadow-black/20`
- Level 2 (dropdown/modal): `shadow-xl shadow-black/40`
- Level 3 (toast/notification): `shadow-2xl shadow-black/60`

### Apply the Design System
After creating DESIGN-SYSTEM.md:
1. Update `tailwind.config.ts` to add all color tokens as custom colors
2. Do a find-and-replace across the codebase for any hardcoded hex values that should use tokens
3. Ensure every card, button, badge, and table follows the standards above
4. Check each page for visual consistency — no page should look like it was built by a different developer

---

## PHASE 3: CRITICAL BUG FIXES

### 3A. Risk Dashboard Stuck Loading
**Page**: `/risk`
**Issue**: Shows "Calculating risk metrics..." forever, never renders.
**Cause**: API route likely errors when portfolio has 0 positions (Wes has $100K cash, no open positions).
**Fix**: Add graceful empty state: "No open positions — risk metrics populate when you hold positions. Portfolio is 100% cash." Show placeholder cards: VaR: $0, Max Drawdown: 0%, Beta: 0, Sharpe: N/A. Stress test section: "Add positions to run stress tests." API route must return valid JSON even with empty positions.

### 3B. Sectors Showing +0.00%
**Page**: `/sectors`
**Issue**: All 8 sectors show +0.00% with no real data.
**Fix**: Verify FMP API call fires on page load. When markets closed, show previous trading day's performance. Test drill-down: clicking a sector should expand with top 5 stocks. If FMP key missing, show friendly message.

---

## PHASE 4: NEWS PAGE VISUAL OVERHAUL

Transform the flat headline list into a premium visual news experience.

### Layout: 3 Sections

**Section 1: Sentiment Summary Bar** (top, below filters)
- `Today's Sentiment: 68% Bullish • 22% Neutral • 10% Bearish — 47 articles analyzed`
- Thin stacked bar chart (~8px) with green/gray/red proportional segments
- Updates in real-time as articles come in

**Section 2: Featured Story Cards** (top 3-5 stories, horizontal row)
- ~300px wide cards with dark bg (#12122a), subtle border glow
- **THUMBNAIL IMAGE** at top (~300x160px, object-cover, rounded-t-xl)
  - Benzinga API: `images` array — use first URL
  - Finnhub API: `image` field — use that URL
  - No image fallback: gradient card in sentiment color with ticker symbol large
  - Use `<img>` with lazy loading and onerror fallback
- Below image: headline (bold, 2 lines, ellipsis), source badge + time, ticker badges, sentiment badge
- Horizontally scrollable, clicking opens article URL

**Section 3: Full Feed** (enhanced vertical list)
- Small thumbnail on left (~80x60px, rounded)
- Thin left border: green=bullish, red=bearish, gray=neutral
- Prominent source pills (orange=Benzinga, blue=Finnhub)
- Hover: background lightens + border thickens
- Summary subtitle if available (gray, first 100 chars)

**API Image Data**: Make sure news API routes pass image URLs through. Normalize to `imageUrl` field on each news item. For next/image, add image CDN domains to `next.config.js` remotePatterns, or use `unoptimized`.

**Section 4: Trending Sidebar** (right side, >1400px viewport)
- "Trending Tickers" — top 5 most-mentioned tickers in today's news
- "Sentiment Shift" — tickers that flipped bullish/bearish in last 4 hours
- Hidden on narrower viewports

**Animation**: Cards fade in with stagger. New articles slide in from top with highlight glow. Smooth filter transitions. Loading skeleton states.

---

## PHASE 5: FEATURE VERIFICATION

Verify ALL recently deployed features work correctly. For each, test and fix:

- **News Sentiment**: badges on ALL headlines, filter tabs work, Haiku model used, cache in place
- **Watchlist Sparklines**: 7D column, SVG sparklines render when tickers added, green/red coloring
- **Sector Drill-Down**: click expands, top 5 stocks shown, close button works
- **Stock Screener**: 3 presets load filters, Run Screen returns results, + Add Filter works, FMP handles rate limits
- **Strategy Benchmarks**: benchmark area on each card, "No trade history" message, Recharts overlay when trades exist
- **Custom Alerts**: + New Alert builder, conditions work, Pause/Enable toggles, templates pre-built
- **Agent Explanations**: reason/why subtitle in Agent Activity feed, audit_log has details field
- **Offline Cache**: cache.ts exists, stale data shows amber banner, CONNECTIONS reflect real status

---

## PHASE 6: KEISHA AI CONTEXT UPDATE

### 6A. Update System Prompt
**File**: `src/lib/claude.ts` (find Keisha's system prompt)
Add this block to Keisha's capabilities section:

```
## TERMINAL FEATURES YOU CAN REFERENCE

### News Sentiment Analysis
News page scores every headline BULLISH/BEARISH/NEUTRAL via AI. Sources: Benzinga + Finnhub.
Reference in briefings: "Market sentiment running X% bullish today based on N articles."

### Stock Screener (/screener)
Compound filters: Market Cap, P/E, ROE, Dividend Yield, Beta, Revenue Growth, etc.
Presets: "Dividend Aristocrats", "Growth Monsters", "Value Plays"
When Wes asks "find me stocks that...", suggest the Screener with filter criteria.

### Risk Dashboard (/risk)
VaR (95%), Max Drawdown, Portfolio Beta, Sharpe Ratio. Stress tests: 2008, COVID, Rate Shock, Tech Correction.
When discussing risk, reference these and suggest checking /risk.

### Custom Alerts (/alerts)
Compound rules with AND/OR logic. Metrics: Price, % Change, Volume, RSI, VIX.
When Wes wants to watch for something, suggest creating a custom alert.

### Strategy Benchmarking (/strategies)
Each strategy shows performance vs SPY. Tracks Alpha.
Reference benchmark comparison when discussing strategy performance.

### Sector Drill-Down (/sectors)
Click-to-expand showing top 5 movers per sector.

### Watchlist Sparklines (/watchlist)
7-day sparklines next to each ticker.
```

### 6B. Morning Briefing Enhancement
**File**: `src/app/api/briefing/route.ts`
Add to briefing context: aggregate news sentiment (bullish vs bearish counts), triggered alerts, risk metrics (if positions exist), top sector movers.

### 6C. Page Linking
When Keisha detects intent related to new features, include links:
- Risk questions → "Check your Risk Dashboard at /risk"
- Screening → "Try the Stock Screener at /screener — use the 'Dividend Aristocrats' preset"
- Alert setup → "Set that up as a Custom Alert at /alerts"
- Sentiment → "News page at /news shows real-time sentiment"

---

## PHASE 7: FINAL VERIFICATION

1. Run `npm run build` — must pass with 0 errors
2. Run `npm run test:smoke` — fix any failures
3. Visually verify every page follows the design system (consistent cards, colors, typography, spacing)
4. Check browser console for errors on each page: /, /news, /watchlist, /sectors, /calendar, /trading, /screener, /risk, /strategies, /alerts, /monte-carlo, /keisha
5. Test Keisha: "What new features do I have?" — she should list them
6. Test Keisha: "What's the market sentiment today?" — she should reference news data
7. Git commit: `feat: design system + QA pass + news overhaul + Keisha context + brand logos`
8. Git push to trigger Vercel deploy

---

## ESTIMATED IMPACT
- Cost: $0 (all existing APIs)
- Pages affected: ALL (design system consistency pass)
- New files: DESIGN-SYSTEM.md, public/brand/*.png, src/lib/cache.ts
- Modified: tailwind.config.ts, sidebar, login, news page, risk page, sectors page, keisha system prompt, briefing route
