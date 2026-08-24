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
| `/api/cron/tax-harvest` | `0 0 * * 1` | 8:00 PM Sun | `cron-tax-harvest` | ✅ p1-4 (per-week) | Tax harvest scan · INSERT suggestions · Resend email |
| `/api/cron/coach-review` | `0 1 * * 1` | 9:00 PM Sun | `cron-coach-review` | ✅ p1-4 (per-week) | Anthropic Opus call · INSERT review · Resend email |
| `/api/cron/weekly-report` | `0 23 * * 0` | 7:00 PM Sun | `weekly-report` | ✅ p1-4 | INSERT snapshot · Resend email |
| `/api/cron/slo-roundup` | `0 21 * * 5` | 5:00 PM Fri | `slo-roundup` | ✅ p1-4 (per-week) | Aggregate SLO counters · Resend email |
| `/api/cron/migration-drift-check` | `0 13 * * 1` | 9:00 AM Mon | `migration-drift-check` | ✅ p1-4 (per-week) | Canary-check schema · Resend alert if drift |

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
- **Tax harvest + coach review on Sun PM**: weekly cadence. The intent was
  that these run *before* the weekly report so its email picks up fresh
  suggestions — but as scheduled they do not. See "Known scheduling gaps".
- **Weekly report at Sun 7:00 PM ET**: end-of-week summary lands while
  Wes is most likely to read it.

## Known scheduling gaps

Open items from the 2026-08 digest QA pass. Both need a decision, not just
a patch, so they are recorded here rather than silently changed.

### 1. The Sunday chain runs in the wrong order

| Job | UTC | ET (EDT) |
|-----|-----|----------|
| `weekly-report` | Sun 23:00 | **Sun 7:00 PM** |
| `tax-harvest` | Mon 00:00 | **Sun 8:00 PM** |
| `coach-review` | Mon 01:00 | **Sun 9:00 PM** |

`0 0 * * 1` and `0 1 * * 1` read as "Monday" but land on Sunday evening ET,
one and two hours *after* the report they are supposed to feed. So the
weekly report has always summarised last week's harvest suggestions.

Fix is to move the two feeders ahead of the report, e.g. `0 21 * * 0`
(5 PM ET Sun) for tax-harvest and `0 22 * * 0` (6 PM ET Sun) for
coach-review. **This is not a pure schedule change**: both engines derive
their `week_of` key from the server's UTC weekday
(`tax-harvest-engine.ts:weekOfISO`, `coach-engine.ts:persistCoachReview`),
so moving the fire from UTC-Monday to UTC-Sunday shifts `week_of` back by
seven days and orphans the existing rows the `/tax/harvest/weekly` and
`/journal/coach` pages read. Anchor both helpers to ET *first*, then move
the schedules.

### 2. Every schedule drifts an hour with DST

Vercel cron has no timezone support, so the UTC expressions here are fixed
while ET is not. From the first Sunday in November to the second Sunday in
March, everything fires an hour earlier than the ET column says: the
morning push at 5:30 AM, the market-open briefing at 8:30 AM (an hour
*before* the open it is meant to accompany), the EOD snapshot at 5:00 PM.

`node scripts/qa-digests.mjs` prints the current and post-transition ET
time for every job. There is no fix inside Vercel cron — the options are to
accept the drift, or to have each handler no-op when it fires at the wrong
ET hour and add a second UTC schedule for the other half of the year.

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

Two further rules, both learned the hard way in the 2026-08 QA pass:

1. **Vercel cron dispatches GET.** A route whose work lives only in POST is
   registered, listed in the Vercel dashboard, and never runs. If GET also
   serves a human read path, gate the cron branch with
   `cronIsAuthorized(req, { allowSessionCookie: false })` — otherwise an
   ordinary logged-in browser request is indistinguishable from a cron.
2. **Await every fan-out.** Vercel can freeze the function instance the
   moment the response is returned, so an unawaited
   `sendResendEmail(...).catch(() => {})` delivers non-deterministically.
   Await it, check `.ok`, and ping Healthchecks `fail` when it isn't.

`src/lib/__tests__/cron-contract-qa.test.ts` enforces all of the above
statically against `vercel.json`, so a new cron that breaks one of these
fails CI rather than going quiet in production.

## Verifying that digests actually fire

```bash
node scripts/qa-digests.mjs            # static audit + next fire times (UTC and ET)
node scripts/qa-digests.mjs --probe    # live: every cron answers 401 to a bad token
CRON_SECRET=... node scripts/qa-digests.mjs --dry-run   # compose digests, send nothing
```

Evidence of past runs lives in two tables:

```sql
-- Did each weekly job claim and complete its slot?
SELECT job_name, run_key, claimed_at, completed_at, result
FROM cron_runs ORDER BY claimed_at DESC LIMIT 20;

-- Did the email actually leave? ('failed' / 'rejected_*' rows are the
-- interesting ones — those are digests that were composed but not delivered.)
SELECT sent_at, to_addr, subject, outcome, error
FROM email_send_log ORDER BY sent_at DESC LIMIT 20;
```

A `cron_runs` row with `completed_at IS NULL` is a run that started and then
threw or failed to send. A missing row entirely means the cron never fired —
check Vercel → Cron Jobs, then `CRON_SECRET`.

## Removing or rescheduling a cron

1. Edit `vercel.json` (the source of truth for schedules)
2. Update this manifest
3. In Healthchecks UI: pause or delete the corresponding check
4. If removed: the route handler can stay if it's still useful for manual
   POSTs (e.g. via `curl ... -H "Authorization: Bearer $CRON_SECRET"`)
