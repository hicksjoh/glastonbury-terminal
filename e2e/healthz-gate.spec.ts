import { test, expect, request as playwrightRequest } from '@playwright/test';

/**
 * Acceptance test for P0-3 (hardening/p0-codex-fixes).
 *
 * /api/healthz must be public, minimal, and safe for uptime probes.
 * /api/health must require auth and not expose `recentApiCalls`.
 */
test.describe('@smoke P0-3 — Health endpoint split', () => {
  test('GET /api/healthz is public and emits only { status, timestamp }', async ({ baseURL }) => {
    // Use a fresh, cookie-less request context so this really is "anonymous".
    const ctx = await playwrightRequest.newContext({ baseURL });
    const res = await ctx.get('/api/healthz');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');

    // No leakage of internals.
    const forbidden = ['services', 'rateLimits', 'circuits', 'recentApiCalls', 'environment'];
    for (const key of forbidden) {
      expect(body).not.toHaveProperty(key);
    }
    await ctx.dispose();
  });

  test('GET /api/health requires authentication', async ({ baseURL }) => {
    const ctx = await playwrightRequest.newContext({ baseURL });
    const res = await ctx.get('/api/health');
    // Middleware returns 401 JSON for protected /api/* routes.
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('Authenticated GET /api/health does not include recentApiCalls', async ({ request }) => {
    const res = await request.get('/api/health');
    // 200 if everything's healthy, 503 if critical — both are valid response
    // bodies for this test; we only care about the shape.
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body.services).toBeDefined();
    expect(body).not.toHaveProperty('recentApiCalls');
  });
});
