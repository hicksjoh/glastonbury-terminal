# 🏛️ OPERATION: PROVE THE MATH — Glastonbury Terminal, B+ → A++

You are inheriting the Glastonbury Terminal (https://terminal.johnwesleyhicks.com/, repo `~/Projects/glastonbury-terminal`) the morning after a full production QA campaign. The infrastructure is now verified, self-monitoring, and green. **The financial mathematics has never been tested.** That one gap is the entire distance between the B+ this app has and the A++ it should have.

Your mission: make the numbers trustworthy, and prove it with receipts.

**Read first:** repo `CLAUDE.md` (build rules), memory `terminal_smoke_test_2026-08-30.md` (campaign log), memory `nextjs_vercel_cache_gotchas.md` (two prod-only traps that cost hours last night).

---

## ✅ DONE AND LIVE — do not redo, do not break

Shipped as PRs #15, #16, #17, squash-merged to `main`, deployed, verified in production:

- **Hydration mismatches eliminated** — five distinct causes across `/`, `/monte-carlo`, `/settings`, `/calendar`, `/tax`. New `src/lib/et-clock.ts` pins wall-clock rendering to America/New_York. Verified clean on **all 42 pages**.
- **Security bug closed** — revoked share tokens stayed publicly readable because Next cached `supabase-js` reads in its Data Cache. Both server clients in `src/lib/supabase.ts` now use a `no-store` fetch.
- **`/api/health` stopped lying** — it now exercises real Claude inference instead of `GET /v1/models` (which returns 200 on a zero credit balance) and reports the cause in `serviceDetail.claude`.
- **Test suite un-blinded** — `e2e/helpers/test-utils.ts` had been filtering out React #418/#423/#425 and anything matching `"hydration"` as "known benign." It was concealing every bug above.
- **CI guard hardened** — `scripts/check-route-dynamic.mjs` now checks whether a GET actually *reads* the request, not merely whether it declares a parameter.

**Baseline you must not regress:** e2e **125 passed / 0 failed / 7 skipped** vs live prod (the 7 need `CRON_SECRET`/`OAUTH_REGISTRATION_TOKEN`, unavailable to the runner). `npm test` **282/282**. Nightly smoke green. Supabase advisors: zero ERROR-level.

**Open, and NOT yours to fix:** the Anthropic account credit balance is exhausted, so Keisha and the morning briefing cannot generate. Health reports it honestly. Wes must add credits.

---

## 🎯 THE GAP

All 125 e2e tests assert that **pages render and APIs return the right shape**. Not one asserts that **a number is correct**.

Auth and tax *are* genuinely covered — `tax-engine` (31 tests), `order-schemas` (32), `alpaca` (34), `tax-lot-optimizer` (12), `wash-sale-detector` (9), plus session/PKCE/OAuth. That work is solid. Leave it alone.

**Every quantitative engine has zero tests.** I ran a reconnaissance pass before writing this brief, so you are not starting blind. Findings below are **confirmed by execution**, not guesses.

---

## 🔴 CONFIRMED DEFECTS — start here, these are real

### 1. NaN falls through every Kelly guard and returns the MOST AGGRESSIVE recommendation

`src/lib/kelly-sizer.ts:35-54`. With any non-finite input:

```
fullKelly = Math.max(0, (b*p - q)/b)   // Math.max(0, NaN) === NaN
if (fullKelly <= 0)      // NaN <= 0   -> false
else if (fullKelly<0.05) // NaN < 0.05 -> false
else if (fullKelly<0.15) // NaN < 0.15 -> false
else -> "Strong edge detected. Half-Kelly (NaN%) to manage tail risk."
```

Observed output with malformed input:
```json
{"fullKelly":null,"halfKelly":null,"dollarsAtRisk":null,"maxLoss":null,
 "recommendation":"Strong edge detected. Half-Kelly (NaN%) to manage tail risk."}
```

**Every NaN comparison is false, so garbage data routes to the "Strong edge" branch.** The `<= 0` guard that is supposed to catch a bad trade cannot fire.

**Blast radius — this is not academic.** `calculateKelly` is called from:
- `src/app/api/autopilot/route.ts:167` — the autonomous trading path
- `src/lib/trade-guard-engine.ts:179` — the guard whose entire job is stopping bad trades
- `src/lib/signal-scorer.ts:99`

Its inputs (`winRate`, `avgWin`, `avgLoss`) are derived from API/historical data, so a missing or malformed upstream field is a realistic trigger. Fix: validate finiteness at the top and fail closed (return zero size + an explicit "insufficient data" recommendation). Then test it.

### 2. `fullKelly` does not return full Kelly

`kelly-sizer.ts:57` returns `fullKelly: cappedKelly` (capped at 25%), while the recommendation branches on the **uncapped** local `fullKelly`. A consumer reading `result.fullKelly` gets a different number than the one that chose the recommendation text. Decide the intended semantics and make the names honest.

### 3. `KellyInput` advertises three fields the function ignores

`expectedReturn`, `volatility`, `riskFreeRate` are on the interface and destructured nowhere (`kelly-sizer.ts:29`). `optionsKelly` dutifully computes `expectedReturn: premium / maxLoss` and it is silently discarded. Either use them or remove them — a contract that lies is how callers build wrong mental models.

### 4. Cholesky silently accepts a non-positive-definite matrix

`src/lib/monte-carlo-risk.ts` — `choleskyDecomposition([[1,2],[2,1]])` (not PD) returns `[[1,0],[2,0.00001]]`. It clamps to a fudge value instead of rejecting. Correlated-risk simulations then run on an invalid decomposition and produce plausible-looking, wrong risk numbers. Note the inconsistency: `matrixInverse` in `black-litterman.ts` **correctly throws** on a singular matrix. Make the failure modes consistent.

### 5. `pearsonCorrelation` returns 1.0 for mismatched-length inputs

`src/lib/correlation.ts` — `pearsonCorrelation([1,2,3],[1,2])` returns **1** — perfect correlation, from malformed input. Should throw or return null. Silent wrong answers in a correlation matrix corrupt every downstream diversification and beta number.

---

## ✅ VERIFIED CORRECT — don't waste time re-deriving these

My recon confirmed these are right. Add regression tests to lock them in, but do not go hunting:

- **`black-scholes.ts` matches the textbook exactly.** S=100, K=100, r=5%, σ=20%, T=1 → call **10.450575** (ref 10.4506), put **5.573518** (ref 5.5735). `normalCDF(0)=0.5`, `normalCDF(1.96)=0.975002`. Delta call 0.636831 / put −0.363169, gamma 0.018762, vega 0.375240, rho 0.532325.
- **The two Black-Scholes implementations agree.** `options/greeks.ts` `blackScholesPrice(100,100,1,0.05,0.2,'call')` = **10.450575**, identical to `bsPrice`. They still deserve a cross-check across a grid of moneyness/expiry/vol, but they are not in conflict at the reference point.
- **`matrixInverse` is correct** — `A·A⁻¹` returns exact identity, and it throws on a singular matrix.
- **Cholesky reconstructs correctly** for valid PD input — `L·Lᵀ` returns `[[4,2],[2,3]]` exactly.
- **`continuousKelly` is well-behaved** — floors negative edge at 0, guards `volatility <= 0`.
- **`pearsonCorrelation` basic identities hold** — `corr(x,x)=1`, `corr(x,−x)=−1`.

---

## 🧪 HOW TO VERIFY MATH WITHOUT A REFERENCE IMPLEMENTATION

This is the heart of the mission. **Never write a test that merely re-asserts whatever the code currently returns** — that locks in bugs and is worse than no test. Every engine here has ground truth:

**Known-answer tests.** Use the published values above plus more fixtures across moneyness and expiry.

**Identities that must hold exactly.**
- Put-call parity: `C − P = S − K·e^(−rT)`, for every input, always.
- Cholesky: reconstruct and assert `L·Lᵀ ≈ Σ`.
- Inverse: `A·A⁻¹ ≈ I`; and assert the singular case *throws*.
- Correlation: `corr(x,x)=1`, `corr(x,−x)=−1`, symmetry, unit diagonal.

**Finite-difference greeks.** Verify each greek against a numerical derivative of the price function (delta ≈ ΔP/ΔS). This is the single best catcher of sign errors and misplaced factors — eyeballing never finds them.

**Bounds.** Call delta ∈ [0,1], put delta ∈ [−1,0], gamma ≥ 0 and vega ≥ 0 for long options.

**Round-trips.** `solveIV(bsPrice(σ)) ≈ σ` across a wide σ range, and specifically where IV solvers classically break: deep ITM/OTM, near-zero time to expiry, and prices below intrinsic value.

**Monotonicity.** Call price rises with vol; falls as strike rises; longer expiry costs more (vanilla calls). Catches inverted comparisons.

**Degenerate inputs — where this codebase has already proven weak.** T=0, σ=0, S=0, negative rates, empty arrays, single data point, mismatched lengths, zero-variance series, 1×1 matrices, non-PD matrices. Findings #1, #4 and #5 above are all in this family, so assume more of them exist.

**The NaN sweep.** Findings #1 and #5 are the same underlying disease: **non-finite values passing guards and being rendered as confident output.** Treat this as a codebase-wide hunt, not a one-off fix. `Math.max(0, NaN)` is `NaN`; every `<`/`>`/`<=` against NaN is false, so NaN routes to whatever the final `else` says. Grep for comparison-chain guards over computed financials and assume NaN takes the last branch.

**Non-deterministic code** (Monte Carlo): seed it, or assert statistical properties with tolerances (mean/percentile convergence), never exact equality.

---

## 📋 TARGETS IN PRIORITY ORDER

1. **Fix the five confirmed defects above**, each with a failing test written first.
2. **`live-order-safety.ts`** (180 lines, `assertLiveOrderAllowed`, `resolveNotionalUsd`, `formatLiveOrderRejection`) — the paper/real-money boundary, currently zero tests. Test it as an adversary: every gate must **fail closed**. Assert that a missing env var, malformed notional, missing `x-live-ack` header, and mismatched URL each *block* the order rather than falling through. Verify `resolveNotionalUsd` cannot be tricked into under-reporting notional and slipping an order under the typed-confirm threshold.
3. **`black-scholes.ts` + `options/greeks.ts`** — lock in known-answer, parity, finite-difference greeks, IV round-trip; cross-check the two implementations across a grid.
4. **`monte-carlo-risk.ts`, `black-litterman.ts`, `correlation.ts`** — linear-algebra identities and degenerate inputs.
5. **`gex-engine.ts`** (368), **`factor-engine.ts`** (167), **`hedge/rsu-analyzer.ts`** (221 — hedges Wes's actual Anthropic equity), **`behavioral-guard.ts`** (145), **`options/strategies.ts`** (313) — invariants, boundaries, sign conventions.
6. **End-to-end NaN/undefined leakage** — a value that reaches a rendered dashboard number as `NaN` is a silent correctness failure. Consider a shared guard plus a test that the API layer never emits `NaN` where a number is contractually promised.

**Report honestly.** If a module is correct, say so and move on — do not manufacture findings to look productive. If you cannot determine the *intended* financial semantics, ask Wes rather than guessing.

---

## ⚠️ RULES OF ENGAGEMENT

- **Superpowers method, non-negotiable:** brainstorm → systematic-debug → plan → TDD → verify. Reproduce before patching. No fix-by-vibes.
- **TDD literally here.** The failing test comes first. A test written after a fix tends to encode the bug.
- **Do not "fix" math you do not understand.** A confident wrong change to a pricing model is worse than an untested one. Escalate with the specific question.
- **Never touch** `.env*`, `src/middleware.ts`, `supabase/schema.sql`. Migrations append-only under `supabase/migrations/`. Every API route needs auth + rate-limit.
- **Adversarially review your own diff before shipping** — Codex MCP (`mcp__codex__codex`, read-only sandbox, "attack this diff"). It found 4 real bugs in a careful 340-line diff last night. Budget for it finding some in yours.
- **Gemini CLI is dead** (Google killed the free tier). Don't waste the call.
- **No real passwords in prompts, commits, or Codex briefs.** The e2e password lives in memory `credentials_personal_apps.md` → a local env var only. Gotcha: `APP_PASSWORD` contains a `$`, so dotenv **variable-expands it** locally — to log in against local dev, read the effective value via `@next/env`, don't parse `.env.local` yourself.
- **Stacked-PR scar tissue:** never `gh pr merge --delete-branch` on a branch that has children.
- If the auto-mode classifier blocks `gh pr merge`, the sanctioned alternative once Wes has directed the merge:
  `gh api -X PUT repos/hicksjoh/glastonbury-terminal/pulls/<N>/merge -f merge_method=squash`
- **Vitest buffers `console.log`.** For exploratory numeric probes, write results to a file with `node:fs` or you will see nothing.

### Two traps that will cost you hours if you don't know them

1. **Prod-only hydration bugs.** Vercel's server runs in **UTC**, the browser in ET; locally they share a timezone so nothing reproduces. Use `TZ=UTC npx next dev -p 3300` — dev mode also gives unminified React with real error text and a component stack. (A production build sets a `Secure` cookie, so you cannot log in against `next start` over `http://localhost`.)
2. **Next caches `supabase-js` reads.** Queries go through the global `fetch`, which the App Router replaces with a caching one, so a `.select()` lands in the Data Cache and is replayed against stale rows. `force-dynamic` does **not** fix it — that governs route rendering, not fetches inside the route. Already fixed centrally in `src/lib/supabase.ts`; don't regress it.

---

## 🏁 DEFINITION OF DONE

- All five confirmed defects fixed, each with a test that failed first
- `live-order-safety` and `kelly-sizer` have adversarial fail-closed coverage
- Every module in the target list has meaningful tests — known-answer, identity, boundary, monotonicity — **not** snapshots of current output
- The NaN-through-guards class is swept codebase-wide, not just patched at the two known sites
- Full gate green: `npx tsc --noEmit` · `npm test` · `npm run lint` · `node scripts/check-route-dynamic.mjs` · `npm run build`
- Full e2e still **0 unexpected failures** vs prod — no regressions from this work
- Shipped via PR to `main` (squash), Vercel deploy verified, smoke re-run against prod
- Memory updated: append the outcome to `terminal_smoke_test_2026-08-30.md`; write a new memory for any *generalizable* lesson
- **A written verdict for Wes:** which engines are now proven correct, which had real bugs, and what remains unverified. He wants the honest gap list far more than a clean bill of health — do not tell him it is bulletproof if it isn't.

---

## 📋 WES'S OWN CHECKLIST — remind him, you can't do these

1. **Add Anthropic API credits** — Keisha and the morning briefing are dead until then. Not a code issue.
2. `HEALTHCHECKS_PING_KEY` repo secret — arms the nightly deadman ping added last night (catches GitHub silently disabling scheduled workflows after 60 days). The check auto-creates on first ping.
3. Optional: Quiver API key → `QUIVER_API_KEY` in Vercel env (lights up congress/insider pages).
4. Optional: purge empty "Untitled" Keisha conversations; delete merged branches `fix/prod-smoke-crashes`, `feat/terminal-hardening`, `fix/oauth-prod-readiness`, `fix/final-qa-hydration`.

---

The watchtower is built and it works. Five real defects are already located and waiting for you — one of them hands the autopilot a "Strong edge detected" on garbage data. Go prove the rest of the math tells the truth. 🔥
