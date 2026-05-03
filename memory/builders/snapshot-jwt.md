# snapshot-jwt — JWT auth on /api/portfolio/snapshot GET

## Status
verified — ready for commit

## Bug
`src/app/api/portfolio/snapshot/route.ts` GET handler was checking only that the
`gt-auth` cookie was *present*, not whether its JWT was valid. The route is in
middleware's `PUBLIC_API_ROUTES` allowlist (so cron POSTs auth'd by `CRON_SECRET`
can reach it), so middleware never authenticates GET traffic either. Net effect:
`Cookie: gt-auth=anything` returned the user's full net-worth + equity history.

## Files touched
- **NEW** `e2e/S2-snapshot-auth.spec.ts` — 3 Playwright cases (no cookie / forged cookie / valid JWT) hitting `/api/portfolio/snapshot` GET via the `request` fixture, mirroring the S1 login pattern.
- **PATCHED** `src/app/api/portfolio/snapshot/route.ts` — imports `verifySessionJwt` and `SESSION_COOKIE_NAME` from `@/lib/session`; GET handler now verifies the JWT signature instead of just checking presence; misleading comment ("cookie present = passed middleware on page load") replaced with an accurate one explaining why we self-verify.
- **NEW** this checkpoint file.

POST handler untouched — its `CRON_SECRET` Bearer auth is correct for cron callers.
`src/middleware.ts` (now project-root `middleware.ts`) untouched per orchestrator policy.
`src/lib/session.ts` untouched.

## Test cases — before vs after fix

| Case | Before fix | After fix |
|------|-----------|-----------|
| 1. No cookie | 401 PASS | 401 PASS |
| 2. Forged `gt-auth=garbage-not-a-jwt` | **500 FAIL** (expected 401 — handler reached Supabase, auth bypassed) | **401 PASS** |
| 3. Valid JWT from /api/auth/login | non-401 PASS | non-401 PASS |

Case 3 asserts non-401 (auth gate passed) and validates `{success, snapshots[]}` body shape if status is 200. It tolerates a downstream 5xx because the dev/prod Supabase has a stale `portfolio_snapshots` schema (route selects `equity` and `net_worth` columns that don't exist in the deployed schema) — that's an unrelated bug, not what S2 is gating.

## Verifier verdict: PASS
- `npm run lint` — clean (only pre-existing `keisha/page.tsx` warnings, unrelated)
- `npm run build` — Compiled successfully · 138/138 static pages generated · middleware emitted
- `npx playwright test S2-snapshot-auth --reporter=list` against fixed local dev (port 3010) — **3/3 pass** in 2.3s
- Pre-fix run on same spec — case 2 fails with 500, exactly demonstrating the bug

## Worktree branch
`worktree-agent-ada8b753b036e6cd1`

## Refs
- Codex QA review 2026-04-28 surfaced this finding
- Companion to S1 (JWT sessions); same `verifySessionJwt()` API
