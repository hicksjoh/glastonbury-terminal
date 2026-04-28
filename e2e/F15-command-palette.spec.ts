import { test, expect } from '@playwright/test';

/**
 * Acceptance test for F15 — ⌘K command palette.
 *
 * The component (src/components/CommandBar.tsx) and its mount point
 * (src/app/layout.tsx:48) were already in place before Wave 1 started —
 * this test exists as a regression guard to prove it stays live as
 * features get added that might accidentally clobber the global
 * keydown listener or unmount the palette.
 */
test.describe('@smoke F15 — ⌘K command palette', () => {
  test('Cmd+K (and /) opens the palette; Escape closes it', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The palette is mounted but hidden until opened. The opening is done
    // entirely in JS via a keydown listener on window.
    await page.keyboard.press('ControlOrMeta+k');

    // The input has a visible placeholder once the palette opens.
    const input = page.getByPlaceholder(/search|type to find|jump to/i).first();
    await expect(input).toBeVisible({ timeout: 2_000 });

    // Type a partial page name — "wealth" should match the Wealth page.
    await input.fill('wealth');

    // Use Enter to navigate into whatever is selected by default (top hit).
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/wealth/i, { timeout: 5_000 });
    expect(page.url()).toMatch(/\/wealth/i);

    // Open again on the new page with `/` shortcut, ensuring the global
    // listener survives navigation.
    await page.keyboard.press('/');
    await expect(input).toBeVisible({ timeout: 2_000 });

    // Escape closes.
    await page.keyboard.press('Escape');
    await expect(input).toBeHidden({ timeout: 2_000 });
  });
});
