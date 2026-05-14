# Cron Idempotency — Round 3 (Codex + Gemini P0)

## Status
Shipped 2026-05-13 on `worktree-agent-abc303c8effeb6c6b`.

## Problem
Round-3 review (Codex GPT-5 + Gemini 2.5) flagged four cron routes as
P0 production-blockers: a Vercel retry (network blip, function cold-
start timeout, manual rerun) would double-fire side effects.

- `src/app/api/cron/tax-harvest/route.ts` — double-insert
  `tax_harvest_suggestions` + double-send Resend email.
- `src/app/api/cron/coach-review/route.ts` — double-call Anthropic (LLM
  spend $$) + double-send Resend email.
- `src/app/api/cron/prediction-snapshot/route.ts` — double-insert
  `prediction_market_snapshots` rows, corrupting `delta_24h` for the
  next run.
- `src/app/api/cron/storm-watch/route.ts` — re-insert alert candidates
  and (once notification fan-out is wired) re-notify Wes.

## Pattern
Copy of the already-shipped `weekly-report` route:

```ts
import { tryClaimCronRun, markCronRunComplete, todayKeyET } from '@/lib/cron-idempotency';

const JOB_NAME = 'cron-<route>';

// after auth ...
const runKey = todayKeyET();   // or thisWeekKeyET() for the weekly route
const claimed = await tryClaimCronRun(JOB_NAME, runKey, { onRpcError: 'closed' });
if (!claimed) {
  return NextResponse.json({ ok: true, skipped: 'already_ran', runKey });
}

await pingHealthcheck(HC_SLUG, 'start');
try {
  // ...work...
  await pingHealthcheck(HC_SLUG, 'success');
  await markCronRunComplete(JOB_NAME, runKey, { /* result summary */ });
  return NextResponse.json({ /* result */ });
} catch (err) {
  // Don't markComplete on failure — stale-window reclaim covers retries.
  await pingHealthcheck(HC_SLUG, 'fail');
  return NextResponse.json({ error: '...', sentry_event_id: eventId }, { status: 500 });
}
```

## Key choices
- `onRpcError: 'closed'` — fail-safe default. If the Supabase RPC errors
  (DB down, migration not applied), the cron skips this run rather than
  duplicating Resend sends / Anthropic spend / DB rows. p6-9 precedent.
- Job-name namespacing: `cron-tax-harvest`, `cron-coach-review`,
  `cron-prediction-snapshot`, `cron-storm-watch`. Matches existing
  HC_SLUG values used by Healthchecks.io.
- Run-key cadence per route:
  - `tax-harvest`: daily — `todayKeyET()`
  - `coach-review`: weekly — `thisWeekKeyET()` (matches the
    "weekly review" cron cadence)
  - `prediction-snapshot`: daily — `todayKeyET()`
  - `storm-watch`: daily — `todayKeyET()` (NHC feed updates every 6h;
    one alert-candidate insert per ET day is the right grain)
- Claim BEFORE healthcheck-start ping. Skipped-because-already-ran
  shouldn't fire a `start` ping that would later be unmatched.
- Mock-mode (`?mock=miami`) in storm-watch skips the claim so QA
  invocations don't burn the slot for the day's real cron.

## Tests
`src/app/api/cron/__tests__/idempotency.test.ts` — 12 tests, all green.
Mocks `@/lib/cron-idempotency` to assert:
- First call (claim=true) → engine + persist + email fire, then
  `markCronRunComplete()` is called.
- Second call (claim=false) → returns 200 with `skipped: 'already_ran'`,
  NO engine, NO email, NO completion mark.
- Claim is invoked with `onRpcError: 'closed'`.

## Validation
- `npm run lint` — clean (2 pre-existing warnings in `keisha/page.tsx`,
  unchanged here).
- `npx tsc --noEmit` — clean.
- `npx vitest run` — 18 files, 227 tests, all pass.
- `npm run build` — compiles successfully, 140/140 pages prerender.
  The only failure (`/api/congress`) is pre-existing on `main` — a
  missing `NEXT_PUBLIC_SUPABASE_URL` env var at static-prerender time,
  unrelated to this change.

## Files touched
- `src/app/api/cron/tax-harvest/route.ts`
- `src/app/api/cron/coach-review/route.ts`
- `src/app/api/cron/prediction-snapshot/route.ts`
- `src/app/api/cron/storm-watch/route.ts`
- `src/app/api/cron/__tests__/idempotency.test.ts` (new)
- `memory/builders/cron-idempotency-round3.md` (this file)

Untouched (per scope):
- `src/lib/cron-idempotency.ts` (utility was already adequate)
- `src/lib/cron-auth.ts` (no changes needed)
- `src/app/api/cron/weekly-report/route.ts`
- `src/app/api/cron/migration-drift-check/route.ts`
- `src/app/api/cron/slo-roundup/route.ts`
