# Handoff — Glastonbury Terminal (2026-08-02)

> **⚠️ SUPERSEDED — 2026-08-02 (late).** The merge session happened. All six
> PRs below are MERGED to `main` (#5, #8, #9, #7, #10, #6), plus a new #11
> fixing a flaky JWT-tamper test (a literal-`X` signature swap that was a
> no-op 1/64 runs — this is what made #6's ci look red). Verified on merged
> main: 245/245 unit tests, clean build. `preview/design-combined` deleted.
> The e2e CI workflow has been red on ALL branches since May (environmental,
> needs its own fix — it is not a regression signal). Only #4
> (`fix/oauth-prod-readiness`) remains open, untouched. The "Where things
> stand" section below is now historical.

Paste everything below the line into a new Claude Code chat, from
`~/Projects/glastonbury-terminal`.

---

I'm continuing work on the Glastonbury Terminal (private wealth + trading
terminal, Next.js 14 App Router + TypeScript + Supabase + Anthropic SDK +
Alpaca, live at https://terminal.johnwesleyhicks.com/). Read
`~/Projects/glastonbury-terminal/CLAUDE.md` first for the build rules — in
particular: never touch `.env*`, `src/middleware.ts`, or `supabase/schema.sql`;
every API route needs rate-limit + auth; append-only migrations.

## Where things stand

Six open PRs, deliberately stacked. **Nothing is merged to `main` yet.**

```
main
├── #5  design/foundation ......... design tokens + 11 UI primitives
│   ├── #8  design/instrument-moves ..... ⌘K palette, HairlineTable, dot grid, MARKET status chip
│   └── #9  design/narrative-migration .. MarketNarrative + MorningBriefing off raw hex
├── #7  safety/live-trading-unlock ...... 4-gate live-trading safety + 6 security fixes
│   └── #10 safety/keisha-notional-ui ... live-ack header + typed-confirm in Keisha chat
└── #6  chore/keisha-latest-model ....... auto-resolve to newest Claude model
```

Merge order: **#5 → #8 → #9**, and **#7 → #10**. #6 is independent.
(#4 `fix/oauth-prod-readiness` predates this work — I haven't touched it.)

There is also a local throwaway branch `preview/design-combined` = #5 + #8 + #9
merged together, used only to eyeball the combined design. Delete it whenever;
it is not meant to be pushed or merged.

## What the design work is

North star is **"Afrofuturist Quiet Luxury"** — Wakanda meets Goldman. Deep
obsidian ground, warm cream ink (`#EDEBE4`, never pure white), ONE gold accent
(`#C9A84C`), JetBrains Mono for numeric density. The law lives in
`docs/DESIGN-SYSTEM.md`; the single source of truth is
`src/lib/design-tokens.ts`. Tailwind config and `globals.css` both read from it.

Retired and BANNED going forward: purple `#8a5cf6` (was 209 refs), drift-gold
`#f0c674` (was 244 refs — survives only as the `warning` token), duplicate greys,
and border-radii outside `chip/button/card/panel/hero/full`.

I evaluated a separate "Instrument" precision-terminal design language and
deliberately took only part of it: dot-grid texture, hairline tables, the ⌘K
palette treatment, the MARKET-status pulse, tabular numerics, gold selection.
I explicitly did NOT take its acid-lime accent, its zero-border-radius/no-cards
rule, or its font stack — the gold and the Card primitive are the identity.
Don't "finish" the Instrument migration unless I ask for it.

PRs 3–6 of the design series are still unwritten: portfolio/positions,
earnings/research, coach/storm/debate, then a codemod to purge the remaining
inline hex.

## What the safety work is

PR #7 removed a hard paper-trading-only lock and replaced it with four gates
that ALL must pass before a real order reaches Alpaca:

1. `TRADING_MODE=live` server env
2. `ALPACA_BASE_URL` host matches the mode (+ https, no embedded creds, port 443)
3. A session-bound `x-live-ack` token, minted only after typing `CONFIRM LIVE`
4. For notional ≥ $5,000, a `typedConfirm` body field equal to the dollar amount

Autopilot cron needs a second flag, `AUTOPILOT_ALLOW_LIVE=true`, on top of
`TRADING_MODE=live`.

Every order route funnels through `assertLiveOrderAllowed()` in
`src/lib/live-order-safety.ts`. Never call `assertOrderSubmissionAllowed()`
alone from a route — that's only the mode/URL gate, not the ack/notional layer.
Use `resolveNotionalUsd()` to compute notional; a hand-rolled
`qty × limit_price` reintroduces a bug where market orders scored $0 and skipped
the confirmation gate entirely at any size.

Codex adversarially reviewed it and found 8 issues (7 confirmed). Six are fixed.
Two are accepted-not-fixed with written rationale in
`docs/LIVE-TRADING-SECURITY.md` — read that before touching this code:

- An already-authenticated compromise can mint its own ack (needs WebAuthn
  step-up to close; only matters after the session boundary already failed)
- `sessionStorage` exposes the token to same-origin XSS (fix is an HttpOnly
  cookie migration + CSRF across five routes — its own PR, and the next
  security item)

Be honest about this in any summary: it's a mistake-prevention layer, not an
intrusion-prevention layer.

Tests: 40 passing across `src/lib/__tests__/alpaca.test.ts` and
`src/app/api/autopilot/__tests__/paper-lock.test.ts`.

## Blocked on me — env changes Claude can't make

Claude cannot edit `.env*` (hook-blocked, and CLAUDE.md forbids it). I need to
add these myself for the work to take effect:

```env
# PR #6 — makes Keisha use Opus 5 / Sonnet 5 instead of the pinned 4.7
CLAUDE_AUTO_LATEST=true

# PR #7 — only when I'm actually ready for real money
TRADING_MODE=live
NEXT_PUBLIC_TRADING_MODE=live          # MUST match TRADING_MODE
ALPACA_BASE_URL=https://api.alpaca.markets
ALPACA_API_KEY=<live key, NOT paper>
ALPACA_SECRET_KEY=<live secret, NOT paper>
```

Also needs `supabase migration up` to create the `live_trading_acks` table.
Leave `AUTOPILOT_ALLOW_LIVE` unset until I've done a small live order by hand.

Ask me whether I've done these before assuming live mode works.

## Gotchas that cost time — don't rediscover them

- **A PWA service worker (`static-gt-v1` / `dynamic-gt-v1`) caches aggressively.**
  Design changes will appear not to take effect even after wiping `.next` and
  restarting the dev server, because the cache is browser-side. Bust it with:
  `navigator.serviceWorker.getRegistrations().then(r=>r.forEach(x=>x.unregister())); caches.keys().then(k=>k.forEach(c=>caches.delete(c)));`
  Verify design changes by reading **computed styles** via the browser tools,
  not by looking at a screenshot.
- **Gemini CLI is dead** for this account — free-tier Code Assist hard-errors
  with `IneligibleTierError` (migrate to Antigravity). Use Codex (`codex exec`,
  authed, v0.146.0) as the second-opinion lane instead. `codex exec --sandbox
  read-only` is good for reviews; `--full-auto` for scoped edits in a worktree.
- **`.env.local` pins `CLAUDE_MODEL_PRIMARY=claude-opus-4-7`**, which is why
  PR #6 added a `CLAUDE_AUTO_LATEST` override rather than just bumping defaults.
- FMP free tier 429s constantly — `VIX N/A` and `FMP: Error` on the dashboard
  are usually rate-limiting, not a bug.
- The Alpaca **paper** account has zero positions and $100K cash, so
  `Positions: 0`, `Today's P&L: $0.00`, and an empty agent-activity log are all
  correct, not broken.

## What I'd like to do next

Pick up whichever of these I point you at — ask me first if it's ambiguous:

1. Merge the stacks in order and verify nothing regresses
2. Design PRs 3–6 (portfolio/positions, earnings/research, coach/storm/debate,
   then the hex-purge codemod)
3. The HttpOnly-cookie + CSRF security PR that closes finding #4
4. Something else entirely

Start by confirming the PR list still matches the tree above
(`gh pr list`), since I may have merged some since this was written.
