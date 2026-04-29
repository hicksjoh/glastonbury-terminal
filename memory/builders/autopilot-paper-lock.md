# Autopilot paper-trading lock — Codex round-2 review 2026-04-28

Closes the gap Codex flagged in the original `paper-trading-lock.md` open
questions: `src/app/api/autopilot/route.ts` previously POSTed `/v2/orders`
under `ALPACA_BASE_URL` while only checking the unrelated `ALPACA_PAPER` env
var. The two could drift (e.g. `ALPACA_PAPER=true` while
`ALPACA_BASE_URL=https://api.alpaca.markets`) and a real order would fire.
Now the route also funnels through `assertPaperTrading()` from
`src/lib/alpaca.ts` so a host-level mismatch hard-blocks the submission.

## Checkpoint summary

- **What was added** — One new `assertPaperTrading()` call inside the
  `handleExecute` helper of `src/app/api/autopilot/route.ts`, wrapped in a
  try/catch that returns `{ error: 'Paper-trading lock engaged: <reason>' }`
  with HTTP 500 if the host isn't `paper-api.alpaca.markets`. The legacy
  `process.env.ALPACA_PAPER !== 'true'` early-403 was kept (defense-in-depth
  — both checks run). Replaced the local `process.env.ALPACA_BASE_URL || …`
  default with the imported `ALPACA_BASE_URL` symbol from `@/lib/alpaca` so
  the env-resolution logic is now centralized through the same module that
  owns the guard.
- **`/v2/orders` POST sites in the file** — exactly **one** (`handleExecute`
  at the previously-unguarded line ~250). All other `/v2/orders` references
  in the codebase that could collide with a non-paper host are read-only
  `GET`s (`trade-guard-engine.ts`, `keisha-context.ts`, `order-guards/*`)
  and don't need this guard.
- **Test approach** — TDD with three vitest cases in
  `src/app/api/autopilot/__tests__/paper-lock.test.ts` (route-handler-level,
  picked up by the existing `vitest.config.ts` `src/**/*.test.ts` glob).
  Strategy: mock `globalThis.fetch`, stub `@/lib/supabase` and
  `@/lib/rate-limit` with `vi.doMock`, set `process.env.ALPACA_BASE_URL` to
  a non-paper host, dynamically `import('../route')`, invoke `POST` with a
  `NextRequest` carrying `{ action: 'execute', symbol, shares, side }`, then
  assert (a) zero fetch calls hit `/v2/orders`, (b) the response status is
  ≥500, (c) the response body contains "Paper-trading lock engaged". A third
  wiring test reads the route source and asserts the import line is present
  so a future refactor can't silently drop it. All three cases were red
  before the fix landed and green after.
- **Build/lint status** — `npx vitest run` 100/100 across 10 files (3 new
  in `paper-lock.test.ts`, all previously passing tests intact). `npm run
  lint` clean (only pre-existing warnings in `keisha/page.tsx`). `npx tsc
  --noEmit` clean. `npm run build` reports `✓ Compiled successfully` and
  generates 138/138 static pages — the post-export `/api/congress`
  prerender failure is a pre-existing missing-Supabase-env issue documented
  in `paper-trading-lock.md` and unrelated to this work.
- **Other unguarded `/v2/orders` POSTs found elsewhere** — none. The four
  POST sites (`options/order`, `options/order/multi-leg`, `keisha/actions`
  `place_order`, `autopilot` `execute`) and the `submitOrder()` helper in
  `src/lib/alpaca.ts` are now all funnelled through `assertPaperTrading()`.
