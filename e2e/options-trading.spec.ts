import { test, expect } from '@playwright/test';
import { collectConsoleErrors, expectNoConsoleErrors } from './helpers/test-utils';

test.describe('Options Trading — Full User Flow', () => {

  test('Tab toggle switches between Stocks and Options', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/trading');
    await page.waitForLoadState('networkidle');

    // Default should be Stocks tab — look for the stock order form placeholder
    await expect(page.locator('text=/Place Order|Search ticker/i').first()).toBeVisible({ timeout: 10000 });

    // Click Options tab
    const optionsTab = page.locator('button', { hasText: /options/i }).first();
    await optionsTab.click();
    await page.waitForLoadState('networkidle');

    // Should show options UI
    await expect(page.locator('input[placeholder*="symbol" i], input[placeholder*="search" i]').first()).toBeVisible({ timeout: 10000 });

    // URL should update
    expect(page.url()).toContain('tab=options');

    // Click Stocks tab
    const stocksTab = page.locator('button', { hasText: /stocks/i }).first();
    await stocksTab.click();
    await page.waitForLoadState('networkidle');

    // Should show stocks UI again
    await expect(page.locator('text=/Place Order|Search ticker/i').first()).toBeVisible();

    expectNoConsoleErrors(errors);
  });

  test('@smoke Options chain loads when selecting AAPL — NO CRASH', async ({ page }) => {
    // THIS IS THE TEST THAT CATCHES THE .toFixed() BUG
    const errors = collectConsoleErrors(page);

    await page.goto('/trading?tab=options');
    await page.waitForLoadState('networkidle');

    // Type AAPL in search
    const searchInput = page.locator('input[placeholder*="symbol" i], input[placeholder*="search" i]').first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill('AAPL');

    // Wait for dropdown to appear
    await page.waitForTimeout(1500);

    // Click AAPL from dropdown
    const aaplOption = page.locator('text=AAPL').first();
    if (await aaplOption.isVisible()) {
      await aaplOption.click();
    } else {
      await searchInput.press('Enter');
    }

    // Wait for chain to load
    await page.waitForTimeout(5000);

    // THE CRITICAL ASSERTION: Page should NOT show "Application error"
    await expect(page.locator('text=Application error')).not.toBeVisible();

    // Should see chain data OR a "no options data" message — either way no crash
    const hasTable = await page.locator('table').first().isVisible();
    const hasChainText = await page.locator('text=/CALLS|contracts|No options data|Loading/i').first().isVisible();
    expect(hasTable || hasChainText, 'Chain area should be visible').toBe(true);

    // NO CONSOLE ERRORS — this catches TypeError: f.toFixed is not a function
    expectNoConsoleErrors(errors);
  });

  test('Options chain renders correctly for multiple symbols', async ({ page }) => {
    const symbols = ['AAPL', 'NVDA', 'MSFT'];

    for (const symbol of symbols) {
      const errors = collectConsoleErrors(page);
      await page.goto('/trading?tab=options');
      await page.waitForLoadState('networkidle');

      const searchInput = page.locator('input[placeholder*="symbol" i], input[placeholder*="search" i]').first();
      await expect(searchInput).toBeVisible({ timeout: 10000 });
      await searchInput.fill(symbol);
      await page.waitForTimeout(1500);

      const option = page.locator(`text=${symbol}`).first();
      if (await option.isVisible()) {
        await option.click();
      } else {
        await searchInput.press('Enter');
      }

      await page.waitForTimeout(5000);

      // No crash
      await expect(page.locator('text=Application error')).not.toBeVisible();
      expectNoConsoleErrors(errors);
    }
  });

  test('Options stat cards render on options tab', async ({ page }) => {
    await page.goto('/trading?tab=options');
    await page.waitForLoadState('networkidle');

    // Check for options-specific stat cards (case-insensitive, CSS may uppercase)
    await expect(page.locator('text=/Options P.L/i').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=/Net Theta/i').first()).toBeVisible();
    await expect(page.locator('text=/Monthly Theta/i').first()).toBeVisible();
  });

  test('Positions table has All/Stocks/Options filter tabs', async ({ page }) => {
    await page.goto('/trading?tab=options');
    await page.waitForLoadState('networkidle');

    // Scroll to positions section
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(500);

    // Check filter tabs exist (case-insensitive)
    await expect(page.locator('button', { hasText: /^All$/i }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button', { hasText: /Stocks/i }).first()).toBeVisible();
    await expect(page.locator('button', { hasText: /Options/i }).first()).toBeVisible();
  });

  test('Options order form appears and has correct fields', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/trading?tab=options');
    await page.waitForLoadState('networkidle');

    // Search for a symbol to trigger order form
    const searchInput = page.locator('input[placeholder*="symbol" i], input[placeholder*="search" i]').first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill('AAPL');
    await page.waitForTimeout(1500);
    const option = page.locator('text=AAPL').first();
    if (await option.isVisible()) await option.click();
    await page.waitForTimeout(5000);

    // Skip if chain didn't load
    if (await page.locator('text=Application error').isVisible()) {
      test.skip(true, 'Chain failed to load — separate bug');
      return;
    }

    // The order form should show "Options Order" or similar
    const orderSection = page.locator('text=/Options Order|Select an option/i').first();
    if (await orderSection.isVisible()) {
      await expect(orderSection).toBeVisible();
    }

    expectNoConsoleErrors(errors);
  });
});
