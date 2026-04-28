# Primitives inventory — DO NOT REBUILD

This is the inventory of existing reusable infrastructure. Every new
feature in the 18-feature DAG should **check this doc first** before
creating a new component, API wrapper, or hook. Most of what the
original P1 scope called for already exists.

Last audited: 2026-04-20 (during P1 Wave 0).

## Network + data layer (src/lib/)

| Module | Purpose | Notes |
|--------|---------|-------|
| `api-client.ts` | The One Fetch to rule them all. Rate-limited, circuit-broken, cached, retried, logged, `_meta`-tagged wrapper over 20+ external APIs. | Use `apiFetch<T>(api, endpoint, params, opts)` or `apiFetchWithFallback<T>(...)`. |
| `api-meta.ts` | `ApiMeta` shape (source/live/latency/cache markers) returned alongside every `apiFetch`. | |
| `circuit-breaker.ts` | Per-provider CLOSED→OPEN→HALF_OPEN state machine. | Auto-used by `api-client`. |
| `rate-limiter.ts` | Per-provider token buckets with configurable refill rates. | Auto-used by `api-client`. Also exposes `getAllRateLimitStats`. |
| `server-cache.ts` | In-memory TTL cache with `getCached/setCache/TTL` helpers. | Used by `api-client` + individual routes. |
| `rate-limit.ts` (the shorter one) | Lightweight per-key rate limiter for auth endpoints. | `rateLimit(key, limit, windowMs)`. |
| `healthchecks.ts` | **NEW (S3)** Deadman-ping wrapper for cron routes. | `pingHealthcheck(slug, 'start'\|'success'\|'fail')`. |
| `fmp-client.ts` | **NEW (D1)** Typed `/stable` FMP client (sector-performance-snapshot, getQuote, getQuotes). | `/api/v3/*` is DEAD on the current FMP tier. Any new FMP call MUST go through this module. |

## Claude (src/lib/)

| Module | Purpose | Notes |
|--------|---------|-------|
| `claude.ts` | `anthropic` client, `CLAUDE_MODEL_{PRIMARY,FALLBACK,FAST}`, `createMessageWithFallback`, `streamMessageWithFallback`. | Primary → Fallback auto-retry on 429/529/503. |
| `prompts/` | **NEW (P1)** Cache-aware prompt library. | `cachedSystem(staticText, dynamicText?)` returns the `system` field shape for `anthropic.messages.create()` with `cache_control: ephemeral` on the static block. |
| `keisha-tools.ts` | Tool definitions for Keisha's agentic loop (lookup_price, place_order, etc.). | |
| `keisha-context.ts` | Builds the "live data" context block for Keisha. | |
| `research-agent.ts` | Deep research agent orchestration. | Uses Opus 4.7. |

## UI components (src/components/)

**Layout + shell:**
- `PageShell.tsx` — standard page wrapper
- `PageHeader.tsx` — consistent page header with title + subtitle
- `layout/AppShell.tsx`, `layout/Sidebar.tsx`, `layout/SidebarTooltip.tsx`, `layout/TradingModeBanner.tsx`
- `CommandBar.tsx` — **⌘K command palette, already mounted in `src/app/layout.tsx:48`.** Feature F15 = effectively done, just needs nav additions as new pages ship.
- `MarketTickerBar.tsx` — **top-bar ticker strip component exists but is NOT YET mounted in layout.** Feature F16 = mount it (5 min of work).
- `NotificationBell.tsx`, `ShortcutsHelp.tsx`

**State + feedback:**
- `EmptyState.tsx`, `LoadingState.tsx`, `Skeleton.tsx`
- `ErrorBoundary.tsx`
- `Toast.tsx`

**Data display:**
- `StatCard.tsx` — KPI card (label + big number + accent color + optional icon + onClick). Use this instead of building a new "big number" block.
- `SparklineChart.tsx` — mini price sparkline
- `PortfolioChart.tsx` — full portfolio chart with Recharts
- `StrategyBenchmarkChart.tsx` — strategy vs SPY benchmark
- `DataSourceBadge.tsx` — "live / cached / stale" indicator pin
- `RegimeBadge.tsx` — market regime label pill
- `TradeGuard.tsx` — trade risk visualization
- `MarkdownRenderer.tsx` — markdown output (Keisha responses, briefings)

**Dashboard widgets:** `dashboard/MarketNarrative.tsx`, `dashboard/MorningBriefing.tsx`

**Domain folders** (per-feature composition): `journal/`, `keisha/`, `macro/`, `options/`, `tax/`, `territories/`, `trade/`, `trading/`

## Hooks (src/hooks/)

| Hook | Purpose |
|------|---------|
| `useAlpacaWebSocket.ts` | Live Alpaca stream connection |
| `useKeyboardShortcuts.ts` | Global ⌘K and other key bindings |
| `usePushSubscription.ts` | Web Push subscription management |
| `useRealtimePrice.ts`, `useSmartPrice.ts` | Price subscription hooks |

## Tests (src/lib/__tests__/ + e2e/)

- Vitest unit tests: `briefing-staleness`, `healthchecks` (S3), `prompts` (P1), `tax-engine`, `tax-lot-optimizer`, `wash-sale-detector`.
- Playwright e2e: `api-routes`, `D1-fmp-sectors` (D1), `dashboard`, `keisha-ai`, `options-*`, `page-loads`, `strategy-builder`. Auth handled by `e2e/global-setup.ts` (shared storageState).
- To run against local dev: `E2E_BASE_URL=http://localhost:3000 npx playwright test`.

## When shipping a new feature

1. **Check this doc.** If a primitive covers what you need, import it — don't rebuild.
2. If you need a NEW primitive, add it here first so the next feature can find it.
3. New API calls → use `apiFetch` from `api-client.ts` (unless it's a FMP `/stable` call, use `fmp-client.ts`).
4. New Claude calls with large static prompts → use `cachedSystem()` from `prompts/`.
5. New cron routes → follow the pattern in `api/cron/prediction-snapshot/route.ts` (CRON_SECRET auth + Healthchecks ping + try/catch).
