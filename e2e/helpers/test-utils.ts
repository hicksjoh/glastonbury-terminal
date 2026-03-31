import { Page, expect } from '@playwright/test';

/**
 * Verify a page loads without crashing.
 * Checks for: HTTP 200, no "Application error", no client-side exceptions.
 */
export async function expectPageLoads(page: Page, url: string) {
  const response = await page.goto(url);

  // Check HTTP status
  expect(response?.status()).toBe(200);

  // Check no Next.js application error
  const errorText = page.locator('text=Application error');
  await expect(errorText).not.toBeVisible({ timeout: 5000 });

  // Check no blank page (body has content)
  const body = page.locator('body');
  await expect(body).not.toBeEmpty();
}

/**
 * Check browser console for errors after an action.
 * Returns array of error messages found.
 */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    errors.push(err.message);
  });
  return errors;
}

/**
 * Verify no console errors occurred.
 * Call this AFTER performing actions on the page.
 */
export function expectNoConsoleErrors(errors: string[]) {
  // Filter out known benign errors (third-party scripts, hydration, resource loads)
  const realErrors = errors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('third-party') &&
    !e.includes('hydration') &&
    !e.includes('Minified React error #418') && // hydration text mismatch
    !e.includes('Minified React error #423') && // hydration mismatch
    !e.includes('Minified React error #425') && // hydration content mismatch
    !e.includes('Failed to load resource')       // 404s for optional assets/APIs
  );

  expect(realErrors, `Console errors found:\n${realErrors.join('\n')}`).toHaveLength(0);
}

/**
 * Wait for API data to load (no more loading spinners/skeletons).
 */
export async function waitForDataLoad(page: Page, timeout = 10000) {
  // Wait for any loading indicators to disappear
  const loader = page.locator('[class*="animate-pulse"], [class*="skeleton"], [class*="loading"], [class*="spinner"]');
  if (await loader.count() > 0) {
    await expect(loader.first()).not.toBeVisible({ timeout });
  }
  // Small buffer for React render
  await page.waitForTimeout(500);
}

/**
 * Verify sidebar navigation has all expected items.
 */
export async function expectSidebarComplete(page: Page) {
  const sidebar = page.locator('nav, [class*="sidebar"]');
  await expect(sidebar).toBeVisible();

  const expectedLinks = [
    'Dashboard', 'News', 'Watchlist', 'Sectors', 'Calendar',
    'Trading', 'Screener', 'Strategies', 'Monte Carlo', 'Keisha AI'
  ];

  for (const link of expectedLinks) {
    await expect(sidebar.locator(`text=${link}`)).toBeVisible();
  }
}
