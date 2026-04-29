# cron-auth-hardening — Codex round-2 follow-up on the four newly-public cron routes

## Status
shipped — single commit on `worktree-agent-ac2dd75d9e60c2f10`, branched off
`fix/codex-qa-criticals` tip (`34b2514`).

## Why this matters
Earlier today, four cron paths were added to `middleware.ts`'s
`PUBLIC_API_ROUTES` allowlist so that Vercel cron's bare `Bearer ${CRON_SECRET}`
request stops being 401'd by the JWT-cookie middleware before the route ever
runs. That move shifts ALL responsibility for authenticating those routes to
the route files themselves. Codex's round-2 review caught three live regressions
in those route files:

1. **Cookie-presence-only auth** — `tax-harvest`, `coach-review`, and
   `prediction-snapshot` accepted a request as authenticated as long as a
   `gt-auth` cookie existed at all. `Cookie: gt-auth=garbage` passed.
2. **Fail-open on missing CRON_SECRET** — every route's auth block was wrapped
   in `if (cronSecret) { …check… }`, so an empty/unset env silently dropped the
   check.
3. **storm-watch `?mock=miami` bypass** — the route's own `if (!ok && !mock)`
   short-circuited auth entirely; anyone hitting `/api/cron/storm-watch?mock=miami`
   ran the cron's mock branch.

## Per-route before / after

### `/api/cron/tax-harvest` (handle, ~L21)
- **Before:** `if (cronSecret) { … !ok && !hasCookieAuth && !(internalKey === expected) }`
  with `hasCookieAuth = !!req.cookies.get('gt-auth')`. Cookie presence alone
  passed; missing CRON_SECRET = no auth.
- **After:** Single `await cronIsAuthorized(req, { routeName, allowInternalKey: true })`
  call. Cookie path uses `verifySessionJwt(value)`. Missing CRON_SECRET = always
  false.

### `/api/cron/coach-review` (handle, ~L18)
- **Before:** Identical shape to tax-harvest with cookie-presence check.
- **After:** `cronIsAuthorized(req, { routeName, allowInternalKey: true })` —
  same shared helper, JWT-verified cookie, fail-closed on missing secret.

### `/api/cron/prediction-snapshot` (handle, ~L17)
- **Before:** `if (!ok && !hasCookieAuth) return 401` inside the
  `if (cronSecret)` wrapper. No `x-internal-key` path here.
- **After:** `cronIsAuthorized(req, { routeName })` (no `allowInternalKey`).
  Cookie verified as JWT; fail-closed on missing secret.

### `/api/cron/storm-watch` (handle, ~L27)
- **Before:** `if (!ok && !mock) 401` — a `?mock=miami` query string
  short-circuited auth entirely, regardless of whether CRON_SECRET was set.
- **After:** `cronIsAuthorized(req, { routeName })` runs unconditionally.
  Then the handler decides whether to inject the synthetic Miami storm via
  `allowMock = mockParam === 'miami' && process.env.NODE_ENV !== 'production'`.

## Decision: storm-watch ?mock=miami — KEPT, gated to non-production AND auth
The `?mock=miami` query is genuinely useful for QAing storm-impact alert
plumbing without waiting for an actual Atlantic hurricane (the only way to
exercise the full `evaluateStorms → persistAlertCandidates` path otherwise).
The fix:

1. Auth runs first, no exceptions. Public unauth `?mock=miami` returns 401.
2. Mock injection itself is gated to `NODE_ENV !== 'production'`. Even an
   authenticated request in prod cron always pulls live NHC data.
3. `mock: !!mock` in the response was renamed to `mock: allowMock` so the
   payload reflects what actually happened (a request with `?mock=miami`
   in production now reports `mock: false` because mock was suppressed).

## Files shipped
- `src/lib/cron-auth.ts` — new shared helper `cronIsAuthorized(req, opts)`.
  Centralizes the bearer / x-api-key / x-internal-key / JWT-cookie matrix
  and the fail-closed-on-missing-secret invariant.
- `src/app/api/cron/tax-harvest/route.ts` — uses helper with `allowInternalKey: true`.
- `src/app/api/cron/coach-review/route.ts` — uses helper with `allowInternalKey: true`.
- `src/app/api/cron/prediction-snapshot/route.ts` — uses helper, no internal key.
- `src/app/api/cron/storm-watch/route.ts` — uses helper, mock injection gated.
- `src/lib/__tests__/cron-route-auth.test.ts` — 31 vitest cases.
- `e2e/S2-cron-route-auth.spec.ts` — 13 Playwright probes against live host.

## Test cases written

### Vitest (`src/lib/__tests__/cron-route-auth.test.ts`) — 31 tests
For each of the four routes:
- returns false for ALL inputs when CRON_SECRET unset
- returns false for ALL inputs when CRON_SECRET empty string
- returns true with correct Bearer
- returns true with correct x-api-key
- returns false with wrong Bearer
- returns false for forged `gt-auth=garbage` cookie

Plus:
- storm-watch `?mock=miami` query never bypasses auth
- x-internal-key requires INTERNAL_API_KEY env (rejected when unset/empty,
  accepted when matching, ignored on routes without `allowInternalKey`)
- gt-auth cookie path: real signed JWT accepted, tampered JWT rejected

### Playwright (`e2e/S2-cron-route-auth.spec.ts`) — 13 cases
For each of the four cron routes:
- no auth → 401
- Bearer with wrong secret → 401

For tax-harvest / coach-review / prediction-snapshot:
- forged `gt-auth=garbage` cookie → 401 (this was the pre-fix bug)

For storm-watch:
- `?mock=miami` with no auth → 401 (this was the pre-fix bug)

When `E2E_CRON_SECRET` is provided:
- Bearer + correct secret → not 401 (route may still 5xx in CI; that's fine)

## Why a shared helper instead of inlining `isAuthorized` in each route
Initial draft put `export async function isAuthorized` in each route file
and tested via direct import. Next.js 14 rejects that — a Route file may
only export `GET`/`POST`/`HEAD`/etc. plus the `runtime`/`dynamic`/`maxDuration`
config exports. Build failure: `"isAuthorized" is not a valid Route export
field`. Switching to a shared helper in `src/lib/cron-auth.ts` is also better
hygiene: identical auth logic across four routes, single place to reason
about fail-closed behavior, less drift surface.

## Build / lint / test status
- `npx vitest run` — **128/128 pass** (was 124 baseline + 31 new − 27 = 128;
  matches; existing session-secret + healthchecks suites still green).
- `npm run lint` — clean (only pre-existing keisha warnings, unrelated).
- `npx tsc --noEmit` — clean.
- `npm run build` — `✓ Compiled successfully` and full type-check pass.
  Static-export step still fails on `/api/congress` prerender due to
  `supabaseUrl is required` — IDENTICAL behavior to baseline before my
  changes (verified by stash + rebuild + diff of error lines = empty).
  This is a pre-existing build-time env issue, not introduced here.

## Things I noticed but did NOT fix (out of scope)
- Cron routes have **no rate-limit wrapper**. Per the project's
  non-negotiable rule #6 ("every API route needs rate-limit + auth"), they
  should be wrapped in `@/lib/rate-limit`. None of them are. Storm-watch's
  Vercel cron schedule is bounded (5 min cadence) but a manual run via
  Bearer can be hit as fast as the attacker's loop wants. Worth a follow-up.
- `isAuthorized` does not constant-time-compare the secret (`===` on
  strings). Low risk on a fail-closed token of high entropy, but could
  still be a `timingSafeEqual` for symmetry with `share/tokens.ts`.
- `INTERNAL_API_KEY` length / entropy is not validated. If it's set to
  `"x"` somewhere, it'll be accepted.

## Branch
`worktree-agent-ac2dd75d9e60c2f10` (built off `34b2514` on `fix/codex-qa-criticals`).
NOT pushed.
