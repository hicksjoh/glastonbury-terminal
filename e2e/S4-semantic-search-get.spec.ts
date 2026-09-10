import { test, expect } from '@playwright/test';

/**
 * Regression test for GET /api/search/semantic.
 *
 * The GET handler used to build a synthetic `new Request(...)` and hand it to
 * POST via `POST(synth as NextRequest)`. A plain Request has no `.cookies`,
 * so `getRateLimitIdentity()` (src/lib/rate-limit-durable.ts) threw
 * `TypeError: Cannot read properties of undefined (reading 'get')` on the
 * very first line of the handler. Every GET returned a bare 500 with an
 * empty body. The `as NextRequest` cast was a lie the compiler accepted.
 *
 * No e2e test referenced this route at all, so nightly smoke never saw it.
 *
 * Both verbs now share `handleSearch(req, params)` and receive the real
 * NextRequest. A 503 (embeddings unconfigured) is an acceptable pass — the
 * point is that the handler is REACHED and answers structurally, instead of
 * crashing before it can decide anything.
 */
test.describe('@smoke S4 — GET /api/search/semantic does not crash', () => {
  test('GET with a query returns a structured response, never a bare 500', async ({ request }) => {
    const res = await request.get('/api/search/semantic?q=AAPL&limit=5');

    expect(res.status()).not.toBe(500);
    expect([200, 400, 429, 503]).toContain(res.status());

    // Whatever the outcome, it must be JSON with the documented envelope.
    const body = await res.json();
    expect(body).toHaveProperty('hits');
  });

  test('GET and POST agree on status for the same query', async ({ request }) => {
    // The two verbs share one handler now; drift between them is the bug.
    const getRes = await request.get('/api/search/semantic?q=AAPL');
    const postRes = await request.post('/api/search/semantic', { data: { query: 'AAPL' } });
    expect(getRes.status()).toBe(postRes.status());
  });
});
