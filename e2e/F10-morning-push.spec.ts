import { test, expect } from '@playwright/test';

/**
 * Acceptance test for F10 — 6:30 AM morning push.
 *
 * Runs via Vercel cron at 30 10 * * 1-5 (6:30 AM EDT). Unlike the deep
 * briefing it skips Claude so delivery is sub-second reliable. This test
 * verifies: unauth returns 401, authed returns a usable payload shape,
 * payload includes the push title/body that will land on the iPhone.
 *
 * We intentionally do NOT POST this test from the shared auth context
 * because morning-push is a cron/service route and should only accept
 * the CRON_SECRET header (not a user JWT cookie). Run with:
 *   E2E_CRON_SECRET=<value> npx playwright test F10
 */
test.describe('@smoke F10 — 6:30 AM morning push', () => {
  test('rejects unauthenticated POST with 401', async ({ request }) => {
    const res = await request.post('/api/briefing/morning-push', {
      data: {},
      headers: { Authorization: '' },
    });
    expect(res.status()).toBe(401);
  });

  test('returns usable payload with CRON_SECRET bearer', async ({ request }) => {
    const secret = process.env.E2E_CRON_SECRET;
    test.skip(!secret, 'E2E_CRON_SECRET not provided — skipping authed path');

    const res = await request.post('/api/briefing/morning-push', {
      data: {},
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.subscribers).toBe('number');
    expect(typeof body.sent).toBe('number');
    expect(typeof body.pruned).toBe('number');
    expect(body.payload).toBeDefined();
    expect(body.payload.title).toContain('Morning');
    // Body should contain at least the equity segment.
    expect(typeof body.payload.body).toBe('string');
    expect(body.payload.body.length).toBeGreaterThan(0);
  });
});
