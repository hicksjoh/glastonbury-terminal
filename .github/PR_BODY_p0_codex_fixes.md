# Hardening: close 6 P0 issues from Codex audit

Closes the six P0 ship-blockers from `CODEX-SECOND-OPINION.md`. Six atomic
commits (one per P0), a CHANGELOG entry, and one chore commit removing
no-op ESLint disables that were blocking `npm run build`.

## Summary

| # | Fix | Key changes |
|---|---|---|
| **P0-1** | FMP `/stable` migration | typed `/stable` wrappers in `src/lib/fmp-client.ts`; `apiFetch('fmp', '/v3...' | '/v4...')` now throws so regressions surface in Sentry; 19 vitest cases. |
| **P0-2** | `/macro` contract mismatch | new `src/types/macro.ts` as single source of truth; route emits `regime.regime` + `fedPrediction.prediction`; new `e2e/macro.spec.ts`. |
| **P0-3** | `/api/health` lockdown | new public `/api/healthz` (status + timestamp only); `/api/health` now session-gated; `recentApiCalls` removed; api-client redacts upstream error bodies in the in-memory log. |
| **P0-4** | Zod-validate order routes | strict zod schemas in `src/lib/order-schemas.ts`; shared `publicError` / `captureAndPublic` helpers in `src/lib/api-error.ts`; Alpaca rejection bodies no longer leak; 32 vitest cases. |
| **P0-5** | `/api/push/subscribe` hardening | session gate (re-checked in handler); zod payload validation including push-provider hostname allowlist; durable rate limit 5/hr per session. |
| **P0-6** | Durable rate limiting | Keisha + login + agent-crew + narrative + coach + hedge/rsu + briefing + sentiment + trade-replay + earnings live chat + tax-harvest + search routes all on `checkRateLimitDurable`. Login now two-bucket: per-IP **plus** global cap. |

## Test plan

- [x] `npm run test` — **215 / 215 passing** across 17 files (added: 64 new cases — fmp-client, order-schemas, push-subscribe-schema, rate-limit-durable)
- [x] `npx tsc --noEmit` — clean
- [x] `npm run lint` — clean (2 pre-existing warnings unrelated to this PR; no errors)
- [x] `npm run build` — **Compiled successfully**
- [ ] `npm run test:e2e -- --grep @smoke` — run against deployed env (new specs: `e2e/macro.spec.ts`, `e2e/healthz-gate.spec.ts`)
- [ ] Smoke check after deploy:
  - `curl https://terminal.johnwesleyhicks.com/api/healthz` → `{ status: 'ok', timestamp: ... }`
  - `curl https://terminal.johnwesleyhicks.com/api/health` (no cookie) → `401`
  - Visit `/macro` while logged in — regime badge + Fed Watch render with no console errors
  - Submit a malformed order via curl — get `{ code: 'VALIDATION_ERROR', issues: [...] }`, **not** an Alpaca passthrough

## Notes

**Polygon `/v3/snapshot/options/...` stays.** This is a real Polygon endpoint,
not FMP. Confirmed at `src/app/api/gex/route.ts:38`.

**Pre-existing ESLint config cleanup** ([6496936](https://github.com/hicksjoh/glastonbury-terminal/commit/6496936)).
Seven `// eslint-disable-next-line @typescript-eslint/no-explicit-any` directives
referenced a rule that wasn't loaded — `.eslintrc.json` only extends
`next/core-web-vitals`, so ESLint hard-errored on every "rule not found"
reference and `npm run build` failed lint. I stripped the no-op disables so
the build is green; the underlying `any` usage is preserved unchanged. If we
ever want real `no-explicit-any` enforcement, that's a separate scoped PR
to install `@typescript-eslint/eslint-plugin` and triage the new errors.

## Out of scope

Codex P1 + P2 findings (mock alerts, synthetic GEX labeling, autopilot
schema, design-token cleanup, etc.). Those will go in follow-up PRs.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
