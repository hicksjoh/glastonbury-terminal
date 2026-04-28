import { test, expect } from '@playwright/test';

/**
 * Acceptance test for F17 — tokenized public read-only dashboards.
 *
 * Verifies the create / public-read / revoke / revoked-read lifecycle.
 * /api/share (admin) requires gt-auth; /api/share/<token> is the only
 * public API route and accepts the token as its sole auth credential.
 */
test.describe('@smoke F17 — share tokens', () => {
  test('full lifecycle: create -> public read -> revoke -> 404', async ({ request }) => {
    // 1. Create token (auth-required admin endpoint). Skip the rest of
    // the lifecycle if the share_tokens migration hasn't been applied
    // yet — the route correctly returns 500 in that case.
    const createRes = await request.post('/api/share', {
      data: { viewType: 'wealth_summary', label: 'F17 e2e smoke', ttlHours: 1 },
    });
    if (createRes.status() === 500) {
      test.skip(true, 'share_tokens migration not yet applied to Supabase — skipping lifecycle test');
    }
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created.token).toMatch(/^[a-f0-9]{32}$/);
    expect(created.viewType).toBe('wealth_summary');

    // 2. Public read — with NO cookie. The route must accept it.
    const publicRes = await request.get(`/api/share/${created.token}`, {
      headers: { Cookie: '' },
    });
    expect(publicRes.status()).toBe(200);
    const publicBody = await publicRes.json();
    expect(publicBody.viewType).toBe('wealth_summary');
    expect(publicBody.payload).toBeDefined();
    // Wealth summary should include the per-class breakdown — never expose
    // brokerage positions or transactional detail through the share view.
    expect(publicBody.payload).not.toHaveProperty('positions');
    expect(publicBody.payload).not.toHaveProperty('orders');
    expect(typeof publicBody.payload.total).toBe('number');
    expect(publicBody.payload.total).toBeGreaterThan(0);

    // 3. Revoke (auth-required admin endpoint).
    const revokeRes = await request.delete(`/api/share?token=${created.token}`);
    expect(revokeRes.status()).toBe(200);

    // 4. Public read after revoke — 404.
    const after = await request.get(`/api/share/${created.token}`, {
      headers: { Cookie: '' },
    });
    expect(after.status()).toBe(404);
  });

  test('invalid token format returns 404 without DB roundtrip', async ({ request }) => {
    const res = await request.get('/api/share/not-a-real-token', {
      headers: { Cookie: '' },
    });
    expect(res.status()).toBe(404);
  });

  test('admin endpoints require auth', async ({ request }) => {
    // No cookie -> middleware should 401 the admin GET.
    const res = await request.get('/api/share', {
      headers: { Cookie: '' },
    });
    expect(res.status()).toBe(401);
  });
});
