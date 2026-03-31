import { test, expect } from '@playwright/test';
import { collectConsoleErrors, expectNoConsoleErrors } from './helpers/test-utils';

test.describe('Options Screener', () => {

  test('Screener page loads with preset buttons', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/trading/options/screener');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=/Screener/i').first()).toBeVisible({ timeout: 10000 });

    // Check for at least some preset buttons
    const presets = ['Covered Call', 'High IV', 'Iron Condor'];
    for (const preset of presets) {
      await expect(page.locator('button', { hasText: new RegExp(preset, 'i') }).first()).toBeVisible();
    }

    expectNoConsoleErrors(errors);
  });

  test('Clicking preset scan does not crash', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/trading/options/screener');
    await page.waitForLoadState('networkidle');

    const preset = page.locator('button', { hasText: /High IV/i }).first();
    await expect(preset).toBeVisible({ timeout: 10000 });
    await preset.click();
    await page.waitForTimeout(5000);

    // Should not crash — may show empty results (that's OK for paper account)
    await expect(page.locator('text=Application error')).not.toBeVisible();

    expectNoConsoleErrors(errors);
  });

  test('Custom filter inputs work without errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/trading/options/screener');

    // Fill in filter fields
    const ivMin = page.locator('input[placeholder*="min"]').first();
    const ivMax = page.locator('input[placeholder*="max"]').first();

    if (await ivMin.isVisible()) await ivMin.fill('30');
    if (await ivMax.isVisible()) await ivMax.fill('80');

    // Click Scan
    const scanButton = page.locator('button', { hasText: /scan/i }).first();
    if (await scanButton.isVisible()) {
      await scanButton.click();
      await page.waitForTimeout(3000);
    }

    await expect(page.locator('text=Application error')).not.toBeVisible();
    expectNoConsoleErrors(errors);
  });
});
