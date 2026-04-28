import { test, expect } from '@playwright/test';

/**
 * Acceptance test for F7 — AI Fed hawkish/dovish sentiment scorer.
 *
 * The route at /api/fed-sentiment returns cached scores from Supabase.
 * It degrades gracefully (empty array + 200) when:
 *   - Supabase table isn't migrated yet (Wes hasn't run the SQL)
 *   - Scoring hasn't been triggered yet
 *   - Fed's RSS feed is down
 *
 * This smoke test verifies the shape + degrade-gracefully contract.
 * We do NOT force ?rescore=true here because that would burn Claude
 * tokens on every CI run.
 */
test.describe('@smoke F7 — Fed sentiment scorer', () => {
  test('returns well-formed response even with empty scores', async ({ request }) => {
    const res = await request.get('/api/fed-sentiment');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.source).toContain('federalreserve.gov');
    expect(Array.isArray(body.scores)).toBe(true);
    expect(body.summary).toBeDefined();
    expect(typeof body.summary.count).toBe('number');

    if (body.scores.length > 0) {
      const s = body.scores[0];
      expect(s.url).toMatch(/^https?:\/\//);
      expect(s.title).toBeTruthy();
      expect(typeof s.score).toBe('number');
      expect(s.score).toBeGreaterThanOrEqual(-1);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(typeof s.confidence).toBe('number');
      expect(Array.isArray(s.keyPhrases)).toBe(true);
      expect(typeof s.reasoning).toBe('string');
    }
  });

  test('respects the limit param', async ({ request }) => {
    const res = await request.get('/api/fed-sentiment?limit=3');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.scores.length).toBeLessThanOrEqual(3);
  });
});
