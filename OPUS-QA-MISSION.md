# 🏛️ OPERATION: GLASTONBURY SOLID — Final QA Mission

You are inheriting the Glastonbury Terminal (https://terminal.johnwesleyhicks.com/, repo `~/Projects/glastonbury-terminal`) at the 95-yard line. Fable 5 + four parallel Codex agents spent tonight (2026-08-30/31) taking it from "3 crashing pages and a health endpoint frozen for 4 weeks" to "118/125 e2e tests passing against live prod." Your mission: close the last 5 yards and certify this thing as the dopest, most solid personal terminal ever built. No regressions. No vibes-based fixes. Receipts for everything.

**Read first:** repo `CLAUDE.md` (build rules — never touch `.env*`, `src/middleware.ts`, `supabase/schema.sql`; every route needs auth + rate-limit; append-only migrations) and memory file `terminal_smoke_test_2026-08-30.md` (full campaign log).

## ✅ What is DONE and LIVE (do not redo, do not break)
- PRs **#12** (crash fixes + force-dynamic on 23 routes), **#13** (hardening: nightly smoke, zod boundaries, DataAge chips, error beacon, quiver, briefing receipts), and **#4** (OAuth resource binding, merged after 3 months) — all squash-merged to main and **deployed to prod, verified**.
- Migrations **already applied to prod Supabase** (project `vmpxcauwzsswxqhglgdv`): `20260831_kv_cache` (kv_cache table + kv_try_lock), `20260831_kv_append_capped`, `20260514_oauth_resource_binding`. Do NOT re-apply; do not create tables that exist.
- Verified live: login works, `/api/health` fresh + reports `clientErrors`, narrative fresh (durable kv_cache store), Polymarket macro filter (soccer is gone), Keisha titles sanitized, /earnings /vol-surface /alerts all render.

## 🎯 YOUR TARGETS (in priority order)

### 1. 🔴 Hydration mismatch on EVERY page — React minified errors #425 + #422
Console on prod shows `Minified React error #425` (text mismatch) + `#422` (Suspense hydration) on dashboard, /monte-carlo, /macro — this is why 4 of the 7 remaining e2e failures fail (`page-loads`, `dashboard`, `macro` specs assert no console errors).
**Prime suspect:** `src/components/ui/DataAge.tsx` (new tonight) — it renders wall-clock relative time ("3m ago") which differs between server render and client hydration. Used in `src/components/dashboard/MarketNarrative.tsx` + `MorningBriefing.tsx`.
**Fix pattern:** mount-gate it (render nothing until a `useEffect` sets mounted) or `suppressHydrationWarning` + client-only computation. VERIFY the errors actually disappear in a browser against a local `npm run dev` AND against prod post-deploy — do not assume.
**Note:** there may be a SECOND hydration source — errors appear on pages that don't obviously use DataAge. Reproduce locally first (`npm run dev`, open dashboard, check console with React unminified — you'll get real error text instead of #425).

### 2. 🔴 Mystery 502 on every page load
Some resource 502s on every prod page (console: "Failed to load resource: 502"). Identify it (DevTools network tab or Playwright trace), root-cause, fix. Suspects: an SSE/stream endpoint (`/api/prices/stream`?), the Sentry tunnel route, or a dead third-party. It predates tonight's work possibly — but find out, don't guess.

### 3. 🟡 F17 share-tokens: create returns 500 on prod
`share_tokens` table EXISTS in prod (verified via SQL). So the 500 is config/RLS/env. The spec is `test.fixme()`'d in `e2e/F17-share-tokens.spec.ts` with a BUG comment. Root-cause via Vercel function logs or Sentry, fix, un-fixme the test.

### 4. 🟡 Two likely-flaky specs — confirm and stabilize
- `D1-fmp-sectors` "non-empty sectors": failed in the full run but `/api/sectors` returned 8 rows moments later. Probably FMP rate-limit/cold-start flake → add retry tolerance or a warmup.
- `healthz-gate` "GET /api/health requires authentication": failed in-run but a bare curl gets 401 correctly. Check whether the spec's request context leaks the auth storageState (it must send NO cookies).

### 5. 🟡 Dashboard "Options P&L / Daily Theta cards" spec (19.6s timeout)
Reconcile spec vs current dashboard DOM — cards may render conditionally with 0 positions. Fix spec or component, whichever is wrong.

### 6. 🟡 Un-noise the alarm (do this or the dead-man switch dies of neglect)
The nightly smoke will be RED every day until targets 1–5 are fixed — and a permanently-red alarm becomes invisible within weeks (that is exactly how the old e2e suite rotted since May). Three sub-tasks:
- (a) After fixing targets 1–5, confirm a fully GREEN nightly-smoke run, then close alarm issue #14 with a comment linking the green run.
- (b) Add a Healthchecks.io ping to nightly-smoke.yml (repo lib `src/lib/healthchecks.ts` shows the slug pattern; the workflow just needs a `curl hc-ping.com/<uuid>` success step + `/fail` on failure — Wes creates the check in his existing Healthchecks account and adds the URL as a repo secret). This catches GitHub's silent 60-day scheduled-workflow disablement — the watchdog for the watchdog.
- (c) Ask Wes to confirm alarms actually reach his phone: GitHub mobile app + watching the repo, or wire a Pushover step into the failure path (Pushover token as repo secret).

### 7. Final certification run
`E2E_PASSWORD='<terminal password — memory: credentials_personal_apps.md>' E2E_BASE_URL=https://terminal.johnwesleyhicks.com npx playwright test` → target: **0 unexpected failures**. Then run the repo gate: `npx tsc --noEmit`, `npm test` (245 must pass), `npm run lint`, `node scripts/check-route-dynamic.mjs`, `npm run build`. Ship via PR to main (squash), verify the Vercel deploy, re-run the smoke against prod. Update memory file `terminal_smoke_test_2026-08-30.md` with the outcome.

## ⚠️ RULES OF ENGAGEMENT
- Wes's standing method: brainstorm → systematic-debug → plan → verify (Superpowers). No fix-by-vibes; reproduce before patching.
- Stacked-PR scar tissue: never `gh pr merge --delete-branch` on a branch that has children.
- The auto-mode classifier sometimes blocks `gh pr merge` — `gh api -X PUT repos/hicksjoh/glastonbury-terminal/pulls/<N>/merge -f merge_method=squash` is the sanctioned alternative once Wes has directed the merge.
- Adversarial-review your own diff before shipping (Codex MCP `mcp__codex__codex`, read-only sandbox, "attack this diff" prompt — it caught 9 real bugs tonight across 3 passes). Gemini CLI is DEAD (Google killed the free tier — needs Antigravity migration; don't waste a call).
- Do not put real passwords in prompts, commits, or Codex briefs. The e2e password comes from memory `credentials_personal_apps.md` into a local env var only.

## 📋 WES'S OWN CHECKLIST (remind him, you can't do these)
1. `printf '%s' '<terminal password>' | gh secret set E2E_PASSWORD --repo hicksjoh/glastonbury-terminal` — **without this the nightly dead-man switch cannot log in and will false-alarm every weekday at 7am ET.**
2. Optional: Quiver API key (quiverquant.com) → `QUIVER_API_KEY` in Vercel env → congress/insider pages light up.
3. Optional: purge the 24 empty "Untitled" Keisha conversations from Supabase (UI already hides them).
4. Optional: delete merged branches `fix/prod-smoke-crashes`, `feat/terminal-hardening`, `fix/oauth-prod-readiness`.

## 🏁 DEFINITION OF DONE
Full e2e suite green against prod (fixmes documented, zero unexpected failures) · zero console errors on dashboard, /macro, /monte-carlo · the 502 explained and fixed · nightly-smoke workflow has run green at least once (trigger via `gh workflow run nightly-smoke.yml` after Wes sets the secret) · memory updated.

The empire's watchtower is built. Light the beacons. 🔥
