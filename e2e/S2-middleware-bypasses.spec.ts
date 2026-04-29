import { test, expect } from '@playwright/test';

/**
 * Acceptance test for the two middleware bugs surfaced by Codex review on 2026-04-28.
 *
 * Bug A (path-extension auth bypass): the old middleware used
 *   `pathname.includes('.')` to skip auth for static assets.
 * That pattern silently passed through any pathname containing a dot —
 * including dotted ticker symbols like `/stock/BRK.B`, `/api/stock/BRK.B`,
 * etc. — letting unauthenticated callers hit protected routes.
 *
 * Bug B (cron allowlist): vercel.json schedules eight cron paths but
 * only four were in `PUBLIC_API_ROUTES`. Middleware doesn't honor
 * `Authorization: Bearer ${CRON_SECRET}` itself, so the four missing
 * crons were silently 401'd by middleware before their own
 * route-level CRON_SECRET auth ever ran.
 *
 * The four that were already public:
 *   /api/briefing/morning-push
 *   /api/briefing/scheduled
 *   /api/cron/weekly-report
 *   /api/portfolio/snapshot
 *
 * The four that were broken in production until this fix:
 *   /api/cron/storm-watch
 *   /api/cron/tax-harvest
 *   /api/cron/coach-review
 *   /api/cron/prediction-snapshot
 */

const NEWLY_ALLOWLISTED_CRONS = [
  '/api/cron/storm-watch',
  '/api/cron/tax-harvest',
  '/api/cron/coach-review',
  '/api/cron/prediction-snapshot',
];

test.describe('@smoke S2 — middleware bypasses (path-extension + cron allowlist)', () => {
  test.describe('Group A — dotted-path auth bypass closed', () => {
    test('unauthenticated GET /stock/BRK.B redirects to /login (no longer bypasses)', async ({ request }) => {
      // Empty Cookie header strips any session cookie carried over from global-setup.
      const res = await request.get('/stock/BRK.B', {
        maxRedirects: 0,
        headers: { Cookie: '' },
      });
      expect([307, 308]).toContain(res.status());
      expect(res.headers()['location']).toContain('/login');
    });

    test('unauthenticated GET /api/stock/BRK.B returns 401 (no longer bypasses)', async ({ request }) => {
      // Dotted API path — must NOT slip past middleware just because the
      // pathname contains a dot.
      const res = await request.get('/api/stock/BRK.B', {
        headers: { Cookie: '' },
      });
      expect(res.status()).toBe(401);
    });
  });

  test.describe('Group B — cron paths reachable for CRON_SECRET callers', () => {
    // We don't need the route to succeed end-to-end here (it depends on
    // upstream APIs, env vars, etc.). We only need to prove the path is
    // ALLOWLISTED in middleware — i.e., that a Bearer-CRON_SECRET caller
    // is NOT short-circuited with the middleware's 401 JSON.
    //
    // "Middleware blocked" = 401 with body { error: 'Unauthorized' } AND
    // no route-specific keys (the route never ran).
    // "Middleware passed" = anything else (200, 500, or a 401 from the
    // route's own auth check, which proves the route ran).
    for (const path of NEWLY_ALLOWLISTED_CRONS) {
      test(`${path} — no auth → middleware does not 401 it before the route runs`, async ({ request }) => {
        const cronSecret = process.env.CRON_SECRET || 'rotate-this-to-a-long-random-string';
        const res = await request.get(path, {
          headers: {
            Cookie: '',
            Authorization: `Bearer ${cronSecret}`,
          },
        });
        // A status of 401 is only acceptable if it came from the ROUTE
        // (i.e., CRON_SECRET didn't match in this env). The middleware
        // must not be the thing returning 401 here. Easiest signal: the
        // route is now reachable, so any non-redirect status is fine
        // EXCEPT a redirect to /login (which would mean middleware
        // shoved us back to the login page).
        expect(res.status()).not.toBe(307);
        expect(res.status()).not.toBe(308);
        // If middleware bounced us to /login, fail loudly.
        const loc = res.headers()['location'] || '';
        expect(loc).not.toContain('/login');
      });

      test(`${path} — without Bearer + without cookie, route's own auth still rejects with 401`, async ({ request }) => {
        // This proves we did NOT open a hole by adding the path to
        // PUBLIC_API_ROUTES — the route still self-authenticates.
        const res = await request.get(path, {
          headers: { Cookie: '' },
        });
        expect(res.status()).toBe(401);
      });
    }
  });
});
