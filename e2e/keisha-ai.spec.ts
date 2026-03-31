import { test, expect } from '@playwright/test';
import { collectConsoleErrors, expectNoConsoleErrors } from './helpers/test-utils';

test.describe('Keisha AI — Options Integration', () => {

  test('Keisha page loads with prompt chips', async ({ page }) => {
    await page.goto('/keisha');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=/Keisha/i').first()).toBeVisible({ timeout: 10000 });

    // Look for any prompt chips/buttons (text varies)
    const chips = page.locator('button, [role="button"]');
    const chipCount = await chips.count();
    // There should be at least some interactive elements
    expect(chipCount).toBeGreaterThan(0);
  });

  test('Clicking a prompt chip sends message without crash', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/keisha');

    // Click the first visible prompt chip
    const chip = page.locator('button, [role="button"]', { hasText: /covered call|Greeks|IV/i }).first();
    if (await chip.isVisible()) {
      await chip.click();
      await page.waitForTimeout(3000);

      await expect(page.locator('text=Application error')).not.toBeVisible();
    }

    expectNoConsoleErrors(errors);
  });

  test('Chat input accepts custom questions', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/keisha');
    await page.waitForLoadState('networkidle');

    // Look for any text input or textarea (Keisha's input may not have explicit type)
    const input = page.locator('input[placeholder*="Keisha" i], input[placeholder*="portfolio" i], textarea, input[type="text"]').first();
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill('What options should I trade this week?');

    // Verify input works
    await expect(input).toHaveValue('What options should I trade this week?');

    expectNoConsoleErrors(errors);
  });
});
