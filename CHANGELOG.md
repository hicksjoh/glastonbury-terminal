# Changelog

All notable changes to Glastonbury Terminal go here. Newest first.

## P0 Hardening — 2026-04-29

Closes the six P0 ship-blockers from the Codex second-opinion audit
(`CODEX-SECOND-OPINION.md`). Six atomic commits on
`hardening/p0-codex-fixes`.

### Fixed
- **P0-1 — FMP `/stable` migration** ([b38f85c]). `src/lib/api-client.ts`
  used to point FMP at `/api`, so `/v3/*` and `/v4/*` paths returned 403
  "Legacy Endpoint" on the post-Aug-2025 plan and silently fell back to
  `[]`. Scanner, Macro, Earnings, Insider, GEX, and the agent flows
  rendered empty fallbacks as if they were live.
  - Added typed `/stable` wrappers in `src/lib/fmp-client.ts` for
    movers, screener, earnings, dividends, treasury, economic
    calendar, insider, senate/house trades.
  - `apiFetch('fmp', '/v3...' | '/v4...')` now **throws** so any
    regression surfaces in Sentry instead of becoming a "page is
    empty" mystery.
  - 19 vitest cases assert every wrapper hits `/stable/<expected>`.

- **P0-2 — `/macro` contract mismatch** ([bfd8b66]). `/api/macro`
  emitted `regime.name` and `fedPrediction.action`, but `src/app/macro/page.tsx`
  read `regime.regime` and `fedPrediction.prediction` — the page rendered
  "UNDEFINED" and Fed Watch crashed. Added `src/types/macro.ts` as the
  single source of truth and updated both sides.
  - New Playwright e2e: `e2e/macro.spec.ts` (`@smoke`).

- **P0-3 — `/api/health` lockdown** ([72e6ba7]). `/api/health` was
  middleware-public and leaked env validity, rate-limit state,
  circuit-breaker state, and a ring buffer of upstream API errors —
  full backend fingerprinting.
  - New `/api/healthz` returns only `{ status, timestamp }` and is the
    new public probe.
  - `/api/health` requires the session cookie; `recentApiCalls` removed
    from the response entirely.
  - `src/lib/api-client.ts` now redacts upstream error bodies in the
    in-memory log buffer (defense-in-depth).
  - New e2e: `e2e/healthz-gate.spec.ts` (`@smoke`).

- **P0-4 — Order-route validation** ([fa366f4]). All three order routes
  (`/api/alpaca/orders`, `/api/options/order`, `/api/options/order/multi-leg`)
  parsed untrusted JSON manually; `parseInt` on bad input produced NaN,
  symbols weren't sanitized, and Alpaca rejection bodies leaked verbatim.
  - New `src/lib/order-schemas.ts` with strict zod: equity/option/multi-leg.
  - New `src/lib/api-error.ts` with `publicError` and `captureAndPublic`
    helpers — Sentry gets the real error, the browser gets a stable
    code + eventId.
  - 32 vitest cases covering NaN qty, lowercase symbols, `.strict()`
    extras, OCC validation, and multi-leg bounds.

- **P0-5 — `/api/push/subscribe` hardening** ([ec4c803]). Public
  unauthenticated write to a service-role-backed Supabase table.
  - Removed from `PUBLIC_API_ROUTES`; in-handler `verifySessionJwt`
    re-check (belt + suspenders).
  - Zod-validated payload — endpoint must be HTTPS and hostname must
    match a real push provider (Google FCM, Apple, Microsoft, Mozilla);
    keys must be base64-ish; `.strict()` rejects extras.
  - Durable rate limit: 5 subscribes / hour per session.

- **P0-6 — Durable rate limiting** ([7201561]). The in-memory limiter
  was per-serverless-instance — N warm Vercel workers gave attackers
  Nx the declared cap.
  - Keisha (route, stream, slash, voice, actions) now durable + session-keyed.
  - `auth/login` is durable, two-bucket: per-IP 5 / 5 min PLUS a global
    cap 60 / 5 min that absorbs distributed credential stuffing.
  - Migrated remaining Anthropic-burning routes (agent-crew, narrative,
    coach, hedge/rsu, briefing, sentiment/analyze, trade-replay,
    earnings live chat, tax-harvest scan) and embedding-burning routes
    (semantic search, both backfills).

### Added
- `npm run test` — runs the vitest suite (was missing).
- `src/types/macro.ts` — canonical /api/macro contract.
- `src/lib/fmp-client.ts` — extensive `/stable` wrappers (P0-1).
- `src/lib/order-schemas.ts` — zod schemas for every order shape.
- `src/lib/api-error.ts` — `publicError` / `captureAndPublic` helpers.
- `src/app/api/healthz/route.ts` — public minimal liveness probe.
- `e2e/macro.spec.ts`, `e2e/healthz-gate.spec.ts` — `@smoke` Playwright tests.

### Tests
- 215 vitest cases passing (added: 64 new cases — fmp-client, order-schemas, push-subscribe-schema, rate-limit-durable).

[b38f85c]: https://github.com/hicksjoh/glastonbury-terminal/commit/b38f85c
[bfd8b66]: https://github.com/hicksjoh/glastonbury-terminal/commit/bfd8b66
[72e6ba7]: https://github.com/hicksjoh/glastonbury-terminal/commit/72e6ba7
[fa366f4]: https://github.com/hicksjoh/glastonbury-terminal/commit/fa366f4
[ec4c803]: https://github.com/hicksjoh/glastonbury-terminal/commit/ec4c803
[7201561]: https://github.com/hicksjoh/glastonbury-terminal/commit/7201561
