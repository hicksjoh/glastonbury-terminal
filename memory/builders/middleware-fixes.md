# Middleware fixes (Codex QA review 2026-04-28)

## Status
verified — ready for commit

## Branch
`worktree-agent-a83195303450a2a96`

## Two bugs closed

### Bug A — path-extension auth bypass
`middleware.ts` used `pathname.includes('.')` to short-circuit static
assets. Any pathname containing a dot (`/stock/BRK.B`, `/api/stock/BRK.B`,
`/portfolio/v1.5`, …) skipped middleware entirely → unauthenticated
access to protected routes for any dotted symbol.

**Fix:** replaced with an explicit, hoisted regex matching only known
asset extensions (`ico|png|jpg|jpeg|gif|svg|webp|avif|css|js|map|json|xml|txt|woff2?|ttf|otf|eot`).
The `/_next/` prefix bypass is preserved.

### Bug B — Vercel cron paths missing from allowlist
`vercel.json` schedules eight cron paths but only four were in
`PUBLIC_API_ROUTES`. Middleware does NOT honor
`Authorization: Bearer ${CRON_SECRET}` — it only looks at JWT cookie
or `x-internal-key`. The four crons that weren't allowlisted were
silently 401'd by middleware before their own route-level CRON_SECRET
auth ever ran.

**Fix:** added the four missing paths to `PUBLIC_API_ROUTES`. Verified
each route still self-authenticates via Bearer CRON_SECRET (and a few
allow cookie or `x-internal-key` for manual runs).

## Cron-route prior auth state (Step 1 verification)

| Route | Prior auth state |
|-------|------------------|
| `/api/cron/storm-watch` | Already had CRON_SECRET auth (handle() checks `Authorization: Bearer ${CRON_SECRET}` or `x-api-key`) |
| `/api/cron/tax-harvest` | Already had CRON_SECRET auth (also accepts `x-internal-key` and `gt-auth` cookie for manual runs) |
| `/api/cron/coach-review` | Already had CRON_SECRET auth (also accepts `x-internal-key` and `gt-auth` cookie for manual runs) |
| `/api/cron/prediction-snapshot` | Already had CRON_SECRET auth (also accepts `gt-auth` cookie for manual runs) |

**No route was missing auth.** Safe to add to public allowlist.

## Files touched

- `middleware.ts` — replaced dot-includes bypass with explicit asset-extension regex; appended four cron paths to `PUBLIC_API_ROUTES`; updated comment to reflect that all six allowlisted cron-style routes self-authenticate.
- `e2e/S2-middleware-bypasses.spec.ts` — NEW. 10 test cases (Group A: 2 dotted-path bypass closures. Group B: 8 cron-allowlist checks — for each of the 4 crons, one "Bearer reaches the route" + one "no auth → route's own 401").

## Test cases written

**Group A — dotted-path bypass closed**
1. Unauthenticated GET `/stock/BRK.B` → 307/308 redirect to `/login` (was: bypassed middleware → 200).
2. Unauthenticated GET `/api/stock/BRK.B` → 401 (was: bypassed middleware → backed-API response).

**Group B — cron allowlist (parameterized over 4 paths)**
3–6. GET `/api/cron/{storm-watch,tax-harvest,coach-review,prediction-snapshot}` with `Authorization: Bearer ${CRON_SECRET}` → must NOT be redirected to `/login` (was: middleware-401 / 307-to-login).
7–10. GET same paths with no auth at all → 401 from the route's own auth (proves we didn't open a hole when allowlisting).

## Validation

- `npm run lint` — clean. Only pre-existing warnings in `src/app/keisha/page.tsx` unrelated to this change.
- `npm run build` — middleware **compiled successfully** (`✓ Compiled successfully`). Build then exits 1 on `/api/congress` prerender step due to missing Supabase env vars in the local worktree — this baseline failure was confirmed present BEFORE my changes (verified via `git stash` then re-run). Not caused by this PR.
- `npx playwright test --list e2e/S2-middleware-bypasses.spec.ts` — all 10 cases enumerate cleanly. Live execution requires the fix to be deployed to `terminal.johnwesleyhicks.com` (Playwright `baseURL`).

## Out-of-scope observations (not fixed here per scope)

- `tax-harvest`, `coach-review`, `prediction-snapshot` accept `gt-auth` cookie as an auth path for manual runs. That's intentional — scoped only to middleware + cron allowlist, not redesigning the cron auth model.
- The `/api/stock/[symbol]/route.ts` route has no rate-limit. Pre-existing, not in scope for this PR.

---

# Round 2 hardening (Codex round-2 review 2026-04-28)

## Status
verified — ready for commit

## Branch
`worktree-agent-aed3a332e3935e587`

## The gap Codex caught
Round-1's regex was anchored only to "ends with that extension":

```
const STATIC_ASSET_RE = /\.(ico|png|jpg|jpeg|gif|svg|webp|avif|css|js|map|json|xml|txt|woff2?|ttf|otf|eot)$/i;
```

Any pathname ending in one of those extensions bypassed auth, including
dynamic routes:

- `/api/stock/AAPL.json` → ends in `.json`, slipped past middleware → unauth GET against the protected stock detail API.
- `/stock/AAPL.json` → ends in `.json`, slipped past middleware → page route reachable without login.
- `/api/foo/bar.png` style escapes — any future route ending in those extensions would silently bypass auth.

## The fix
Anchor the regex to a single root-level segment with no embedded slashes,
which matches exactly the shape Next.js serves out of `/public`:

```
const STATIC_ASSET_RE = /^\/[^/]+\.(ico|png|jpg|jpeg|gif|svg|webp|avif|css|js|map|json|xml|txt|html|woff2?|ttf|otf|eot|webmanifest)$/i;
```

Differences vs round-1:
1. `^/` anchors to the start of the pathname.
2. `[^/]+` requires the rest of the path to have NO slashes — so any subpath like `/api/...` or `/stock/...` automatically fails.
3. Added `html` (for `/offline.html`, the SW offline fallback) and `webmanifest` (PWA manifest convention; we currently use `manifest.json` but the Site Web App Manifest spec also allows `.webmanifest`).

`/_next/*` prefix bypass is unchanged.

## public/ audit (Step 3)

`ls public/` returned 10 files, all at the root with no subdirectories:

| File | New regex matches? |
|------|--------------------|
| `favicon.ico` | yes (`.ico`) |
| `glastonbury-logo.png` | yes (`.png`) |
| `icon-192.png` | yes (`.png`) |
| `icon-512.png` | yes (`.png`) |
| `icon.svg` | yes (`.svg`) |
| `manifest.json` | yes (`.json`) |
| `news-placeholder.svg` | yes (`.svg`) |
| `offline.html` | yes (`.html` — added in this round) |
| `robots.txt` | yes (`.txt`) |
| `sw.js` | yes (`.js`) |

**No subdirectory assets exist in `public/`.** No allowlist additions
needed beyond the regex itself.

## Test cases added to `e2e/S2-middleware-bypasses.spec.ts`

**Group A2 — extension-only bypass tightened (round-2 regressions)**
1. `/api/stock/AAPL.json` unauth → 401 (the canonical real-route test; `[symbol]` dynamic segment soaks up `AAPL.json`).
2. `/stock/AAPL.json` unauth → 307/308 to `/login`.
3. `/api/foo/bar.png` unauth → 401 (general subpath escape).

**Group A3 — legitimate static assets still bypass (no false positives)**
4. `/favicon.ico` unauth → not redirected to `/login`.
5. `/robots.txt` unauth → not redirected to `/login`.
6. `/icon-192.png` unauth → not redirected to `/login`.
7. `/manifest.json` unauth → not redirected to `/login`.
8. `/_next/static/chunks/main.js` unauth → not redirected to `/login` (preserves the `/_next/` prefix bypass).

Total spec is now 18 tests (10 from round 1 + 8 new).

## Validation

- `npm run lint` — clean. Same pre-existing keisha warnings as round 1; nothing new.
- `npx tsc --noEmit` — clean (zero output).
- `npm run build` — middleware **`✓ Compiled successfully`**. Build then exits 1 on `/api/congress` prerender step due to missing Supabase env vars in the local worktree — this baseline failure was confirmed present BEFORE the round-1 changes (per the round-1 memory note above) and is unchanged by round-2. Not caused by this PR.
- `npx playwright test --list e2e/S2-middleware-bypasses.spec.ts` — all 18 cases enumerate. Live execution requires the fix to be deployed to `terminal.johnwesleyhicks.com` (Playwright `baseURL`).
