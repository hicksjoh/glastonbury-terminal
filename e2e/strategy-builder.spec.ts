import { test, expect } from '@playwright/test';
import { collectConsoleErrors, expectNoConsoleErrors } from './helpers/test-utils';

test.describe('Strategy Builder', () => {

  test('Builder page loads with all template categories', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/trading/options/builder');
    await page.waitForLoadState('networkidle');

    // Page header or section title
    await expect(page.locator('text=/Strategy/i').first()).toBeVisible({ timeout: 10000 });

    // Check all template categories (rendered uppercase via CSS)
    await expect(page.locator('text=/Income/i').first()).toBeVisible();
    await expect(page.locator('text=/Directional/i').first()).toBeVisible();
    await expect(page.locator('text=/Volatility/i').first()).toBeVisible();
    await expect(page.locator('text=/Hedging/i').first()).toBeVisible();

    expectNoConsoleErrors(errors);
  });

  test('Selecting a template populates legs without crashing', async ({ page }) => {
    const templates = [
      'Covered Call', 'Cash-Secured Put', 'Iron Condor',
      'Bull Call Spread', 'Bear Put Spread', 'Long Straddle',
    ];

    for (const template of templates) {
      const errors = collectConsoleErrors(page);
      await page.goto('/trading/options/builder');
      await page.waitForLoadState('networkidle');

      const button = page.locator('button', { hasText: new RegExp(template, 'i') }).first();
      if (await button.isVisible({ timeout: 5000 })) {
        await button.click();
        await page.waitForTimeout(1500);

        // Should not crash
        await expect(page.locator('text=Application error')).not.toBeVisible();

        // Legs section should update
        const legsText = page.locator('text=/Legs \\(\\d+\\)/i');
        if (await legsText.isVisible()) {
          const text = await legsText.textContent();
          const legCount = parseInt(text?.match(/\d+/)?.[0] || '0');
          expect(legCount, `${template} should have at least 1 leg`).toBeGreaterThan(0);
        }
      }

      expectNoConsoleErrors(errors);
    }
  });

  test('Payoff diagram renders when strategy is selected', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/trading/options/builder');
    await page.waitForLoadState('networkidle');

    // Select Iron Condor (multi-leg, good test)
    const ironCondor = page.locator('button', { hasText: /Iron Condor/i }).first();
    if (await ironCondor.isVisible({ timeout: 5000 })) {
      await ironCondor.click();
      await page.waitForTimeout(2000);

      // Payoff diagram area should have content (canvas, svg, or recharts)
      const chart = page.locator('canvas, svg.recharts-surface, [class*="chart"], [class*="recharts"]');
      expect(await chart.count(), 'Payoff diagram should render').toBeGreaterThan(0);
    }

    expectNoConsoleErrors(errors);
  });

  test('Add Leg and Stock Leg buttons work', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/trading/options/builder');
    await page.waitForLoadState('networkidle');

    const addLeg = page.locator('button', { hasText: /Add Leg/i }).first();
    const addStock = page.locator('button', { hasText: /Stock Leg/i }).first();

    if (await addLeg.isVisible({ timeout: 5000 })) {
      await addLeg.click();
      await page.waitForTimeout(500);
      await expect(page.locator('text=Application error')).not.toBeVisible();
    }

    if (await addStock.isVisible({ timeout: 5000 })) {
      await addStock.click();
      await page.waitForTimeout(500);
      await expect(page.locator('text=Application error')).not.toBeVisible();
    }

    expectNoConsoleErrors(errors);
  });
});
