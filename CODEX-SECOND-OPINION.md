# Glastonbury Terminal — Second-Opinion Review (Codex)

_Generated 2026-04-28 via Codex MCP. Read-only repo walk._

## TL;DR
- The biggest production issue is inconsistent FMP migration: `src/lib/fmp-client.ts` uses `/stable`, but `src/lib/api-client.ts` still routes FMP to legacy `/api/v3`/`/api/v4`, so Scanner, Macro, Earnings, Insider, GEX, and agent paths degrade or silently fall back.
- `/macro` is currently broken by an API/UI contract mismatch: the route returns `regime.name` and `fedPrediction.action`, while the page reads `regime.regime` and `fedPrediction.prediction`.
- Public diagnostics are too rich: `/api/health` is middleware-public and returns environment validity, rate limits, circuit state, and recent API error logs.
- The app has good raw ambition, but production polish is uneven: many routes accept unvalidated JSON, leak upstream error text, use service-role Supabase everywhere, and ship mock/synthetic data as normal UX.
- UI is visually coherent but not yet systematized: duplicated ticker bars, inline styles everywhere, inconsistent cards, weak mobile grids, and heavy chart libraries loaded across client pages.

## P0 — Ship blockers (security / broken in prod)

### 1. FMP is only half-migrated to `/stable`
**What:** The central API client still uses `https://financialmodelingprep.com/api`, and many routes call `/v3`/`/v4` endpoints that the repo itself says now return 403 "Legacy Endpoint".
**Where:** `src/lib/api-client.ts:16`, `src/app/api/scanner/route.ts:45`, `src/app/api/scanner/route.ts:150`, `src/app/api/macro/route.ts:70`, `src/app/api/macro/route.ts:78`, `src/app/api/earnings/route.ts:48`, `src/app/api/insider/route.ts:53`, `src/app/api/gex/route.ts:212`
**Why it matters:** Whole product areas can look alive while serving empty fallback arrays or default indicators. The "FMP error state" is real: `/stable` was added, but old code paths remain.
**Fix:** Rip FMP out of generic `apiFetchWithFallback` until every endpoint is explicitly mapped. Make `apiFetch('fmp', '/v3...')` throw in development/test. Move quote, historical, sector, earnings calendar, insider, congressional, and stock screener access behind `src/lib/fmp-client.ts`, with per-endpoint stable mappings and typed "unavailable on current plan" responses.

### 2. Macro page crashes or renders invalid data
**What:** `/api/macro` returns `regime.name`, but the client reads `data.regime.regime`. It also returns `fedPrediction.action`, while the client interface expects `prediction`.
**Where:** API returns `name` at `src/app/api/macro/route.ts:215`; page reads `data.regime.regime` at `src/app/macro/page.tsx:144` and `src/app/macro/page.tsx:203`; page type expects `prediction` at `src/app/macro/page.tsx:32`
**Why it matters:** This is a direct runtime bug in a top-level Quant Lab route.
**Fix:** Pick one contract. Prefer route shape `{ regime: { regime, confidence, score, factorBreakdown }, fedPrediction: { prediction, confidence, impliedRate } }`, update route, and add a Playwright assertion that `/macro` shows the regime badge without throwing.

### 3. Public `/api/health` leaks operational internals
**What:** Middleware marks `/api/health` public, and the route returns environment validity, warning strings, provider rate-limit state, circuit state, and recent API logs.
**Where:** Public allowlist at `middleware.ts:10`; response includes `rateLimits`, `circuits`, `recentApiCalls`, and `environment` at `src/app/api/health/route.ts:122` to `src/app/api/health/route.ts:141`
**Why it matters:** Anyone can fingerprint your configured providers, outage state, and error patterns. `recentApiCalls` can include upstream error text from `src/lib/api-client.ts:218` to `src/lib/api-client.ts:223`.
**Fix:** Split into `/api/healthz` public with only `{status,timestamp}` and `/api/health` authenticated for the dashboard. Remove recent logs from public responses entirely.

### 4. Trading/order APIs need hard schema validation before production
**What:** Order routes manually parse untrusted JSON and allow invalid numeric payloads through to Alpaca. Options order symbols are not sanitized, quantities can parse to `NaN`, and upstream rejection bodies are returned to the browser.
**Where:** `src/app/api/options/order/route.ts:16` to `src/app/api/options/order/route.ts:49`, upstream leak at `src/app/api/options/order/route.ts:72` to `src/app/api/options/order/route.ts:76`; multi-leg equivalent at `src/app/api/options/order/multi-leg/route.ts:16` to `src/app/api/options/order/multi-leg/route.ts:49`; stock order loose body at `src/app/api/alpaca/orders/route.ts:25` to `src/app/api/alpaca/orders/route.ts:39`
**Why it matters:** Paper lock is good, but malformed orders and upstream error disclosure are still production risks.
**Fix:** Add zod schemas for every order route: uppercase OCC/equity symbol, positive integer qty, allowed `time_in_force`, required `limit_price` for limit orders, bounded legs, and no unknown keys. Return generic rejection messages with a server-side Sentry event ID.

### 5. Public push subscription endpoint can be abused
**What:** `/api/push/subscribe` is middleware-public and writes arbitrary push endpoints with the Supabase service role.
**Where:** Public allowlist at `middleware.ts:19`; service-role write at `src/app/api/push/subscribe/route.ts:4` to `src/app/api/push/subscribe/route.ts:24`
**Why it matters:** A public unauthenticated write path can fill the DB and potentially poison notification delivery.
**Fix:** Remove `/api/push/subscribe` from `PUBLIC_API_ROUTES`; the browser can send the session cookie. Add zod validation, durable rate limiting by IP/session, and endpoint hostname sanity checks.

### 6. In-memory rate limiting is not production-grade for costly paths
**What:** Most routes use module-level `rateLimit`, which is per serverless instance. Durable rate limiting exists but is not broadly applied.
**Where:** In-memory limiter at `src/lib/rate-limit.ts:1` to `src/lib/rate-limit.ts:30`; durable helper at `src/lib/rate-limit-durable.ts:32`; Keisha uses in-memory at `src/app/api/keisha/route.ts:77`; stream uses in-memory at `src/app/api/keisha/stream/route.ts:128`; login uses global in-memory key at `src/app/api/auth/login/route.ts:18`
**Why it matters:** AI routes, login, and research can be brute-forced or cost-amplified across Vercel instances.
**Fix:** Replace high-cost route limits with `checkRateLimitDurable(endpoint, sessionOrIp, limit, window)`. Key login by IP plus a global cap. Do not use a single global `login` bucket.

## P1 — High-value wins (within a week)

### 1. Build a real market-data adapter for VIX and indices
**What:** VIX is not actually Finnhub-backed on the dashboard. The dashboard reads VIX from `/api/market-ticker`, which only uses FMP; Macro has a separate legacy FMP VIX path.
**Where:** Dashboard reads ticker VIX at `src/app/page.tsx:291`; ticker route fetches `^VIX` from FMP at `src/app/api/market-ticker/route.ts:15` to `src/app/api/market-ticker/route.ts:39`; macro legacy VIX at `src/app/api/macro/route.ts:76` to `src/app/api/macro/route.ts:80`; Finnhub missing path returns empty at `src/app/api/news/finnhub/route.ts:19`
**Why it matters:** "Finnhub not configured" is not the real VIX root cause. The app has multiple disconnected VIX fetchers.
**Fix:** Create `src/lib/market-data/quotes.ts` with `getIndexQuote('VIX')`: FMP stable first, Finnhub second if configured, static unavailable state last. Use it in ticker, macro, regime, trade guard, and briefing.

### 2. Remove duplicate global ticker rendering
**What:** `MarketTickerBar` is rendered in both root layout and every `AppShell`.
**Where:** `src/app/layout.tsx:49` to `src/app/layout.tsx:50`; `src/components/layout/AppShell.tsx:11` and `src/components/layout/AppShell.tsx:66`
**Why it matters:** Most pages get two ticker bars and duplicate `/api/market-ticker` polling.
**Fix:** Keep it in one place. Prefer `AppShell` only, and remove it from root layout, or move `AppShell` to root and stop wrapping each page manually.

### 3. Stop shipping mocks as success states
**What:** Alerts return fake alerts and even fake successful creates if the table is missing.
**Where:** `src/app/api/alerts/route.ts:12` to `src/app/api/alerts/route.ts:19`, fake create at `src/app/api/alerts/route.ts:40` to `src/app/api/alerts/route.ts:44`, mock data at `src/app/api/alerts/route.ts:70` to `src/app/api/alerts/route.ts:110`
**Why it matters:** Wes can think alerts exist when nothing is persisted.
**Fix:** Return `503` with `_meta.live=false` when storage is unavailable. Move demos behind `NEXT_PUBLIC_DEMO_MODE`.

### 4. Synthetic GEX should be labeled as synthetic everywhere
**What:** GEX generates synthetic options-chain/open-interest data when live data is absent.
**Where:** Synthetic chain generation at `src/app/api/gex/route.ts:181` to `src/app/api/gex/route.ts:200`; fallback source starts at `src/app/api/gex/route.ts:232`
**Why it matters:** GEX levels are decision-sensitive. Fake gamma walls must never look live.
**Fix:** Return `{ source: 'synthetic', live: false, tradable: false }`; UI should watermark it and disable "trade off this" affordances.

### 5. IV Rank is estimated but presented like a metric
**What:** IV 52-week high/low and percentile are guessed from current IV and HV.
**Where:** `src/app/api/options/iv/[symbol]/route.ts:27` to `src/app/api/options/iv/[symbol]/route.ts:41`
**Why it matters:** IV rank/percentile are core options signals; fake percentile is worse than blank.
**Fix:** Store daily IV snapshots in Supabase and compute real rank/percentile, or label current output "estimated IV/HV spread" instead of IV rank.

### 6. API error responses leak too much
**What:** Many API routes return raw error messages or upstream text.
**Where:** Examples: `src/app/api/macro/route.ts:249` to `src/app/api/macro/route.ts:255`, `src/app/api/portfolio/snapshot/route.ts:150` to `src/app/api/portfolio/snapshot/route.ts:151`, `src/app/api/autopilot/route.ts:279` to `src/app/api/autopilot/route.ts:282`, `src/app/api/alpaca/orders/route.ts:88` to `src/app/api/alpaca/orders/route.ts:90`
**Why it matters:** Internal table names, provider responses, and account/API state can leak to the client.
**Fix:** Add `src/lib/api-error.ts` with `publicError()` and `captureException()`. Return stable codes like `UPSTREAM_UNAVAILABLE`, `VALIDATION_ERROR`, `ORDER_REJECTED`.

### 7. Supabase service role is overused
**What:** Most app API routes use `createServiceClient()`, bypassing RLS.
**Where:** Service client helper at `src/lib/supabase.ts:16` to `src/lib/supabase.ts:20`; widespread usage shown by routes like `src/app/api/wealth/route.ts:7`, `src/app/api/journal/route.ts:6`, `src/app/api/alerts/route.ts:6`
**Why it matters:** Middleware is the only meaningful user boundary. A route bug becomes full-table access.
**Fix:** For single-user private app, this can be acceptable, but make it explicit: create narrow repository functions per table, validate every input, and never expose raw Supabase errors. If multi-user is possible later, switch read/write routes to anon client plus real Supabase auth.

### 8. Autopilot executes from loose body state
**What:** Autopilot accepts `{ action: 'execute', symbol, shares, side }` without zod, position budget checks, or confirmation token binding to a prior scan.
**Where:** `src/app/api/autopilot/route.ts:226` to `src/app/api/autopilot/route.ts:281`; action switch at `src/app/api/autopilot/route.ts:392` to `src/app/api/autopilot/route.ts:414`
**Why it matters:** Even in paper mode, this is the highest-blast-radius workflow.
**Fix:** Require a server-created `pipelineId` and candidate ID from the latest scan, validate requested shares against the candidate, and store approval state in Supabase instead of `lastPipelineRun` memory.

## P2 — Polish & nice-to-have

### 1. Replace inline styles with terminal design primitives
**What:** The app has Tailwind tokens, but major pages use hardcoded inline colors, spacing, and card styles.
**Where:** Tokens at `tailwind.config.ts:12` to `tailwind.config.ts:22`; global vars at `src/app/globals.css:5` to `src/app/globals.css:15`; dashboard local `GlassCard` at `src/app/page.tsx:35` to `src/app/page.tsx:63`; Macro inline grid/cards at `src/app/macro/page.tsx:240` to `src/app/macro/page.tsx:303`
**Why it matters:** The UI is coherent by repetition, not by a real system.
**Fix:** Add `TerminalCard`, `MetricTile`, `DataTable`, `StatusPill`, `TerminalButton`, and `SourceBadge` components; ban new inline color strings except chart primitives.

### 2. Mobile grids need explicit responsive layouts
**What:** Several pages use fixed `repeat(4, 1fr)` or large negative margins that will squeeze badly on mobile.
**Where:** Macro grid at `src/app/macro/page.tsx:240`; dashboard page shell margin at `src/app/page.tsx:407` to `src/app/page.tsx:416`; stock chart fixed height at `src/app/stock/[symbol]/page.tsx:87` to `src/app/stock/[symbol]/page.tsx:89`
**Why it matters:** The terminal can work on mobile, but the current layout is desktop-first with overflow risks.
**Fix:** Use CSS grid classes or container styles with `minmax(160px,1fr)` and route-level mobile screenshots in Playwright.

### 3. Accessibility on custom interactive divs is weak
**What:** Clickable `div`s are used for cards/lists without roles or keyboard handlers.
**Where:** Dashboard `GlassCard` click handling at `src/app/page.tsx:36` to `src/app/page.tsx:45`; position rows at `src/app/page.tsx:653` to `src/app/page.tsx:680`; command results are divs at `src/components/CommandBar.tsx:257` to `src/components/CommandBar.tsx:270`
**Why it matters:** Keyboard navigation and screen readers are second-class.
**Fix:** Use `<button>` or `<Link>` for actionable rows/cards. Add `role="listbox"`/`role="option"` to command palette and `aria-selected`.

### 4. Focus styling is duplicated
**What:** `*:focus-visible` is defined twice with different colors.
**Where:** `src/app/globals.css:64` to `src/app/globals.css:68` and again at `src/app/globals.css:168` to `src/app/globals.css:172`
**Why it matters:** Small, but it signals CSS drift.
**Fix:** Keep one focus rule using a CSS variable like `--focus-ring`.

### 5. Charting stack is fragmented
**What:** The app ships `recharts` and `lightweight-charts`, plus hand-rolled SVG sparklines.
**Where:** Dependencies at `package.json:25` and `package.json:31`; Recharts imports in `src/app/trading/page.tsx:4`, `src/app/tax/page.tsx:26`, `src/components/options/PayoffDiagram.tsx:4`; lightweight chart dynamic imports at `src/components/PortfolioChart.tsx:39` and `src/app/stock/[symbol]/page.tsx:83`
**Why it matters:** Bundle size and visual consistency suffer.
**Fix:** Use `lightweight-charts` for market/time-series, Recharts only for categorical tax/allocation charts, and dynamically import all Recharts widgets.

### 6. Most route pages are client components
**What:** Almost every app page is `'use client'`, so data fetching, loading, and error states are pushed into browser code.
**Where:** 72 client page declarations found under `src/app/**/page.tsx`; examples include `src/app/page.tsx:1`, `src/app/macro/page.tsx:1`, `src/app/trading/page.tsx:1`
**Why it matters:** You lose App Router strengths: server rendering, route-level caching, Suspense, smaller client bundles.
**Fix:** Convert shell pages to server components and isolate interactive panels as client components. Start with `/macro`, `/wealth`, `/strategies`, `/journal`.

### 7. Sentry lacks route-level scrubbing
**What:** `sendDefaultPii: false` is good, but there is no `beforeSend` scrubber for portfolio prompts, symbols, order payloads, or Anthropic context.
**Where:** Server Sentry config at `sentry.server.config.ts:12` to `sentry.server.config.ts:29`; client config at `sentry.client.config.ts:10` to `sentry.client.config.ts:26`
**Why it matters:** This app handles net worth, trades, AI prompts, and personal context.
**Fix:** Add `beforeSend` and `beforeBreadcrumb` to redact `authorization`, `x-api-key`, cookies, account IDs, order bodies, prompt text, and Supabase errors.

## Top-tier feature ideas

1. **Real command palette actions:** Extend `src/components/CommandBar.tsx` so commands can place "open ticket", "set alert", "run scan", "ask Keisha about current page", not just navigate.
2. **Unified quote stream:** Replace ticker/watchlist polling with `/api/prices/stream` plus `src/contexts/PriceContext.tsx`; use price-flash cells across dashboard, watchlist, stock pages, and order tickets.
3. **Saved terminal layouts:** Add a `layouts` Supabase table and let Wes save dashboard panel arrangements; slot into `AppShell` and dashboard card grid.
4. **Data-source truth badges everywhere:** Standardize `DataSourceBadge` so every tile says `Live`, `Cached`, `Fallback`, `Synthetic`, or `Unavailable`; wire from `_meta` on API responses.
5. **Screener presets as first-class objects:** Store scanner/screener presets in Supabase instead of hardcoded route switches; slot into `src/app/api/scanner/route.ts` and `/screener`.
6. **Order preview ledger:** Before any trade, show projected cash, concentration, PDT, wash sale, tax impact, and max loss in one confirmation panel; build on `src/lib/order-guards` and `src/app/api/tax/impact/route.ts`.
7. **Bloomberg-style keyboard map:** Add hotkeys for `W` watchlist, `T` trade ticket, `K` Keisha, `G` chart, `A` alert, `Esc` close panel; centralize in `src/hooks/useKeyboardShortcuts.ts`.
8. **Provider status console:** Turn `/settings` env/health into an authenticated provider console with last success, last failure, quota remaining, and endpoint plan limitations.
9. **Real IV history service:** Nightly cron stores IV snapshots per watchlist/options symbols; `/api/options/iv/[symbol]` becomes real IV rank, not an estimate.
10. **Research memo source packs:** Research pages should persist citations, raw filings/news snippets, and freshness scores; slot into `src/lib/research-agent.ts` and `src/app/research/[id]/page.tsx`.

## Honest take
This is not production-grade yet in the "trust it with real money and private wealth data" sense. It is a strong personal terminal prototype with some serious hardening already done, but the gap to top tier is consistency: one market-data layer, one API validation/error strategy, one design system, and no silent mock/synthetic data in decision workflows.
