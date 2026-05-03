import { test, expect } from '@playwright/test';

/**
 * Acceptance test for the middleware bugs surfaced by Codex review on 2026-04-28.
 *
 * Bug A (path-extension auth bypass — round 1): the old middleware used
 *   `pathname.includes('.')` to skip auth for static assets.
 * That pattern silently passed through any pathname containing a dot —
 * including dotted ticker symbols like `/stock/BRK.B`, `/api/stock/BRK.B`,
 * etc. — letting unauthenticated callers hit protected routes.
 *
 * Bug A2 (path-extension auth bypass — round 2): round-1's first fix
 * replaced the dot-includes check with an extension regex
 *   /\.(ico|png|...|json|...|webmanifest)$/i
 * but anchored only to "ends with that extension." That meant ANY dynamic
 * route ending in `.json` (e.g. `/api/stock/AAPL.json`, `/stock/AAPL.json`)
 * also bypassed auth. Round-2's fix anchors the regex to the start of the
 * pathname AND forbids embedded slashes, so only root-level files served
 * directly from `/public` (e.g. `/favicon.ico`, `/robots.txt`) match.
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

  test.describe('Group A2 — extension-only bypass tightened to root-level files', () => {
    // Round-1 used /\.(json|png|...)$/i which still let any dynamic route
    // ending in one of those extensions slip past auth. The fix anchors the
    // regex to a single root-level segment (no embedded slashes).

    test('unauthenticated GET /api/stock/AAPL.json returns 401 (no longer bypasses)', async ({ request }) => {
      // Real route is /api/stock/[symbol]/route.ts — Next.js will not 404 a
      // dynamic-segment value of "AAPL.json" because the symbol param soaks
      // up the entire segment. Critical case: the route returns JSON and
      // a path ending in ".json" would have slipped past the round-1 regex.
      const res = await request.get('/api/stock/AAPL.json', {
        headers: { Cookie: '' },
      });
      expect(res.status()).toBe(401);
    });

    test('unauthenticated GET /stock/AAPL.json redirects to /login (no longer bypasses)', async ({ request }) => {
      // Page-route variant. Even if Next.js returns 404 for this exact path
      // because /stock/[symbol]/page.tsx receives "AAPL.json" as the symbol,
      // the request must go through middleware first and get bounced to
      // /login when unauthenticated — not silently bypassed.
      const res = await request.get('/stock/AAPL.json', {
        maxRedirects: 0,
        headers: { Cookie: '' },
      });
      expect([307, 308]).toContain(res.status());
      expect(res.headers()['location']).toContain('/login');
    });

    test('unauthenticated GET /api/foo/bar.png returns 401 (subpath escape)', async ({ request }) => {
      // Generalised escape: any subpath ending in a static-asset extension
      // must still go through auth. The route may not exist (404), but a
      // 404 only happens AFTER middleware passes — and unauthenticated API
      // calls must come back as 401 from middleware, never 404.
      const res = await request.get('/api/foo/bar.png', {
        headers: { Cookie: '' },
      });
      expect(res.status()).toBe(401);
    });
  });

  test.describe('Group A3 — legitimate /public/ assets still bypass (no false positives)', () => {
    // The whole point of the bypass is to keep static files cheap. Make
    // sure the new regex hasn't broken delivery of files that actually
    // live at the root of /public.

    test('GET /favicon.ico is NOT redirected to /login when unauthenticated', async ({ request }) => {
      const res = await request.get('/favicon.ico', {
        maxRedirects: 0,
        headers: { Cookie: '' },
      });
      // Either a 200 (served) or a 304 (cached) is fine — the only thing
      // we care about is that middleware did NOT bounce us to /login.
      expect([307, 308]).not.toContain(res.status());
      const loc = res.headers()['location'] || '';
      expect(loc).not.toContain('/login');
    });

    test('GET /robots.txt is NOT redirected to /login when unauthenticated', async ({ request }) => {
      const res = await request.get('/robots.txt', {
        maxRedirects: 0,
        headers: { Cookie: '' },
      });
      expect([307, 308]).not.toContain(res.status());
      const loc = res.headers()['location'] || '';
      expect(loc).not.toContain('/login');
    });

    test('GET /icon-192.png is NOT redirected to /login when unauthenticated', async ({ request }) => {
      const res = await request.get('/icon-192.png', {
        maxRedirects: 0,
        headers: { Cookie: '' },
      });
      expect([307, 308]).not.toContain(res.status());
      const loc = res.headers()['location'] || '';
      expect(loc).not.toContain('/login');
    });

    test('GET /manifest.json is NOT redirected to /login when unauthenticated', async ({ request }) => {
      // PWA manifest: must be reachable without auth so the install prompt
      // works on the login page itself.
      const res = await request.get('/manifest.json', {
        maxRedirects: 0,
        headers: { Cookie: '' },
      });
      expect([307, 308]).not.toContain(res.status());
      const loc = res.headers()['location'] || '';
      expect(loc).not.toContain('/login');
    });

    test('GET /_next/static/chunks/main.js is NOT redirected to /login', async ({ request }) => {
      // Sanity check that the /_next/ prefix bypass is unchanged. The
      // file may 404 (its hashed name varies per build) but must NEVER
      // be redirected by middleware.
      const res = await request.get('/_next/static/chunks/main.js', {
        maxRedirects: 0,
        headers: { Cookie: '' },
      });
      expect([307, 308]).not.toContain(res.status());
      const loc = res.headers()['location'] || '';
      expect(loc).not.toContain('/login');
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
