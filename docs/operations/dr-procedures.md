# Disaster Recovery Procedures

**Scope:** rare, high-impact failures where normal incident response isn't enough.
**Target RTO:** 4 hours · **Target RPO:** 1 hour (Supabase point-in-time)

This doc covers four scenarios serious enough to warrant a written playbook
and a periodic drill. None of these have happened — the goal is to know what
to do *before* you need to know.

## Scenario 1 — Vercel project deleted / corrupted

**Likelihood:** very low. **Impact:** site fully down until rebuilt.

1. Source of truth is GitHub: `github.com/hicksjoh/glastonbury-terminal`. The
   working state is whatever is on `main`.
2. Re-create the Vercel project:
   - `vercel link` from the repo root (after `npm i -g vercel`)
   - Connect to the GitHub repo when prompted
   - Set the production domain to `terminal.johnwesleyhicks.com`
3. Re-add every env var from your secure store. The full list is in
   `.env.example`. Vars that must be set or the app fail-closes: `APP_PASSWORD`,
   `SESSION_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `MCP_AUTH_TOKEN`.
4. Re-add the cron schedule (vercel.json declares it; `vercel deploy --prod`
   should pick it up automatically once the file is in source).
5. Re-wire the Vercel Log Drain (Settings → Log Drains) per
   [docs/observability/structured-logging.md](../observability/structured-logging.md).

After redeploy, run the post-deploy checklist in
[deploy-rollback.md §verify](deploy-rollback.md#verify).

## Scenario 2 — Supabase project deleted / data corrupted

**Likelihood:** very low. **Impact:** all auth, briefings, journal, OAuth state lost.

Supabase has automatic daily backups on the Pro tier. Point-in-time recovery (PITR)
is available within the retention window (7 days on Pro, 14 on Team).

**To restore:**

1. Open the Supabase dashboard for the project
2. Database → Backups → choose a recovery point ≥ 5 min before the corruption
3. Click "Restore" — this creates a new project at the recovery point
4. Get the new project's connection string + anon/service-role keys
5. Update Vercel envs to point at the restored project (`NEXT_PUBLIC_SUPABASE_URL`,
   etc.)
6. Redeploy

**If PITR window has elapsed:** restore from the most recent daily backup.
Data loss = (now − last backup time). Up to 24h is the worst case.

**To re-run pending migrations after restore:**

```bash
supabase link --project-ref <new-ref>
supabase db push
```

## Scenario 3 — Single Anthropic API key compromised

**Likelihood:** moderate (key in many envs, screen-shared, etc.).
**Impact:** unbounded billing, poisoned briefings/keisha responses.

1. Anthropic console → Workspaces → API Keys → revoke the compromised key
2. Generate a new key, scoped to the same workspace
3. Vercel envs → update `ANTHROPIC_API_KEY` for Production
4. Trigger a redeploy (env-only changes need a new deploy to propagate to functions)
5. Audit Anthropic usage dashboard for anomalous spend in the compromise window
6. If `MCP_AUTH_TOKEN` was also compromised: rotate it, then revoke every
   `oauth_clients` row that the attacker might have used (POST to
   `/api/oauth/admin/clients` with `action: revoke`)

## Scenario 4 — Source repo / GitHub access lost

**Likelihood:** very low. **Impact:** can't deploy fixes; existing prod keeps running.

1. Multiple people on the project? Check if anyone else has push access.
2. If not, recover GitHub access first (account recovery, support).
3. If repo is gone: each contributor's `git clone` is a complete history.
   Push the most up-to-date local clone to a new remote, point Vercel at it.
4. Vercel keeps the last deploy running — no user-facing downtime during
   repo recovery.

## DR drill (quarterly)

The above procedures stay theoretical until tested. Run this drill once
per quarter (e.g. last Friday of Mar/Jun/Sep/Dec):

1. **Simulate Supabase loss.** In a test project (NOT prod): pick a non-trivial
   table, take a "before" backup, drop it, then restore via PITR. Time it.
   Target: under 30 min from "drop" to "data back."
2. **Simulate Vercel deploy rollback.** Deploy a deliberate bug (e.g. a
   route that 500s). Roll back via the Vercel UI. Verify `/api/healthz` is
   green within 5 min. Document the click path.
3. **Simulate Anthropic key rotation.** Generate a new key, swap it in
   Vercel env, redeploy, verify `/api/keisha/briefing` still works. Time
   the round trip.

Record times in [docs/operations/dr-drill-log.md](dr-drill-log.md) (create
on first drill). The point is to expose surprises (forgotten env vars,
slow click paths, missing access) before a real incident does.
