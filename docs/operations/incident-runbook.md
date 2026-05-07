# Incident Runbook

**Owner:** Wes Hicks · **Live URL:** https://terminal.johnwesleyhicks.com/

This is the one-page cold-start guide for "something is on fire." Read it
top-to-bottom when you don't know what's wrong yet — the decision tree is
ordered most-likely → least-likely.

## Severity ladder

| Sev | Trigger | Response time |
|-----|---------|--------------:|
| **SEV-1** | Site fully down (502 from `/`); login broken; Alpaca order endpoint 5xx-ing; **outstanding access token can't auth at /api/mcp** (revocation broken) | Drop everything |
| **SEV-2** | Cron silently missing fires (Healthchecks alert); briefing email sent twice (idempotency broke); Sentry error rate > 1%/min for any single route | Within 1 hour |
| **SEV-3** | Single route 500-ing; FMP/Anthropic upstream degraded; one Sentry issue spiking | Same day |
| **SEV-4** | Cosmetic / non-blocking | Next normal work session |

## Decision tree (cold-start)

**Step 1 — Is the site up?**

```
curl -fsS https://terminal.johnwesleyhicks.com/api/healthz
```

- 200 + `{ status: "ok" }` → site is up; jump to Step 3
- 4xx/5xx or timeout → site is down; jump to Step 2

**Step 2 — Site is down. Who's broken: Vercel, Supabase, or DNS?**

| Check | URL | Expected |
|-------|-----|----------|
| Vercel platform | https://www.vercel-status.com/ | "All systems operational" |
| Supabase platform | https://status.supabase.com/ | "All systems operational" |
| DNS | `dig terminal.johnwesleyhicks.com` | Returns Vercel CNAME |

- **Vercel red** → wait. Don't redeploy mid-incident. Subscribe to Vercel updates; communicate ETA via email.
- **Supabase red** → app degrades (auth + briefing + journal break) but `/api/healthz` should still return 200. If it doesn't, check what called Supabase on the healthz path (shouldn't be anything).
- **Both green + healthz still down** → Vercel function-level outage. Roll back the last deploy: see [deploy-rollback.md](deploy-rollback.md).

**Step 3 — Site is up. What's the actual symptom?**

| Symptom | Likely cause | Jump to |
|---------|--------------|---------|
| Login fails for me | `APP_PASSWORD` rotated; `SESSION_SECRET` rotated; durable rate limit hit | §A |
| `/api/mcp` 401 with valid token | `revoked_at` set on client; `MCP_AUTH_TOKEN` rotated; client deleted | §B |
| Cron didn't fire (HC alert) | Vercel cron paused; CRON_SECRET rotated; idempotency lock stuck | §C |
| Push notifications doubled | Idempotency table missing (migration not applied) | §D |
| One route 5xx-spiking | Upstream provider down; recently shipped bug | §E |
| Briefing email never arrived | Resend down; recipient bounced; weekly report fired but didn't send | §F |
| OAuth flow broken (Claude.app reconnect) | `OAUTH_REGISTRATION_TOKEN` rotated; consent_transactions migration not applied | §G |

---

## §A. Login broken

1. Confirm the password: hit `/api/auth/login` from a fresh shell:
   ```bash
   curl -i -X POST https://terminal.johnwesleyhicks.com/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"password":"<the-password>"}'
   ```
   - 401 → password mismatch. Check Vercel envs `APP_PASSWORD`.
   - 429 → durable rate limit triggered. Wait 5 minutes OR clear it (Supabase: `DELETE FROM rate_limit_buckets WHERE bucket_name LIKE 'login%'`).
   - 500 → `APP_PASSWORD` env unset. Set it in Vercel and redeploy (no code change needed — env var changes propagate on the next deploy).

2. If the password worked but no session cookie was set: `SESSION_SECRET` is missing or <32 chars. Check Vercel env. Min 32 chars, random.

## §B. `/api/mcp` 401 with valid token

1. Did you (or someone) hit `/api/oauth/admin/clients` with `action: revoke`? Check the row:
   ```sql
   SELECT client_id, revoked_at, last_used_at FROM oauth_clients ORDER BY created_at DESC LIMIT 10;
   ```
   - `revoked_at` non-null → un-revoke via admin API.

2. Did `MCP_AUTH_TOKEN` rotate? Static-bearer clients (e.g. Claude Code CLI's `claude mcp add`) need the new value.

3. Did the `oauth_clients` row get deleted? Re-register through Claude.app's connector flow.

## §C. Cron didn't fire (Healthchecks alert)

1. Check Vercel → Project → Cron Jobs. Is the job still listed? If not, redeploy with `vercel.json` intact.
2. Check Vercel function logs for that route at the expected fire time. Filter on `route` from structured logs.
3. If "unauthorized cron call" appears: `CRON_SECRET` is misconfigured between Vercel cron config and the route's expected secret.
4. If the run logged `{ outcome: "skipped_idempotent", run_key: "..." }`: the cron_runs row for that day is stuck. Check:
   ```sql
   SELECT * FROM cron_runs WHERE job_name = 'X' AND run_key = 'YYYY-MM-DD';
   ```
   - `claimed_at` recent + `completed_at` null → in-flight or crashed mid-run. Wait 10 min for stale-window reclaim, OR delete the row to force retry.
   - `claimed_at` old + `completed_at` set → it ran already. Check the success value.

## §D. Push / email duplication

Cron fired twice — confirm with `cron_runs`:
```sql
SELECT * FROM cron_runs WHERE job_name = 'briefing-morning-push' ORDER BY claimed_at DESC LIMIT 5;
```
- Two rows for the same `run_key` → migration `20260506_cron_run_idempotency.sql` not applied. Apply it.
- One row but the cron RPC failed → check `try_claim_cron_run` exists in Supabase; re-apply migration.

## §E. Single route 5xx-spiking

1. Open Sentry, filter by `route` tag. Top issue tells you the failure mode.
2. Cross-check structured logs — the Sentry issue body has `request_id`. Search Logtail/drain for that ID to see the surrounding lifecycle.
3. If the upstream is the culprit (FMP / Anthropic / Alpaca / Resend), the `fmp-client.ts`-style wrappers should already be returning `null` rather than throwing. Spike means the wrapper isn't being used — find the offending route.
4. If recently deployed: check `git log` for the route. Roll back if needed.

## §F. Briefing email missing

1. Did the cron run? Check Healthchecks dashboard for `weekly-report`.
2. Did Resend reject? Sentry should have it. Check `cron_runs.result.sent_id` — if null, send failed.
3. Did Resend deliver? Resend dashboard → Sent log → search `keisha@terminal.johnwesleyhicks.com` from address.
4. Inbox issue? Check spam folder. Consider warming up the `keisha@` from-address by sending a test.

## §G. OAuth flow broken

1. Was `OAUTH_REGISTRATION_TOKEN` rotated? Claude.app needs to re-register the connector.
2. Was `20260506_oauth_consent_transactions.sql` applied? Without it, `/api/oauth/finalize` fails because the RPC is missing.
3. Was `20260506_oauth_client_lifecycle.sql` applied? Without it, the `revoked_at` column is missing and `findClient` may error.

## When to call Anthropic / Vercel / Supabase support

- Anthropic: `/api/keisha/*` 5xx-spiking AND Anthropic status page green AND your tokens are valid → support@anthropic.com with the Sentry event ID.
- Vercel: function logs missing for a route AND the route is deployed AND status page green → vercel-support, attach project ID + recent deploy hash.
- Supabase: query latency > 1s consistently AND status page green → support, attach project ref + sample query.

## After the fire

1. Fill out [docs/operations/postmortem-template.md](postmortem-template.md) within 24h.
2. Add a regression test if possible (Playwright spec or Vitest unit).
3. If the alert was missed: tighten the SLO threshold ([docs/observability/slos.md](../observability/slos.md)) or the alert config.
