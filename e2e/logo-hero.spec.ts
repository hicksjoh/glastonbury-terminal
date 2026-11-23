import { test, expect } from '@playwright/test';
import { collectConsoleErrors, expectNoConsoleErrors } from './helpers/test-utils';

/**
 * Acceptance test for the steel logo hero on /login.
 *
 * - The animation and its still are root-level .webp files in /public, so the
 *   middleware's static-asset rule serves them without a session (the login
 *   page needs them before anyone has signed in). The middleware is unchanged.
 * - The animation plays once and holds on the finished wordmark: the WebP's
 *   ANIM loop count is 1, not 0 (infinite).
 * - /login shows the wordmark at the top of the access card, named for screen
 *   readers, above the "Glastonbury Terminal" heading.
 */

test.describe('Logo hero — public assets and login', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('animation and still are served without a session', async ({ request }) => {
    for (const path of ['/logo-hero.webp', '/logo-hero-poster.webp']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()['content-type'], path).toContain('image/webp');
    }
  });

  test('animation plays once, then holds', async ({ request }) => {
    const res = await request.get('/logo-hero.webp');
    const buf = Buffer.from(await res.body());
    const anim = buf.indexOf('ANIM');
    expect(anim).toBeGreaterThan(0);
    // ANIM chunk: 4-byte tag, 4-byte size, 4-byte background colour, 2-byte loop count.
    expect(buf.readUInt16LE(anim + 12)).toBe(1);
  });

  test('login card shows the wordmark above the heading', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/login');
    const logo = page.getByTestId('logo-hero');
    await expect(logo).toBeVisible();
    await expect(page.getByRole('img', { name: 'The Glastonbury Group' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Glastonbury Terminal/i })).toBeVisible();
    const [logoBox, headingBox] = await Promise.all([
      logo.boundingBox(),
      page.getByRole('heading', { name: /Glastonbury Terminal/i }).boundingBox(),
    ]);
    expect(logoBox && headingBox && logoBox.y < headingBox.y).toBeTruthy();
    expectNoConsoleErrors(errors);
  });
});
