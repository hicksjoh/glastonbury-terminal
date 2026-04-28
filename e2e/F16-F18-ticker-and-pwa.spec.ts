import { test, expect } from '@playwright/test';

/**
 * F16 + F18 acceptance tests.
 *
 * F16: MarketTickerBar (already authored, was unmounted) is now wired into
 *      the root layout so it shows on every page. It polls /api/market-ticker
 *      every 60s and pauses when document.hidden is true.
 *
 * F18: PWA manifest + service worker + apple-mobile-web-app-* meta tags
 *      let the terminal install to the iPhone home screen as a standalone
 *      app. Web-push subscriptions (already wired in F10) flow through the
 *      installed shell.
 */
test.describe('@smoke F16 — market ticker', () => {
  test('ticker bar mounts on page load', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // The ticker fetches /api/market-ticker — the network request itself is
    // the strongest signal that the component mounted.
    const tickerRequest = page.waitForResponse(
      (res) => res.url().includes('/api/market-ticker'),
      { timeout: 10_000 },
    );
    await page.reload();
    const res = await tickerRequest;
    expect(res.status()).toBe(200);
  });
});

test.describe('@smoke F18 — PWA install', () => {
  test('manifest is served with the right shape', async ({ request }) => {
    const res = await request.get('/manifest.json');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.name).toContain('Glastonbury');
    expect(body.short_name).toBeTruthy();
    expect(body.display).toBe('standalone');
    expect(body.start_url).toBe('/');
    expect(Array.isArray(body.icons)).toBe(true);
    expect(body.icons.length).toBeGreaterThanOrEqual(3);
    // Need at least one maskable icon for adaptive Android home-screen icons.
    expect(body.icons.some((i: { purpose?: string }) => /maskable/.test(i.purpose ?? ''))).toBe(true);
  });

  test('service worker is reachable', async ({ request }) => {
    const res = await request.get('/sw.js');
    expect(res.status()).toBe(200);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/javascript/);
  });

  test('apple-mobile-web-app meta tags are present', async ({ page }) => {
    await page.goto('/');
    const capable = await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content');
    expect(capable).toBe('yes');
    const title = await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content');
    expect(title).toBe('Glastonbury');
  });
});
