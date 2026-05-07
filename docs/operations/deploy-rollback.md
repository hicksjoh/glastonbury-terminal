# Deploy & Rollback Playbook

The 90-second checklist for shipping safely + the 60-second escape hatch
when a deploy goes wrong.

## Normal deploy

1. PR is green:
   - GitHub Actions `CI` workflow ✅ (lint, typecheck, vitest, build)
   - GitHub Actions `E2E Tests` workflow ✅ (Playwright vs preview/prod)
   - Vercel preview URL deploys cleanly
2. Merge PR to `main`. Vercel auto-deploys to production.
3. **Post-deploy verify** (run within 2 minutes of deploy completion):
   - `curl -fsS https://terminal.johnwesleyhicks.com/api/healthz` → `{ status: "ok" }`
   - Open the dashboard, confirm the load animation completes (no spinning forever)
   - If a migration was in this PR: confirm it ran (`supabase db diff` or
     a quick `select * from <new_table>` in the dashboard SQL editor)
4. If anything looks off, jump to **Rollback** below.

## Rollback (Vercel UI, fastest)

1. Vercel dashboard → `glastonbury-terminal` → Deployments
2. Find the last known-good deployment (status: ✅ Production)
3. Three-dot menu → "Promote to Production"
4. Wait ~30 seconds for the alias swap
5. Re-run the post-deploy verify from above

This is **always** the right first move if a deploy looks bad. Don't try
to fix forward in a panic — promote the prior deploy, then triage the
broken one calmly.

## Rollback (CLI, if UI is unreachable)

```bash
# List the last 10 prod deployments
vercel ls --prod glastonbury-terminal

# Promote a specific deployment
vercel promote <deployment-url> --scope=<team>
```

You need the Vercel CLI authenticated. The relevant `<deployment-url>` is
the `https://glastonbury-terminal-XXX.vercel.app` for the prior deploy.

## When NOT to rollback

- A migration shipped that adds a column. Rolling back the code without
  rolling back the migration is fine — old code ignores new columns.
- A migration shipped that **drops** a column or table. Rolling back the
  code reintroduces references to a thing that's gone. Restore the migration's
  reverse first (or fix forward).
- An env var was the actual change. Roll back the env var, not the code.

## Migration rollback

Migrations under `supabase/migrations/` are append-only by convention —
never edited in place. To "roll back" a migration:

1. Write a new reverse migration in the same dir, dated after the bad one
2. Apply via `supabase db push` (or paste into the SQL editor for emergency)
3. The bad migration stays in the file system as historical record

**Do not** run `supabase migration repair` or manually delete migration
rows in `supabase_migrations.schema_migrations` — those are emergency
operations only. Document the reason if you have to.

## Verify

After every rollback:

- [ ] `curl /api/healthz` returns 200
- [ ] Dashboard loads in a browser, market data populates
- [ ] At least one cron's last run is recent (Healthchecks dashboard)
- [ ] Sentry error rate has stopped climbing
- [ ] If OAuth was involved: try a fresh Claude.app reconnect

If any of these fails after a rollback, the broken state was already
written somewhere persistent (DB, external service). Jump to
[dr-procedures.md](dr-procedures.md) for those scenarios.

## Pre-deploy checklist (for big changes)

Use this for commits that touch:
- `middleware.ts`
- Anything under `src/lib/oauth/`
- Anything under `src/lib/session.ts`
- Migrations that drop/rename columns
- Cron route schedules
- Environment-variable contracts

The checklist:

- [ ] Has a Playwright test that exercises the change against the live URL
- [ ] Has a corresponding doc update if behavior changed
- [ ] Migration is idempotent (uses `IF NOT EXISTS` / `IF EXISTS`)
- [ ] Migration is forward-compatible with the prior code (so rollback works)
- [ ] PR description names the rollback path explicitly
- [ ] If OAuth is involved: tested against `e2e/S3-oauth-mcp.spec.ts`

If any box is unchecked, hold the merge.
