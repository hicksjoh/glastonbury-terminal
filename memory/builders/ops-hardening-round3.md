# Ops Hardening — Codex + Gemini Round-3 Review (2026-05-13)

Worktree: `agent-a8870edaa1daf0d77`
Branch: `worktree-agent-a8870edaa1daf0d77`

## Summary

Closed 5 P0/P1 findings from a dual-model adversarial review (Codex + Gemini).

## Findings shipped

### Fix 1 — Boot-time env validation (Gemini P0)
- New `src/lib/env.ts` exporting `validateEnv()`.
- `instrumentation.ts#register()` now imports & calls `validateEnv()` on
  the node runtime so a deploy with missing secrets refuses to come up.
- Required vars (every env): `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `ANTHROPIC_API_KEY`, `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`,
  `FMP_API_KEY`, `APP_PASSWORD`.
- Production-only vars: `SESSION_SECRET`, `CRON_SECRET`,
  `RESEND_ALLOWED_RECIPIENTS`.
- Build phase (`NEXT_PHASE=phase-production-build`) tolerated so `next
  build` can run on a runner with no runtime secrets.
- Tests: `src/lib/__tests__/env-validation.test.ts` — 12 cases.

### Fix 2 — Durable rate-limit migration (Codex P1)
Migrated 7 routes from `@/lib/rate-limit` (in-memory, forks per Vercel
warm instance) to `@/lib/rate-limit-durable` (Supabase RPC, atomic).
Identity = session sub via `getRateLimitIdentity`.

| Route | Old | New |
|---|---|---|
| `src/app/api/alpaca/orders/route.ts` | `rateLimit('orders', 30, 60000)` | `checkRateLimitDurable('alpaca-orders', key, 30, 60)` |
| `src/app/api/options/order/route.ts` | `rateLimit('options-order', 10, 60000)` | `checkRateLimitDurable('options-order', key, 10, 60)` |
| `src/app/api/options/order/multi-leg/route.ts` | `rateLimit('multi-leg-order', 10, 60000)` | `checkRateLimitDurable('options-multi-leg-order', key, 10, 60)` |
| `src/app/api/autopilot/route.ts` | `rateLimit('autopilot', 15, 60000)` | `checkRateLimitDurable('autopilot', key, 15, 60)` |
| `src/app/api/optimize/route.ts` | (none) | `checkRateLimitDurable('optimize', key, 10, 60)` |
| `src/app/api/earnings-tone/route.ts` | (none) | `checkRateLimitDurable('earnings-tone', key, 20, 60)` |
| `src/app/api/earnings/live/session/[id]/end/route.ts` | `rateLimit('earnings-end', 10, 60_000)` | `checkRateLimitDurable('earnings-end', key, 10, 60)` |

- Tripwire test: `src/lib/__tests__/rate-limit-migration-coverage.test.ts`

### Fix 3 — Input validation gaps (Codex P1)
- `src/app/api/earnings-tone/route.ts` — schema in
  `src/app/api/earnings-tone/schema.ts` (separate file because Next 14
  Route Handlers can only export canonical symbols). Strict
  `validateEquitySymbol` symbol, quarter ∈ [1,4], year ∈ [1990,
  current+1].
- `src/app/api/optimize/route.ts` — schema in
  `src/app/api/optimize/schema.ts`. Array bound MAX_SYMBOLS=20,
  riskAversion ∈ [0.1, 10] finite, `.strict()` rejects extras.
- Tests: `src/app/api/earnings-tone/__tests__/validation.test.ts`,
  `src/app/api/optimize/__tests__/validation.test.ts`.

### Fix 4 — OAuth client-id enumeration oracle (Codex P1)
- `src/app/api/oauth/authorize/route.ts` — collapsed the
  unknown/revoked-client and bad-redirect branches into one generic
  `'invalid_client_or_redirect'` response. Real reason still logged
  server-side for ops triage.
- Test: `src/app/api/oauth/authorize/__tests__/enumeration.test.ts`.

### Fix 5 — Silent error swallows (Gemini P0+P1)
- `src/app/api/keisha/actions/route.ts:53` — `catch {}` around
  `getProfile(symbol)` → `catch (err) { log.warn(...) }`.
- `src/app/api/img/route.ts:62` — `try { reader.cancel(); } catch {}` →
  logs the cancel failure via `log.warn`.
- `src/lib/api-error.ts:112` + `:138` — Sentry capture failures now log
  via pino.
- Tripwire test: `src/lib/__tests__/silent-catch-coverage.test.ts`.

## Validation

| Check | Result |
|---|---|
| `npx vitest run` | 23 files, 261 tests, all pass |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (pre-existing warnings only) |
| `npm run build` | compiled successfully (exit 0) |

## Files changed
- Added: `src/lib/env.ts`
- Added: `src/lib/__tests__/env-validation.test.ts`
- Added: `src/lib/__tests__/rate-limit-migration-coverage.test.ts`
- Added: `src/lib/__tests__/silent-catch-coverage.test.ts`
- Added: `src/app/api/earnings-tone/schema.ts`
- Added: `src/app/api/earnings-tone/__tests__/validation.test.ts`
- Added: `src/app/api/optimize/schema.ts`
- Added: `src/app/api/optimize/__tests__/validation.test.ts`
- Added: `src/app/api/oauth/authorize/__tests__/enumeration.test.ts`
- Modified: `instrumentation.ts`
- Modified: `src/lib/api-error.ts`
- Modified: `src/app/api/alpaca/orders/route.ts`
- Modified: `src/app/api/options/order/route.ts`
- Modified: `src/app/api/options/order/multi-leg/route.ts`
- Modified: `src/app/api/autopilot/route.ts`
- Modified: `src/app/api/optimize/route.ts`
- Modified: `src/app/api/earnings-tone/route.ts`
- Modified: `src/app/api/earnings/live/session/[id]/end/route.ts`
- Modified: `src/app/api/oauth/authorize/route.ts`
- Modified: `src/app/api/keisha/actions/route.ts`
- Modified: `src/app/api/img/route.ts`
