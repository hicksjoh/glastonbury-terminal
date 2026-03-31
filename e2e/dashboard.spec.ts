import { test, expect } from '@playwright/test';
import { collectConsoleErrors, expectNoConsoleErrors } from './helpers/test-utils';

test.describe('Dashboard — Options Cards Integrated', () => {

  test('Dashboard shows Options P&L and Daily Theta cards', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Text in source uses &amp; entity — match partial text
    await expect(page.locator('text=/Options P/i').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=/Daily Theta/i').first()).toBeVisible();

    // Existing cards still present
    await expect(page.locator('text=/Cash Available/i')).toBeVisible();
    await expect(page.locator('text=/Positions/i').first()).toBeVisible();
    await expect(page.locator('text=/\\$50M Progress/i')).toBeVisible();

    expectNoConsoleErrors(errors);
  });

  test('Connections panel shows all services', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Services may be displayed with varying case/labels
    const services = ['Alpaca', 'Supabase'];
    for (const service of services) {
      await expect(page.locator(`text=/${service}/i`).first()).toBeVisible({ timeout: 10000 });
    }
  });
});

test.describe('Strategies — Wheel Tracker', () => {

  test('Strategies page shows wheel tracker section', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/strategies');
    await page.waitForLoadState('networkidle');

    // Strategy cards
    await expect(page.locator('text=/Covered Call/i').first()).toBeVisible({ timeout: 10000 });

    // Wheel tracker section
    await expect(page.locator('text=/Wheel/i').first()).toBeVisible();

    expectNoConsoleErrors(errors);
  });
});
