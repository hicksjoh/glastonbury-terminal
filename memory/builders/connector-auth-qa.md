# Connector auth QA — 2026-09-19

Triggered by: "the Claude connector works, but when I first tried it, it said
the authentication had expired even though I'd just logged in."

## What actually happened (not a guess — production trace)

Vercel runtime logs for `prj_EPwVhg97xLuDszUb5lG7yKV3CA04`, 2026-09-19 UTC,
cross-checked against `oauth_consent_transactions` and `oauth_codes` in
Supabase project `vmpxcauwzsswxqhglgdv`:

```
06:42:45  POST /api/mcp                              401   connector probes, no token
06:42:45  GET  /.well-known/oauth-protected-resource 200   discovery
06:42:48  GET  /.well-known/oauth-authorization-server 200
06:42:50  GET  /api/oauth/authorize                  303   no session → /login?next=...
06:42:57  POST /api/auth/login                       200   login succeeds
06:42:59  GET  /api/oauth/authorize                  303   consent tx #1 minted
06:43:00  GET  /oauth/consent                        200
06:43:05  POST /api/oauth/finalize                   303   ✅ code #1 minted, 303 → claude.ai
06:43:07  POST /api/oauth/finalize                   400   ❌ SAME tx, 1.4s later
06:43:16  GET  /api/oauth/authorize                  303   user restarts; tx #2
06:43:21  POST /api/oauth/finalize                   303   ✅ code #2
06:43:22  POST /api/oauth/token                      200   exchanged in 1.4s
06:43:24+ POST /api/mcp                              200   working
```

`oauth_codes` confirms it: code #1 (`65410735…`) has `used_at = NULL` to this
day. It was valid, unexpired, correctly PKCE- and state-bound — and never
exchanged, because the 400 page from the duplicate POST replaced the in-flight
cross-origin navigation to claude.ai. Claude never received the callback.

**Nothing about the session was expired.** State and PKCE round-tripped
perfectly on both attempts. The message came from
`/api/oauth/finalize`'s generic failure string — "Consent transaction unknown
or expired. Restart authorization." — fired on a duplicate submit.

Source of the duplicate: a double-click / re-submit of Approve. Ruled out the
PWA service worker as the cause: `public/sw.js:50` bails on any non-GET.

## Fixes shipped

### 1. Finalize is idempotent (root cause)
`oauth_consent_transactions.issued_code` records the code each transaction
minted. A duplicate POST inside a 5-minute grace window re-issues the **same**
redirect instead of erroring. Not a new grant — the code is still consumed
exactly once at `/api/oauth/token`, and the replay path re-validates the
client, the revocation state, the registered redirect_uri, and that the
replaying session is the same subject that approved.

If the code was already exchanged, the flow actually succeeded, so the user
gets an "Already connected" page rather than a bounced dead code.

`findReplayableConsentWithRetry` retries 4× at 250ms because a double-click
fires the two POSTs ~150-300ms apart — potentially faster than the winner can
write its code back.

### 2. Refresh tokens (the next thing that would have bitten)
Access tokens are 1-hour JWTs and `/api/oauth/token` implemented
`authorization_code` **only**. `src/lib/oauth/tokens.ts` claimed "Claude.app
handles this transparently" — it does not. A client can silently spend a
refresh token; it cannot silently re-run a flow that needs a human to log in
and click Approve. So the connector went dead every hour and said
"authentication expired", which is the same words the user reported.

`src/lib/oauth/refresh.ts`: opaque 256-bit tokens stored as SHA-256 hashes,
30-day TTL, rotated on every use, with family-wide reuse detection
(OAuth 2.1 §4.3.1 / RFC 6819 §5.2.2.3). Advertised in RFC 8414 metadata.
`revokeClient()` now burns the client's refresh tokens too.

### 3. Double-submit prevented at the source
`src/app/oauth/consent/ApproveForm.tsx` — Approve disables on submit.
Belt and braces with fix 1, because the server guard depends on a database
write landing before the second request reads it.

### 4. Post-login bounce is a hard navigation
`login/page.tsx` used `router.push('/api/oauth/authorize?...')` — an App
Router *client* navigation to a Route Handler. Next fetches it for an RSC
payload, gets a 303 to an HTML page, then falls back to a document load. It
worked in the captured trace, but it is a needless detour in the most fragile
part of the flow. Now `window.location.assign`.

## Migration
`supabase/migrations/20260919_oauth_finalize_idempotency_and_refresh.sql`
— additive only (new column, new table, two new RPCs). Applied to
`vmpxcauwzsswxqhglgdv`.

## Verification
- `npx vitest run` → **37 files / 823 tests pass**, incl. 17 new:
  - `src/lib/__tests__/oauth-refresh.test.ts` (9) — rotation, reuse burns the
    family, expired/revoked/unknown are distinguished, plaintext never stored,
    concurrent claims: exactly one wins.
  - `src/lib/__tests__/oauth-consent-replay.test.ts` (8) — replay window,
    state survival, write-failure tolerance, double-click retry race.
- `npx tsc --noEmit` → **0 errors**
- `npm run lint` → clean (2 pre-existing warnings in `keisha/page.tsx`)
- `npm run build` → **succeeds**. Note: it fails in a sandbox with no Supabase
  env vars, on `/api/congress` prerender ("supabaseUrl is required") — an
  unrelated pre-existing route with no `force-dynamic`. With env present the
  build is clean. All OAuth routes render on demand (ƒ).
- New e2e coverage in `e2e/S3-oauth-mcp.spec.ts`: duplicate finalize re-issues
  the same code, unknown tx returns HTML that never says "authentication
  expired", refresh round-trip + rotation + family burn.

## Open item for Wes
`/api/congress` has no `export const dynamic = 'force-dynamic'` and is
prerendered at build time; it only builds because Vercel has Supabase env at
build time. Worth a follow-up — `npm run check:routes` exists for this.

## Post-review hardening: refresh claim is client-bound

Found on adversarial re-read of my own diff, before review came back.

The first cut called `claimRefreshToken(token)` and compared `grant.client_id`
to the presenting `client_id` **after** the claim succeeded, burning the
family on mismatch. That is a free kill switch: someone holding only a stolen
refresh token cannot mint with it (they lack the victim client's secret), but
they *could* register their own client, present the stolen token under their
own credentials, and let the mismatch handler revoke the victim's whole
family — taking the connector down at will, repeatedly.

Fixed by moving the client match INSIDE the atomic claim
(`claim_refresh_token(p_token_hash, p_client_id)`). A mismatched client now
consumes nothing and burns nothing; it gets `client_mismatch` and a generic
`invalid_grant`. No security property is lost — a thief who waits for a real
rotation and then replays still trips genuine reuse detection.

Verified against the live database, not just the mock:

```
attacker_claim_rows        0      -- rejected
used_at_after_attacker     NULL   -- not consumed
revoked_at_after_attacker  NULL   -- no family burn
legit_claim_rows           1      -- rightful client still works
legit_second_claim_rows    0      -- single-use still holds
```

Probe row deleted afterwards. Migration
`20260919b_refresh_claim_binds_client` applied; the checked-in migration file
carries the final two-arg signature.

Final gate: **824 unit tests pass**, tsc clean, lint clean on all touched
files.
