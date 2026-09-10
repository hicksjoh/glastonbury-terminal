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

    // Every non-2xx branch of this route now returns `hits: []` alongside
    // `error` — including 429, which used to be the odd one out. That
    // uniformity is deliberate: a caller can read `.hits` without first
    // branching on status. Assert it holds for whatever status comes back.
    const body = await res.json();
    expect(body).toHaveProperty('hits');
    if (res.status() !== 200) expect(body).toHaveProperty('error');
  });

  test('GET and POST agree on status for the same query', async ({ request }) => {
    // Both verbs share preflight() + handleSearch(); drift between them is the bug.
    // Each call consumes its own slot in the 30-per-60s durable limiter, so if
    // either side trips 429 the comparison is meaningless rather than failing —
    // skip instead of asserting, so a busy bucket can't red the nightly.
    const getRes = await request.get('/api/search/semantic?q=AAPL');
    const postRes = await request.post('/api/search/semantic', { data: { query: 'AAPL' } });

    test.skip(
      getRes.status() === 429 || postRes.status() === 429,
      'rate limiter tripped between the two calls — nothing to compare',
    );
    expect(getRes.status()).toBe(postRes.status());
  });
});
