# Service Level Objectives

The targets that define "the terminal is working." Anything outside these
budgets is the trigger for a SEV-2 in [the runbook](../operations/incident-runbook.md).

## Tier 1 — Critical user journeys (page on burn)

These are the routes Wes uses every day. If any is sustained-out-of-budget,
SEV-2 paging fires.

| Journey | Target | Window | Current | Source of truth |
|---------|--------|--------|---------|-----------------|
| Dashboard loads (200 from `/`) | ≥ 99.5% success | 30 days | unverified | Sentry transactions |
| Login successful (200 from `/api/auth/login` with valid pw) | ≥ 99.9% | 30 days | unverified | Sentry transactions |
| Healthz responds within 200ms | p95 < 200ms | 7 days | unverified | Sentry / Vercel |
| Briefing cron fires + completes | 100% | per scheduled run | tracked via Healthchecks | Healthchecks.io |
| MCP token validation succeeds | ≥ 99.9% | 30 days | unverified | Sentry / structured logs |

## Tier 2 — Money-moving paths

| Journey | Target | Window |
|---------|--------|--------|
| Alpaca order endpoint accepts a valid order | ≥ 99.5% | 7 days |
| Order rejection echoed faithfully (not 5xx) | 100% | always |
| Tax-harvest scan completes | 100% | per Sunday run |
| OAuth code → token exchange succeeds | ≥ 99.5% | 7 days |

## Tier 3 — Read-only data routes (degrade gracefully)

These can return empty/null payloads on upstream failure rather than 5xx.
"Success" here means the route returned a 200 — not that the data was live.

| Journey | Target | Window |
|---------|--------|--------|
| `/api/sectors` returns 200 | 100% | always |
| `/api/wealth` returns 200 | ≥ 99% | 7 days |
| `/api/territories` returns 200 | ≥ 99.5% | 7 days |
| `/api/keisha/briefing` returns 200 | ≥ 95% | 7 days |

## Error budgets

A 99.5% target = 0.5% error budget = ~3.6 hours of allowed downtime per 30 days.

When an error budget is **half-consumed** before the window ends, a SEV-3
ticket is opened. When it's **fully consumed**, a SEV-2 fires AND a deploy
freeze applies until the post-incident review is filed.

## Sentry alert rule blueprints

These are the rules to configure in **Sentry → Alerts → Issue Alerts**.
Sentry's UI requires manual config; this section is the recipe.

### Rule 1 — Critical-route 5xx spike

**When:** error count for a route in any single Sentry transaction tag (`route`)
**Threshold:** ≥ 10 errors in 1 minute
**Filter:** transaction tag `route` IN (`auth/login`, `healthz`, `briefing/scheduled`, `briefing/morning-push`, `oauth/token`, `oauth/finalize`, `mcp`)
**Action:** Email hicksjoh@gmail.com + send Pushover (link to issue)

### Rule 2 — Money-path single error

**When:** ANY error event with route in money-path set
**Threshold:** ≥ 1 event in 5 minutes
**Filter:** transaction tag `route` IN (`alpaca/orders`, `keisha/actions`, `tax/harvest/queue`, `options/order`)
**Action:** Email + Pushover, escalate to SEV-2 if 3 in 1 hour

### Rule 3 — Cron silent failure

**When:** Healthchecks "down" notification arrives
**Threshold:** any cron's check goes red
**Action:** Email + Pushover. Cross-reference with Sentry to see whether the
cron 5xx-ed (visible in Sentry) or didn't fire at all (invisible in Sentry).

### Rule 4 — Anthropic budget burn

**When:** Sentry tag `anthropic_cost_usd` exceeds threshold
**Threshold:** Anthropic spend > $20 in 1 hour OR > $200 in 1 day
**Filter:** any
**Action:** Email + Pushover. Inspect for runaway loop or compromised key.
**Setup note:** requires emitting `anthropic_cost_usd` as a Sentry tag from
`src/lib/claude.ts` — not yet wired (Week 5 candidate).

### Rule 5 — OAuth surface anomaly

**When:** any combination of structured-log signals
**Threshold:** > 5 `token invalid_client` warnings from same IP in 5 min
**Filter:** route `oauth/token`
**Action:** Email + automatic IP block (manual via Cloudflare or
checkRateLimitDurable bucket adjust).
**Setup note:** requires Logtail-side query alert, not Sentry. The
structured logger (p2-5+) emits the right fields; configure the alert in
the Logtail (or chosen drain) UI against the `route="oauth/token"` +
`reason` filter.

## How to verify SLOs are being met

Every Friday afternoon, run this check:

1. **Sentry** → Performance → filter by transaction `route` tag.
   - Sort by failure rate. Anything in Tier 1 with > 0.5% failure rate
     warrants investigation.
2. **Healthchecks.io** → review the cron status grid.
   - Anything with a missed period in the last 7 days is a finding.
3. **Vercel** → Logs → filter by status >= 500.
   - Aggregate by route. Anything with sustained > 5/hour 5xx rate is an
     SLO violation in progress.
4. **Logtail** (or chosen log drain) → query for `level="error"` AND
   `app="glastonbury-terminal"` over the past week. Group by `route`.

The check is meant to be 5 minutes of work. Codify it once it stabilizes
into a `/api/cron/slo-roundup` route that posts the summary to Slack/email.

## Reviewing this doc

This doc is a living target. Adjust thresholds when:
- The current measured rate is far from the target (revise target up or
  down to be realistic — aspirational SLOs that are always violated stop
  meaning anything)
- A new tier-1 journey ships (add a row)
- The user base grows beyond a single operator (every threshold tightens)
