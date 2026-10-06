# truth-invariants (branch feat/truth-invariants)

Status: implemented, gates green locally. Not pushed, no PR. Not run against production.

- Lib: `src/lib/cron-freshness.ts` (+ `__tests__/cron-freshness.test.ts`) — registry, schedule-derived max age, fail-closed statuses.
- Route: `GET /api/ops/cron-freshness` (middleware auth, `withRateLimit` READ, force-dynamic).
- Marker helper: `recordCronRan()` in `src/lib/cron-idempotency.ts`; called by storm-watch, tax-harvest, prediction-snapshot (snapshot + both narrative schedules).
- weekly-report / slo-roundup: complete the claim on the "no mailer configured" skip.
- Settings page: "Scheduled jobs" block.
- e2e: `e2e/truth-invariants.spec.ts` (`@smoke @truth`, 11 tests, read-only).
- Guard: `src/lib/__tests__/no-demo-data.test.ts` (AST-based; 4 allowlisted hits).
- Nightly: every day at 11:00 UTC.
- Docs: `docs/operations/cron-manifest.md`.
- No migration added (reuses `cron_runs`).

Open questions / unverified without prod:
- Is `20260506_cron_run_idempotency.sql` applied in prod? If not, every cron_runs-backed job reads `unverifiable`.
- Does Vercel send `x-vercel-cron-schedule`? If not, narrative markers are never written (and narrative crons were already running the wrong job).
- Marker jobs read `never_ran` until their first post-deploy run.
