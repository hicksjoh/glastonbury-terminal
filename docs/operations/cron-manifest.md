# Cron Manifest

The single source of truth for what runs when, where it pings, and what
to alert on. Cross-reference for [vercel.json](../../vercel.json) and the
Healthchecks.io dashboard.

All schedules in **UTC** (Vercel cron does not support timezones). The ET
column is the equivalent local time during DST (subtract 1h for EST winter).

## Active cron jobs

| Route | UTC Schedule | ET (DST) | Healthchecks slug | Idempotent? | Side effects |
|-------|--------------|----------|-------------------|:----------:|--------------|
| `/api/briefing/morning-push` | `30 10 * * 1-5` | 6:30 AM weekday | `briefing-morning-push` | ✅ p1-4 | Web push to all subscribed devices |
| `/api/briefing/scheduled` | `30 13 * * 1-5` | 9:30 AM weekday | `briefing-scheduled` | ✅ p1-4 | Anthropic Opus call · INSERT briefing · web push |
| `/api/portfolio/snapshot` | `0 22 * * 1-5` | 6:00 PM weekday | `portfolio-snapshot` | ✅ upsert by date | UPSERT portfolio_snapshots row |
| `/api/cron/storm-watch` | `0 12 * * *` | 8:00 AM daily | `cron-storm-watch` | upsert by storm_id | NHC fetch · INSERT alert candidates |
| `/api/cron/prediction-snapshot` | `0 13 * * *` | 9:00 AM daily | `cron-prediction-snapshot` | upsert by ticker+date | Kalshi + Polymarket fetch · INSERT snapshots |
| `/api/cron/tax-harvest` | `0 0 * * 1` | 8:00 PM Sun | `cron-tax-harvest` | unique index per week | Tax harvest scan · INSERT suggestions · Resend email |
| `/api/cron/coach-review` | `0 1 * * 1` | 9:00 PM Sun | `cron-coach-review` | unique per weekOf | Anthropic Opus call · INSERT review · Resend email |
| `/api/cron/weekly-report` | `0 23 * * 0` | 7:00 PM Sun | `weekly-report` | ✅ p1-4 | INSERT snapshot · Resend email |
| `/api/cron/slo-roundup` | `0 21 * * 5` | 5:00 PM Fri | `slo-roundup` | ✅ p1-4 (per-week) | Aggregate SLO counters · Resend email |
| `/api/cron/migration-drift-check` | `0 13 * * 1` | 9:00 AM Mon | `migration-drift-check` | ✅ p1-4 (per-week) | Canary-check schema · Resend alert if drift |

## In-app dead-man check (the one that is actually armed)

**Healthchecks pings are currently inactive in production**: `HEALTHCHECKS_PING_KEY`
is not set in Vercel, and `src/lib/healthchecks.ts` is fail-open, so every
`pingHealthcheck()` call is a silent no-op. That is how the daily portfolio
snapshot cron went months without writing a row and nobody was told. Until the
key is set, the check below is the only thing watching the crons.

- **Logic**: `src/lib/cron-freshness.ts` (pure, unit-tested). `CRON_REGISTRY`
  maps each cron in `vercel.json` to a name, a grace period and an evidence
  source. The allowed age is derived from the schedule itself: the longest gap
  between two firings (24h daily, 72h for weekday-only jobs so weekends are
  tolerated, 168h weekly) plus grace (3h daily, 24h weekly, +24h for
  date-granularity evidence).
- **Route**: `GET /api/ops/cron-freshness` (session auth via middleware) returns
  `{ ok, checkedAt, crons: [{ path, name, schedule, status, lastEvidenceAt, maxAgeHours }] }`.
  `ok` is true only when every cron is `fresh`.
- **Statuses**: `fresh` · `overdue` · `never_ran` · `unverifiable`.
  `unverifiable` is the fail-closed bucket: a cron in `vercel.json` with no
  registry entry, a schedule that cannot be parsed, or evidence that could not
  be read. Nothing unknown is ever reported fresh.
- **Asserted nightly** by `e2e/truth-invariants.spec.ts` (`@smoke @truth`), run
  every day at 11:00 UTC by `.github/workflows/nightly-smoke.yml`.
- **Visible to humans** on `/settings` → "Scheduled jobs".

| Cron | Evidence |
|------|----------|
| `/api/briefing/morning-push` | `cron_runs.completed_at`, job `briefing-morning-push` |
| `/api/briefing/scheduled` | `cron_runs.completed_at`, job `briefing-scheduled` |
| `/api/cron/prediction-snapshot` `30 13 * * 1-5` | marker: `cron_runs`, job `narrative-refresh@30 13 * * 1-5` |
| `/api/cron/prediction-snapshot` `0 18 * * 1-5` | marker: `cron_runs`, job `narrative-refresh@0 18 * * 1-5` |
| `/api/cron/prediction-snapshot` `0 13 * * *` | marker: `cron_runs`, job `cron-prediction-snapshot` |
| `/api/cron/weekly-report` | `cron_runs.completed_at`, job `weekly-report` |
| `/api/portfolio/snapshot` | `portfolio_snapshots.date` |
| `/api/cron/storm-watch` | marker: `cron_runs`, job `cron-storm-watch` |
| `/api/cron/tax-harvest` | marker: `cron_runs`, job `cron-tax-harvest` |
| `/api/cron/coach-review` | `coach_reviews.created_at` |
| `/api/cron/slo-roundup` | `cron_runs.completed_at`, job `slo-roundup` |
| `/api/cron/migration-drift-check` | `cron_runs.completed_at`, job `migration-drift-check` |

"Marker" jobs can legitimately write nothing on a quiet run (no storm, no
harvestable loss, empty feed), so on success they call `recordCronRan()` from
`src/lib/cron-idempotency.ts`, which stamps a completed row in the existing
`cron_runs` table. No new table or migration.

Notes:

- The narrative schedules write their marker only when Vercel sends the
  `x-vercel-cron-schedule` header and `/api/narrative` did not answer
  `refreshFailed`. A manual `?job=narrative` run leaves no marker.
- `weekly-report` and `slo-roundup` now complete their claim when they skip for
  "no mailer configured". Before, that path left the claim open forever.
- **First deploy**: marker jobs have no evidence until each has run once on the
  new code, so the dead-man test reports `never_ran` for them until then (worst
  case the following Monday, for the weekly jobs). To clear it sooner, trigger
  each cron once with `curl -H "Authorization: Bearer $CRON_SECRET"`.
- **Adding a cron**: add it to `CRON_REGISTRY` in the same PR. A unit test fails
  CI if `vercel.json` and the registry disagree, and the route reports the new
  cron as `unverifiable` until it is registered.

## Healthchecks.io setup (one-time)

The lib at `src/lib/healthchecks.ts` is fail-open: if `HEALTHCHECKS_PING_KEY`
isn't set, it silently no-ops. To activate:

1. Sign in to https://healthchecks.io and create a project named **Glastonbury Terminal**
2. Copy the project's ping key
3. Vercel → `glastonbury-terminal` → Settings → Environment Variables → add `HEALTHCHECKS_PING_KEY` (Production + Preview)
4. Redeploy. The first run of each cron creates its check (`?create=1` is in the URL)
5. For each check, set in Healthchecks UI:

   | Slug | Period | Grace | Notify |
   |------|--------|-------|--------|
   | `briefing-morning-push` | 1 day | 30 min | Email + SMS |
   | `briefing-scheduled` | 1 day | 1 hour | Email |
   | `portfolio-snapshot` | 1 day | 30 min | Email |
   | `cron-storm-watch` | 1 day | 1 hour | Email |
   | `cron-prediction-snapshot` | 1 day | 1 hour | Email |
   | `cron-tax-harvest` | 7 days | 4 hours | Email |
   | `cron-coach-review` | 7 days | 4 hours | Email |
   | `weekly-report` | 7 days | 4 hours | Email |
   | `slo-roundup` | 7 days | 4 hours | Email |
   | `migration-drift-check` | 7 days | 4 hours | Email |

## Why these specific schedules

- **Morning push at 6:30 ET**: before market open (9:30 ET) and Wes's first
  inbox check, so the snapshot is the first thing he sees on the phone.
- **Scheduled briefing at 9:30 ET**: market open + 0. Captures pre-market
  news and overnight options-flow shifts before Wes is making decisions.
- **Portfolio snapshot at 6:00 PM ET**: after market close (4:00 PM ET) +
  buffer for Alpaca to settle the day's fills. Snapshot reflects EOD state.
- **Storm watch at 8:00 AM ET**: NHC publishes overnight advisories at
  ~5 AM EDT; 8 AM gives time for any updates to land.
- **Prediction snapshot at 9:00 AM ET**: pre-market read on macro/political
  prediction markets. Slight overlap with briefing on purpose.
- **Tax harvest + coach review on Sun PM**: weekly cadence, run before
  the weekly report (Sun 7 PM) so its email picks up fresh suggestions.
- **Weekly report at Sun 7:00 PM ET**: end-of-week summary lands while
  Wes is most likely to read it.

## Idempotency notes

The "Idempotent?" column refers to whether re-running the cron with the
same logical run-key produces the same end state. ✅ p1-4 means it uses
the `cron_runs` table from `20260506_cron_run_idempotency.sql`.

Routes marked "upsert by X" use a different idempotency mechanism (unique
constraint on (X, date)) but achieve the same effect — duplicate fires
don't double-send.

When adding a new cron, the rule is: if it has fan-out side effects
(email, push, network mutation), it MUST be idempotent. The
`tryClaimCronRun(jobName, runKey)` + `markCronRunComplete()` pattern in
`src/lib/cron-idempotency.ts` is the boilerplate.

## Removing or rescheduling a cron

1. Edit `vercel.json` (the source of truth for schedules)
2. Update this manifest
3. Update `CRON_REGISTRY` in `src/lib/cron-freshness.ts` (CI fails if it and
   `vercel.json` disagree)
4. In Healthchecks UI: pause or delete the corresponding check
5. If removed: the route handler can stay if it's still useful for manual
   POSTs (e.g. via `curl ... -H "Authorization: Bearer $CRON_SECRET"`)
