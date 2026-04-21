# Glastonbury Terminal — Build Rules

Private Bloomberg-style wealth + trading terminal for The Glastonbury Group.
Live: https://terminal.johnwesleyhicks.com/ · Owner: Wes Hicks

## Stack
Next.js 14 (App Router) · TypeScript · Tailwind · Supabase · Anthropic SDK · Alpaca · FMP · Polygon · Finnhub · Quiver · Vercel · Playwright

## Build methodology (April 2026)

This repo is being built by a **multi-agent team** using Anthropic's orchestrator-worker pattern with git-worktree isolation.

**Orchestrator** (you, Opus 4.7, 1M context) owns the plan, unblocks workers, reviews PRs on merge to `main`.

**Builders** (Sonnet, in `.claude/agents/builder.md`) implement features in isolated worktrees. **Challengers** (Opus, paired Team) adversarially review critical financial logic (RSU hedge, debate gate, Fed scorer). **Verifier** auto-gates: Playwright tests + Vercel preview + security scan must be green.

See `docs/build-plan/feature-dag.md` for the 18-feature dependency graph and current wave.

## Permission model (auto-approval)

The project `.claude/settings.json` is set to `defaultMode: acceptEdits` — Claude will NOT prompt for:
- File edits/writes anywhere under `src/`, `e2e/`, `docs/`, `memory/`, `scripts/`, `public/`, `supabase/migrations/`, `.claude/`
- Common `npm`, `npx`, `git` (non-destructive), `gh`, `supabase migration`, `vercel` read ops
- WebFetch / WebSearch

Claude WILL still prompt (or be blocked) for:
- Any edit to `.env*`, `supabase/schema.sql`, `src/middleware.ts` — these are auth/secret-critical
- Destructive git (`push --force`, `reset --hard`, `branch -D`, `clean -fd`)
- `rm -rf`, `sudo`, `npm publish`, `supabase db reset`, `vercel rollback`
- Any Bash not in the allow list

To loosen or tighten, edit `.claude/settings.json`. Do NOT switch to `bypassPermissions` mode — the deny list exists for a reason.

## Non-negotiable rules

1. **Test-driven.** Every feature ships with a failing Playwright test FIRST. Builder's definition of done = test green. No "looks done."
2. **Self-Refine loop.** After code is written, critique it against the spec + test. Refine. Max 3 iterations before escalating.
3. **Checkpoint every 10 steps.** Append progress summary to `memory/builders/<feature>.md` — routes created, tables migrated, tests passing, open questions. Enables resume on crash.
4. **Never touch `.env*`, `.git/*`, or production secrets.** Hooks will block these. If the hook blocks you, escalate — don't work around.
5. **Never disable middleware auth or CORS.** If the middleware seems wrong, escalate — don't edit.
6. **Every API route needs rate-limit + auth.** No new route ships without both. Use existing `@/lib/rate-limit` wrapper.
7. **Every destructive SQL migration requires orchestrator sign-off.** Append to `supabase/migrations/` — never edit `schema.sql` in-place.
8. **Prompt caching on all Claude calls.** Cache system prompts + tool defs. Use Batch API for non-urgent scoring (Fed speeches, earnings tone) — 50% off.

## Model routing (cost optimization)

| Task | Model |
|------|-------|
| Orchestration, architecture decisions, Team challenger | Opus 4.7 |
| Feature implementation, bug fix, spec writing | Sonnet (default) |
| Scaffolding, boilerplate, doc summaries, triage | Haiku |

## File layout conventions

- API routes → `src/app/api/<feature>/route.ts` (auth via middleware, rate-limit inline)
- Pages → `src/app/<feature>/page.tsx`
- Shared lib → `src/lib/<name>.ts`
- Claude prompts → `src/lib/prompts/<name>.ts` (versioned, eval'd)
- Components → `src/components/<feature>/<Component>.tsx`
- Supabase types → `src/types/supabase.ts` (generated, do not edit)
- E2E tests → `e2e/<feature>.spec.ts`

## Definition of done (every feature)

- [ ] Playwright acceptance test passes (written FIRST)
- [ ] TypeScript compiles (`npm run build`)
- [ ] ESLint clean (`npm run lint`)
- [ ] No new console.error unhandled in logs
- [ ] Security scan clean (`/security-review` on changed files)
- [ ] Feature flag wired (can be toggled hidden in prod)
- [ ] Documented in `docs/build-plan/<feature>.md` with one-paragraph description
- [ ] Checkpoint file updated in `memory/builders/`

## Security fixes (Week 1, blocking)

These MUST ship before adding feature load:

1. Replace SHA-256 cookie with signed JWT sessions (iron-session recommended)
2. Add Sentry error tracking
3. Wire Healthchecks.io pings into all 6 cron routes
4. Fix the FMP `/stable` endpoint error state (blocks VIX + sectors + briefing context)

## Reference docs

- [docs/build-plan/feature-dag.md](docs/build-plan/feature-dag.md) — 18-feature dependency graph
- [.claude/skills/builder.md](.claude/skills/builder.md) — builder workflow
- [.claude/agents/builder.md](.claude/agents/builder.md) — builder subagent definition
- [.claude/settings.json](.claude/settings.json) — hook configuration
