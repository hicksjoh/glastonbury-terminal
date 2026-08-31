# Live-Trading Safety — Threat Model & Accepted Risks

Live trading was unlocked in PR #7. This document records what the safety
layer *does* protect against, what it *doesn't*, and why — so nobody
mistakes "there are four gates" for "this is attacker-proof."

Adversarially reviewed by Codex (gpt-5) on 2026-08-02: 8 findings, 7
confirmed. Six are fixed; two are accepted with rationale below.

---

## What the gates actually defend

| Gate | Defends against |
| --- | --- |
| `TRADING_MODE=live` env | Accidental live mode on a dev/preview deploy |
| URL/mode alignment + HTTPS/port/credential checks | Env drift, a mis-set `ALPACA_BASE_URL`, cleartext broker traffic, redirect-to-proxy |
| Session-bound `x-live-ack` token | Wes forgetting he's in live mode; a token lifted into a *different* session |
| Notional typed confirm (≥ $5,000) | Fat-finger quantity, a misread limit price, an unbounded market order |
| `AUTOPILOT_ALLOW_LIVE` second flag | The cron firing real money on the strength of one flipped variable |

**The honest summary: this is a mistake-prevention layer, not an
intrusion-prevention layer.** It is designed against *operator error* —
which is the actual thing that empties a retail account. It raises cost
for an attacker but does not stop one who already holds an authenticated
session.

---

## Fixed (PR #8)

1. **Market/stop orders bypassed the typed-confirm gate.** `notional = qty ×
   (limit_price ?? 0)` meant every market order scored $0 and skipped the
   gate at any size. Now `resolveNotionalUsd()` resolves a bound in order:
   `limit_price` → `stop_price` → live Alpaca quote → `NaN`. And
   `assertNotionalTypedConfirm` **fails closed** on a non-finite notional
   (it used to return early — the single worst line in the original PR).

2. **Ack token was an unbound bearer capability.** Now bound to the session
   subject at mint (`sub:<jwt-sub>`), compared on every verify, and minting
   is refused for non-session (`ip:`/`unknown`) identities.

5. **Expiry raced the broker POST.** Verification now requires ≥30s of
   remaining TTL. Revocation still cannot recall an already in-flight
   request — that's a broker-side cancel, documented in `revokeLiveAckToken`.

6. **`http://api.alpaca.markets` passed the host check.** Now requires
   `https:`, rejects embedded credentials, rejects non-443 ports.

7. **Multi-leg notional used the NET price**, so a credit spread with
   five-figure max loss scored below threshold. Now uses gross ratio ×
   |net price| × 100 and fails closed with no limit price.

8. **Rate limiter failed open on Supabase outage** (per-instance in-memory
   fallback ⇒ effective limit × instance count). The live-ack mint endpoint
   now returns 503 rather than accept a degraded limiter.

---

## Accepted, NOT fixed

### 3. An authenticated compromise can mint its own ack non-interactively

The confirm phrase (`CONFIRM LIVE`) is public and the mint endpoint accepts
it directly. Anyone who can already call authenticated APIs — stolen session
cookie, XSS, leaked `INTERNAL_API_KEY` — can mint a token without ever seeing
the red modal.

**Why accepted:** closing this requires step-up auth (WebAuthn / passkey
user-presence assertion) at mint time. That's a real feature, not a patch,
and it only matters *after* an attacker already owns the session — at which
point they can also read positions, move money via other paths, and change
settings. The ack gate was never the thing standing between an attacker and
the account; the session boundary is.

**Compensating controls:** every live-mode attempt writes a Sentry
breadcrumb (`trading.live_attempt` / `live_reject` / `live_pass`) with
symbol, side, qty, and notional. Detection, not prevention.

**Revisit when:** the terminal gets more than one user, is exposed beyond
Wes, or `INTERNAL_API_KEY` is shared with a third party.

### 4. `sessionStorage` exposes the token to same-origin scripts

Any successful same-origin XSS reads `glastonbury.liveAck` and submits live
orders for the token's remaining life.

**Why accepted:** the fix is an `HttpOnly; Secure; SameSite=Strict` cookie,
which means the token can no longer travel as the `x-live-ack` header the
whole safety layer is built on — that's a cookie migration plus CSRF origin
validation across five routes. Worth doing; too large to bolt onto the fix
PR without re-reviewing everything.

Session binding (finding #2, now fixed) does **not** mitigate this: XSS runs
in the victim's own session, so the binding check passes.

**Revisit:** own PR. Track as the next security item after this one.

---

## Operator checklist before going live

```env
TRADING_MODE=live
NEXT_PUBLIC_TRADING_MODE=live          # must match TRADING_MODE
ALPACA_BASE_URL=https://api.alpaca.markets
ALPACA_API_KEY=<live key, NOT paper>
ALPACA_SECRET_KEY=<live secret, NOT paper>
```

- [ ] `supabase migration up` (creates `live_trading_acks`)
- [ ] Confirm `NEXT_PUBLIC_TRADING_MODE` matches `TRADING_MODE` — the client
      banner and gate are baked at build time and will lie if they drift
- [ ] Leave `AUTOPILOT_ALLOW_LIVE` **unset** until the interactive path has
      been exercised with real money at small size
- [ ] Verify the red `CONFIRM LIVE` modal appears on first page load
- [ ] Place one small live order, confirm it fills
- [ ] Place one ≥$5,000 order, confirm the typed-dollar dialog blocks it
- [ ] Place one large **market** order, confirm it is now gated (this was
      the bypass)
- [ ] Check Sentry for the `trading.live_*` breadcrumbs

Last updated: 2026-08-02.
