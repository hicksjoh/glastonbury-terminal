import { test, expect } from '@playwright/test';

/**
 * Acceptance test for F13 — Sunday weekly auto-email report.
 *
 * Cron route at /api/cron/weekly-report builds the report payload and
 * sends it via Resend. We exercise the dry-run path so CI doesn't burn
 * a real send. Authed with the CRON_SECRET bearer.
 */
test.describe('@smoke F13 — Sunday weekly report', () => {
  test('rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/cron/weekly-report?mode=dry-run');
    expect(res.status()).toBe(401);
  });

  test('dry-run with bearer returns subject + text preview', async ({ request }) => {
    const secret = process.env.E2E_CRON_SECRET;
    test.skip(!secret, 'E2E_CRON_SECRET not provided');

    const res = await request.get('/api/cron/weekly-report?mode=dry-run', {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.subject).toContain('Sunday Briefing');
    expect(typeof body.textPreview).toBe('string');
    expect(body.textPreview.length).toBeGreaterThan(50);
    expect(body.textPreview).toContain('NET WORTH');
  });
});
