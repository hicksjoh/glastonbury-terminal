# Claude Code Prompt — Glastonbury Terminal P0 Hardening

_Paste the block below into Claude Code from `~/Projects/glastonbury-terminal/`. The full audit lives in `CODEX-SECOND-OPINION.md`._

---

## Prompt

You are working in `/Users/wesley/Projects/glastonbury-terminal/` (Next.js 14 App Router, TypeScript, Tailwind, Supabase, Alpaca, Vercel-deployed at terminal.johnwesleyhicks.com). A Codex second-opinion review identified **six P0 ship-blockers**. Your job: fix them all on a single feature branch, with tests, and prepare a PR-ready commit.

**Read these first** for full context:
- `CODEX-SECOND-OPINION.md` (the audit)
- `middleware.ts`, `src/lib/api-client.ts`, `src/lib/fmp-client.ts`, `src/lib/rate-limit.ts`, `src/lib/rate-limit-durable.ts`, `src/lib/supabase.ts`

**Branch:** Create and work on `hardening/p0-codex-fixes`. Do NOT touch `main`. Make atomic commits per P0 so they're reviewable.

---

### P0-1 — Finish the FMP `/stable` migration

**Problem:** `src/lib/api-client.ts:16` still points FMP to `https://financialmodelingprep.com/api`, and routes hit legacy `/v3` and `/v4` paths that 403 with "Legacy Endpoint" on the current plan. Scanner, Macro, Earnings, Insider, and GEX silently return empty fallback data.

**Fix:**
1. Audit every FMP call site. Start with: `src/app/api/scanner/route.ts:45`, `:150`; `src/app/api/macro/route.ts:70`, `:78`; `src/app/api/earnings/route.ts:48`; `src/app/api/insider/route.ts:53`; `src/app/api/gex/route.ts:212`. Grep for `financialmodelingprep` and `/api/v3` / `/api/v4` to find the rest.
2. Move every endpoint behind a typed function in `src/lib/fmp-client.ts` that maps to the correct `/stable` path (e.g. `getQuote`, `getHistorical`, `getEarningsCalendar`, `getInsiderTrades`, `getSectorPerformance`, `getStockScreener`, `getCongressionalTrades`).
3. In `src/lib/api-client.ts`, make `apiFetch('fmp', ...)` **throw** (not warn) if the path starts with `/v3` or `/v4`. This stops new regressions cold.
4. For any endpoint that genuinely is not on the current FMP plan, return a typed `{ unavailable: true, reason: 'plan_limit' }` and have the UI handle it (don't fake data).
5. Add a Vitest unit test for `fmp-client.ts` that mocks fetch and asserts each helper hits the correct `/stable/...` URL.

**Acceptance:** `rg -n "/api/v3|/api/v4" src/` returns nothing in app code. `npm run test` passes.

---

### P0-2 — Fix the broken `/macro` contract mismatch

**Problem:** The API returns `regime.name` and `fedPrediction.action`. The page reads `regime.regime` and `fedPrediction.prediction`. The route just throws or renders garbage.

**Fix:**
1. Define one canonical type in `src/types/macro.ts` (or wherever your shared types live):
   ```ts
   export interface MacroRegime {
     regime: string;        // e.g. "Risk-On"
     confidence: number;    // 0..1
     score: number;
     factorBreakdown: Record<string, number>;
   }
   export interface FedPrediction {
     prediction: 'hike' | 'hold' | 'cut';
     confidence: number;
     impliedRate: number;
   }
   ```
2. Update `src/app/api/macro/route.ts:215` (and surrounding shape) to emit those exact field names.
3. Update `src/app/macro/page.tsx:32`, `:144`, `:203` to consume them. Remove the duplicate/legacy field readers.
4. Add a Playwright e2e at `e2e/macro.spec.ts` that loads `/macro`, asserts the regime badge text is non-empty, and that no console errors fire.

**Acceptance:** `npm run test:e2e -- macro.spec.ts` is green. Visiting `/macro` in dev shows real regime + Fed prediction with no React warnings.

---

### P0-3 — Lock down `/api/health` (split into public `healthz` + auth `health`)

**Problem:** `middleware.ts:10` puts `/api/health` in the public allowlist, and `src/app/api/health/route.ts` returns env validity, rate-limit state, circuit state, and recent API error logs to anyone with a browser.

**Fix:**
1. Create `src/app/api/healthz/route.ts` — returns ONLY `{ status: 'ok', timestamp: <iso> }`. No env, no providers, no logs. Add it to `PUBLIC_API_ROUTES` in `middleware.ts`.
2. Keep `/api/health` rich, but **remove it from `PUBLIC_API_ROUTES`** so the session-cookie gate applies. The dashboard already authenticates, so existing usage keeps working.
3. Strip `recentApiCalls` from any response. Sentry already has the data; the browser doesn't need it. Update `src/lib/api-client.ts:218`–`:223` to stop pushing upstream error text into a memory ring buffer that gets exposed.
4. Update Vercel uptime probes (if any) to point at `/api/healthz`.

**Acceptance:** `curl https://terminal.johnwesleyhicks.com/api/health` (without auth cookie) returns 401/redirect. `curl .../api/healthz` returns the minimal OK payload. `rg -n "recentApiCalls" src/` returns nothing in public response paths.

---

### P0-4 — Zod-validate every order route

**Problem:** `src/app/api/options/order/route.ts:16-49`, `src/app/api/options/order/multi-leg/route.ts:16-49`, and `src/app/api/alpaca/orders/route.ts:25-39` parse untrusted JSON manually. Quantities can be `NaN`, OCC/equity symbols aren't sanitized, and Alpaca rejection bodies leak straight to the client at `options/order/route.ts:72-76`.

**Fix:**
1. Create `src/lib/order-schemas.ts` with zod schemas:
   - `equityOrderSchema`: uppercase `[A-Z.]{1,5}` symbol, positive integer qty, `side: 'buy'|'sell'`, `type: 'market'|'limit'|'stop'|'stop_limit'`, conditional `limit_price` / `stop_price`, `time_in_force: 'day'|'gtc'|'ioc'|'fok'`, `.strict()` (no unknown keys).
   - `optionLegSchema`: OCC symbol regex (`^[A-Z]{1,6}\d{6}[CP]\d{8}$`), positive integer ratio_qty, `position_intent`, `side`.
   - `multiLegOrderSchema`: bounded leg count (≤4), all legs validated, total qty cap.
2. Wire them at the top of each order route. On failure return `{ code: 'VALIDATION_ERROR', issues }` with HTTP 400.
3. Create `src/lib/api-error.ts` with `publicError(code, message, status)` and `captureAndPublic(err, code)` that captures to Sentry and returns a generic message + `eventId`. Replace every `return NextResponse.json({ error: e.message })` in order routes with it.
4. Add Vitest unit tests for the schemas covering: NaN qty rejected, lowercase symbol normalized or rejected, unknown extra field rejected, valid happy path.

**Acceptance:** Tests pass. `curl -X POST .../api/alpaca/orders -d '{"symbol":"aapl","qty":"abc","side":"buy"}'` returns 400 `VALIDATION_ERROR`, not an Alpaca passthrough.

---

### P0-5 — Auth and validate `/api/push/subscribe`

**Problem:** `middleware.ts:19` lists `/api/push/subscribe` as public, and `src/app/api/push/subscribe/route.ts:4-24` writes arbitrary subscription rows with the Supabase service role.

**Fix:**
1. Remove `/api/push/subscribe` from `PUBLIC_API_ROUTES` in `middleware.ts`. The browser already has the session cookie when calling this from the app shell.
2. Add a zod schema for the subscription payload: validates VAPID `endpoint` is a URL with hostname in an allowlist (`*.googleapis.com`, `*.mozilla.com`, `*.windows.com`, `*.apple.com`), plus `keys.p256dh` and `keys.auth` as base64.
3. Wrap the route in durable rate limiting keyed by session: `checkRateLimitDurable('push-subscribe', sessionId, 5, 3600)`.
4. Add a Vitest test that asserts a payload with an evil endpoint hostname is rejected.

**Acceptance:** Hitting `/api/push/subscribe` without a session cookie returns 401. With a cookie + bad endpoint returns 400. With cookie + valid payload returns 200 and persists exactly one row.

---

### P0-6 — Move costly routes to durable rate limiting

**Problem:** `src/lib/rate-limit.ts:1-30` is a Map-in-memory limiter scoped to one serverless instance. `src/app/api/keisha/route.ts:77`, `keisha/stream/route.ts:128`, and `auth/login/route.ts:18` all use it. Across Vercel instances, attackers (and accidental loops) just rotate which instance answers.

**Fix:**
1. In `src/lib/rate-limit-durable.ts`, expose `checkRateLimitDurable(endpoint: string, key: string, limit: number, windowSec: number): Promise<{ ok: boolean; retryAfter?: number }>`. Back it with a Supabase table (`rate_limit_buckets`) using a SQL function that does atomic increment + window expiry. Include the migration SQL in `supabase/migrations/`.
2. Replace in-memory calls with durable calls in:
   - `src/app/api/keisha/route.ts:77` — key by `sessionId`, 30 req / 5 min.
   - `src/app/api/keisha/stream/route.ts:128` — key by `sessionId`, 10 streams / 5 min.
   - `src/app/api/auth/login/route.ts:18` — key by `ip` (5 / 5 min) PLUS a global `'login:global'` cap (60 / 5 min) to absorb distributed brute-force.
   - Any other AI / search route hitting Anthropic, FMP heavy endpoints, or research synthesis. Audit with `rg -n "rateLimit\(" src/`.
3. Keep the in-memory limiter for ultra-cheap routes (e.g. health, ticker) as a defense-in-depth layer.
4. Add a Vitest integration test that hammers a mocked durable limiter and asserts the retry-after window is enforced.

**Acceptance:** `rg -n "from '@/lib/rate-limit'" src/app/api/(keisha|auth)` returns nothing — they all import from `rate-limit-durable`. The new Supabase migration file exists and `supabase db diff` is clean.

---

### Wrap-up

After all six P0s are committed:
1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:e2e -- --grep @smoke`. Fix anything red.
2. Update `CHANGELOG.md` (create if missing) with a `## P0 Hardening — <date>` section listing the six fixes.
3. Push `hardening/p0-codex-fixes` and open a PR with body referencing `CODEX-SECOND-OPINION.md`. Title: `Hardening: close 6 P0 issues from Codex audit`.
4. Do **not** merge or deploy. Leave that to Wes.

**Style:** Atomic commits per P0 (`p0-1: complete FMP /stable migration`, etc.). Use conventional commit prefixes. No drive-by refactors — stay in lane. If you spot a P1 while editing, note it in the PR description, don't fix it.

If you hit a blocker (e.g. Supabase migration locally fails), stop, document the blocker in the PR, and ask Wes for direction rather than guessing.
