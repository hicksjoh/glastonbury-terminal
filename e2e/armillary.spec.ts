import { test, expect } from '@playwright/test';
import { collectConsoleErrors, expectNoConsoleErrors } from './helpers/test-utils';

/**
 * Acceptance test for the armillary (the 3D instrument from Telos).
 *
 * - The model and its poster are served as root-level files from /public, so
 *   the middleware's static-asset rule lets them through without a session:
 *   the login page needs them before anyone has signed in.
 * - /login shows the instrument behind the access-code card, with no data.
 * - The dashboard's Wealth Breakdown card shows one orb per piece of net worth,
 *   sized by its share, from the same /api/wealth numbers as the legend.
 *
 * The scene falls back to the still poster when WebGL is unavailable, so the
 * tests accept either state ("live" or "poster") and only require no errors.
 */

const WEALTH = {
  success: true,
  data: {
    total_net_worth: 2_000_000,
    trading_mode: 'paper',
    breakdown: {
      franchise:   { value: 1_000_000 },
      real_estate: { value:   400_000 },
      investments: { value:   300_000 },
      rsus:        { value:   200_000 },
      cash:        { value:   100_000 },
    },
  },
};

test.describe('Armillary — public assets and login', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('model and poster are served without a session', async ({ request }) => {
    const model = await request.get('/armillary.json');
    expect(model.status()).toBe(200);
    const body = await model.json();
    expect(body.format).toBe('glb');
    expect(typeof body.glb).toBe('string');
    expect(body.glb.length).toBeGreaterThan(100_000);

    const poster = await request.get('/armillary-poster.jpg');
    expect(poster.status()).toBe(200);
    expect(poster.headers()['content-type']).toContain('image/jpeg');
  });

  test('login page shows the instrument behind the access form', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/login');
    const sphere = page.getByTestId('armillary');
    await expect(sphere).toBeVisible();
    await expect(sphere).toHaveAttribute('aria-hidden', 'true');
    await expect(sphere).toHaveAttribute('data-state', /^(live|poster)$/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: /Glastonbury Terminal/i })).toBeVisible();
    await expect(page.getByLabel('Access code')).toBeVisible();
    await expect(page.getByRole('button', { name: /Access Terminal/i })).toBeVisible();
    // the instrument readout: Eastern time, Miami's coordinates, the market session
    const readout = page.getByTestId('login-readout');
    await expect(readout).toContainText(/\d{1,2}:\d{2}\s?(AM|PM) ET/);
    await expect(readout).toContainText('25.76° N');
    await expect(readout).toContainText(/Market Open|Pre-Market|After Hours|Market Closed/i);
    expectNoConsoleErrors(errors);
  });

  test('login says why a code was refused, without touching the real sign-in', async ({ page }) => {
    // Answers come from page.route, so no real attempt reaches the rate limiter.
    // Swap the PWA worker for an empty one so it can't answer the POST itself.
    await page.context().route('**/sw.js', route =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* test: no-op worker */' }));
    let answer = { status: 401, json: { error: 'Invalid password' } };
    await page.route('**/api/auth/login', route => route.fulfill(answer));
    await page.goto('/login');

    const code = page.getByLabel('Access code');
    await code.fill('not-the-code');
    await page.getByRole('button', { name: /Access Terminal/i }).click();
    await expect(page.getByTestId('login-message')).toContainText(/didn.t work/i);
    await expect(code).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('login-message')).toHaveAttribute('role', 'alert');

    answer = { status: 429, json: { error: 'Too many requests' } };
    await page.getByRole('button', { name: /Access Terminal/i }).click();
    await expect(page.getByTestId('login-message')).toContainText(/too many tries/i);

    answer = { status: 503, json: { error: 'degraded' } };
    await page.getByRole('button', { name: /Access Terminal/i }).click();
    await expect(page.getByTestId('login-message')).toContainText(/unavailable/i);
  });
});

test.describe('Armillary — dashboard wealth orbs', () => {
  test('Wealth Breakdown shows one orb per piece of net worth, sized by share', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    // Swap the PWA service worker for an empty one: the real worker answers
    // /api/wealth itself, past page.route's mock. The worker script is fetched
    // outside the page, so only a context-level route reaches it.
    await page.context().route('**/sw.js', route =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* test: no-op worker */' }));
    await page.route('**/api/wealth', route => route.fulfill({ json: WEALTH }));
    await page.goto('/');

    const card = page.getByTestId('wealth-breakdown');
    const sphere = card.getByTestId('armillary');
    await expect(sphere).toBeVisible({ timeout: 15000 });
    await expect(sphere).toHaveAttribute('data-orbs', '5');
    await expect(sphere).toHaveAttribute('aria-label', /CR3 Franchise 50%/);
    await expect(sphere).toHaveAttribute('aria-label', /Cash 5%/);
    await expect(sphere).toHaveAttribute('data-state', /^(live|poster)$/, { timeout: 15000 });

    // The legend rows pick an orb.
    const rsus = card.getByRole('button', { name: /Anthropic RSUs/ });
    await rsus.click();
    await expect(rsus).toHaveAttribute('aria-pressed', 'true');
    await expect(sphere).toHaveAttribute('data-selected', 'anthropicRSUs');
    await rsus.click();
    await expect(rsus).toHaveAttribute('aria-pressed', 'false');

    expectNoConsoleErrors(errors);
  });
});
