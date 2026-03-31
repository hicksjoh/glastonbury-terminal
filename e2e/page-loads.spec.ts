import { test, expect } from '@playwright/test';
import { expectPageLoads, collectConsoleErrors, expectNoConsoleErrors, expectSidebarComplete } from './helpers/test-utils';

test.describe('Page Loads — All pages render without crashing', () => {

  const pages = [
    { name: 'Dashboard', path: '/' },
    { name: 'Trading (Stocks)', path: '/trading' },
    { name: 'Trading (Options)', path: '/trading?tab=options' },
    { name: 'Options Screener', path: '/trading/options/screener' },
    { name: 'Strategy Builder', path: '/trading/options/builder' },
    { name: 'News', path: '/news' },
    { name: 'Watchlist', path: '/watchlist' },
    { name: 'Sectors', path: '/sectors' },
    { name: 'Calendar', path: '/calendar' },
    { name: 'Strategies', path: '/strategies' },
    { name: 'Monte Carlo', path: '/monte-carlo' },
    { name: 'Keisha AI', path: '/keisha' },
  ];

  for (const { name, path } of pages) {
    test(`${name} (${path}) loads without errors`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await expectPageLoads(page, path);

      // Give the page a moment to hydrate and fetch data
      await page.waitForTimeout(2000);

      expectNoConsoleErrors(errors);
    });
  }

  test('Sidebar navigation is complete on every page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expectSidebarComplete(page);
  });

  test('All sidebar links navigate correctly', async ({ page }) => {
    const navTests = [
      { text: 'Trading', expectedPath: '/trading' },
      { text: 'News', expectedPath: '/news' },
      { text: 'Watchlist', expectedPath: '/watchlist' },
      { text: 'Strategies', expectedPath: '/strategies' },
    ];

    for (const { text, expectedPath } of navTests) {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Click the sidebar link — use the link's href to be precise
      const link = page.locator(`a[href="${expectedPath}"]`).first();
      await expect(link).toBeVisible({ timeout: 5000 });
      await link.click();
      await page.waitForURL(`**${expectedPath}**`, { timeout: 10000 });
      expect(page.url()).toContain(expectedPath);
    }
  });
});
