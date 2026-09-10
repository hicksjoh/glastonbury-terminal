import { test, expect } from '@playwright/test';

/**
 * Acceptance test for S2 — JWT auth on /api/portfolio/snapshot GET.
 *
 * The route is in `PUBLIC_API_ROUTES` (middleware allowlist) so cron POSTs
 * authenticated by `CRON_SECRET` can reach it. Side-effect: middleware never
 * authenticates GETs to this route either. The handler used to "auth" GET
 * by checking only that the `gt-auth` cookie was *present* — any string
 * value (including `garbage-not-a-jwt`) bypassed the check and returned the
 * full net-worth + equity history.
 *
 * Post-fix, GET verifies the JWT signature via `verifySessionJwt()` and
 * returns 401 for missing/expired/tampered/forged tokens, exactly like
 * every other protected route.
 */
test.describe('@smoke S2 — /api/portfolio/snapshot GET requires valid JWT', () => {
  test('rejects request with no cookie (401)', async ({ request }) => {
    const res = await request.get('/api/portfolio/snapshot', {
      headers: { Cookie: '' },
    });
    expect(res.status()).toBe(401);
  });

  test('rejects request with forged non-JWT cookie (401)', async ({ request }) => {
    // THIS is the bug we're fixing. Pre-fix: handler only checked cookie
    // presence, so any string slipped past auth and the handler hit Supabase
    // (returning 200 with the snapshot data, or 500 if a downstream column
    // was renamed — either way, NOT 401, which means the auth gate failed).
    const res = await request.get('/api/portfolio/snapshot', {
      headers: { Cookie: 'gt-auth=garbage-not-a-jwt' },
    });
    expect(res.status()).toBe(401);
  });

  test('accepts a freshly-issued valid JWT cookie', async ({ request }) => {
    // Mirror the login pattern from S1-jwt-sessions.spec.ts: POST credentials,
    // pull the gt-auth cookie out of Set-Cookie, replay it on the snapshot GET.
    const password = process.env.E2E_PASSWORD;
    if (!password) throw new Error('E2E_PASSWORD is required for snapshot auth tests.');
    const loginRes = await request.post('/api/auth/login', { data: { password } });
    expect(loginRes.status()).toBe(200);

    const setCookie = loginRes.headers()['set-cookie'] || '';
    const match = /gt-auth=([^;]+)/.exec(setCookie);
    expect(match).not.toBeNull();
    const jwt = match![1];

    const res = await request.get('/api/portfolio/snapshot', {
      headers: { Cookie: `gt-auth=${jwt}` },
    });

    // A valid JWT must produce a real 200 with the documented body shape.
    //
    // This assertion used to be `expect(status).not.toBe(401)` guarded by
    // `if (status === 200)`, with a comment waiving a "stale Supabase schema
    // (e.g., missing `equity` column)" as an unrelated bug. That waiver was
    // load-bearing: prod really was missing `equity`, `net_worth` and
    // `positions_json`, this route really was returning 500 on every call,
    // and the daily snapshot cron ("0 22 * * 1-5") had therefore never
    // written a row. The suite stayed green through all of it because the
    // only hard assertion was about the 401 path.
    //
    // Fixed by supabase/migrations/20260909_portfolio_snapshots_missing_columns.sql.
    // Keep this strict — it is the dead-man switch for that drift returning.
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.snapshots)).toBe(true);
  });
});
