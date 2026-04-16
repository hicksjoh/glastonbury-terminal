import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isBriefingStale } from '../briefing-staleness';

describe('isBriefingStale', () => {
  const NOW = new Date('2026-04-16T21:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats null/undefined as stale (no briefing = needs one)', () => {
    expect(isBriefingStale(null)).toBe(true);
    expect(isBriefingStale(undefined)).toBe(true);
    expect(isBriefingStale('')).toBe(true);
  });

  it('returns false when briefing is 1 hour old (well within default 48h)', () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    expect(isBriefingStale(oneHourAgo)).toBe(false);
  });

  it('returns true for the Keisha bug scenario (briefing from ~9 days ago)', () => {
    const april7 = new Date('2026-04-07T10:30:00Z').toISOString();
    expect(isBriefingStale(april7)).toBe(true);
  });

  it('respects a custom maxHours threshold (24h)', () => {
    const twentyThreeHoursAgo = new Date(NOW.getTime() - 23 * 60 * 60 * 1000).toISOString();
    const twentyFiveHoursAgo = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
    expect(isBriefingStale(twentyThreeHoursAgo, 24)).toBe(false);
    expect(isBriefingStale(twentyFiveHoursAgo, 24)).toBe(true);
  });

  it('accepts Date objects as well as ISO strings', () => {
    const recent = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    expect(isBriefingStale(recent)).toBe(false);
  });

  it('treats unparseable strings as stale (defensive)', () => {
    expect(isBriefingStale('not-a-date')).toBe(true);
  });
});
