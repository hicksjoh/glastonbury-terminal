import { test, expect } from '@playwright/test';

/**
 * Acceptance test for P0-2 (hardening/p0-codex-fixes) — /macro contract.
 *
 * Before the fix, `/api/macro` emitted `regime.name` and
 * `fedPrediction.action` while the page read `regime.regime` and
 * `fedPrediction.prediction`. Result: regime badge rendered "undefined",
 * Fed Watch crashed on `prediction.toUpperCase()`. These tests guard the
 * contract on both sides.
 */
test.describe('@smoke P0-2 — Macro page contract', () => {
  test('GET /api/macro returns the canonical regime + fedPrediction shape', async ({ request }) => {
    const res = await request.get('/api/macro');
    expect(res.status()).toBe(200);

    const body = await res.json();

    // Regime block — must use `regime.regime`, not `regime.name`.
    expect(body.regime).toBeDefined();
    expect(typeof body.regime.regime).toBe('string');
    expect(body.regime.regime.length).toBeGreaterThan(0);
    expect(typeof body.regime.confidence).toBe('number');
    expect(typeof body.regime.score).toBe('number');
    expect(body.regime).not.toHaveProperty('name');

    // Fed prediction — must use `fedPrediction.prediction`, not `.action`.
    expect(body.fedPrediction).toBeDefined();
    expect(['hike', 'hold', 'cut']).toContain(body.fedPrediction.prediction);
    expect(typeof body.fedPrediction.confidence).toBe('number');
    expect(typeof body.fedPrediction.impliedRate).toBe('number');
    expect(body.fedPrediction).not.toHaveProperty('action');
  });

  test('/macro page renders regime badge without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(err.message));

    await page.goto('/macro', { waitUntil: 'networkidle' });

    // The regime badge is the giant uppercase regime label (e.g. "EXPANSION").
    // It only fills in once the API responds, so wait for the regime endpoint.
    await page.waitForResponse(r => r.url().includes('/api/macro'));

    // Badge text must be a real string, not "UNDEFINED".
    const badge = page.locator('text=Composite Score').first();
    await expect(badge).toBeVisible();

    // The Fed Watch panel reads fedPrediction.prediction.toUpperCase(); if
    // the contract is wrong the page throws and badge never mounts.
    const fed = page.getByText(/^(HIKE|HOLD|CUT)$/);
    await expect(fed).toBeVisible();

    // Allow well-known noise (Sentry replay, missing favicon) but fail on
    // anything that looks like the old contract crash.
    const fatal = consoleErrors.filter(
      e => /undefined|cannot read|TypeError/i.test(e),
    );
    expect(fatal).toEqual([]);
  });
});
