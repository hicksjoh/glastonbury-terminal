import { test, expect } from '@playwright/test';

/**
 * S2 cron-auth hardening — the four cron routes added to middleware's
 * PUBLIC_API_ROUTES allowlist must self-authenticate. Codex round-2 review
 * caught three regressions:
 *
 *   (1) tax-harvest, coach-review, prediction-snapshot accepted manual
 *       auth via cookie-PRESENCE only (no JWT verification).
 *   (2) All four routes failed OPEN when CRON_SECRET env was unset.
 *   (3) storm-watch's `?mock=miami` query bypassed auth entirely.
 *
 * These tests confirm the fix landed. The Playwright global-setup writes
 * a valid gt-auth JWT to e2e/.auth-state.json, so we override cookies
 * explicitly when probing unauth/forged paths.
 */

const ROUTES_WITH_COOKIE_AUTH = [
  '/api/cron/tax-harvest',
  '/api/cron/coach-review',
  '/api/cron/prediction-snapshot',
] as const;

const ALL_FOUR_ROUTES = [
  '/api/cron/storm-watch',
  '/api/cron/tax-harvest',
  '/api/cron/coach-review',
  '/api/cron/prediction-snapshot',
] as const;

test.describe('@smoke S2 cron-route auth — public allowlist requires self-auth', () => {
  for (const route of ALL_FOUR_ROUTES) {
    test(`${route}: rejects no-auth (401)`, async ({ request }) => {
      const res = await request.get(route, { headers: { Cookie: '' } });
      expect(res.status()).toBe(401);
    });

    test(`${route}: rejects Bearer with wrong secret (401)`, async ({ request }) => {
      const res = await request.get(route, {
        headers: {
          Cookie: '',
          Authorization: 'Bearer this-is-not-the-real-secret',
        },
      });
      expect(res.status()).toBe(401);
    });
  }

  for (const route of ROUTES_WITH_COOKIE_AUTH) {
    test(`${route}: rejects forged gt-auth=garbage cookie (401)`, async ({ request }) => {
      // Pre-fix: routes only checked cookie PRESENCE, so this would 200.
      // Post-fix: verifySessionJwt(garbage) → null → 401.
      const res = await request.get(route, {
        headers: { Cookie: 'gt-auth=garbage-not-a-real-jwt' },
      });
      expect(res.status()).toBe(401);
    });
  }

  test('/api/cron/storm-watch?mock=miami without auth is rejected (401)', async ({ request }) => {
    // Pre-fix: route returned 200 with synthetic mock storm because the
    // mock query string short-circuited the auth check.
    const res = await request.get('/api/cron/storm-watch?mock=miami', {
      headers: { Cookie: '' },
    });
    expect(res.status()).toBe(401);
  });

  // Bearer-success path is gated on E2E_CRON_SECRET so CI doesn't burn API
  // calls. We only assert "not 401" since downstream services may 5xx in CI.
  test.describe('Bearer with correct CRON_SECRET passes auth', () => {
    for (const route of ALL_FOUR_ROUTES) {
      test(`${route}: Bearer + correct CRON_SECRET is not 401`, async ({ request }) => {
        const secret = process.env.E2E_CRON_SECRET;
        test.skip(!secret, 'E2E_CRON_SECRET not provided');
        const res = await request.get(route, {
          headers: {
            Cookie: '',
            Authorization: `Bearer ${secret}`,
          },
        });
        expect(res.status()).not.toBe(401);
      });
    }
  });
});
