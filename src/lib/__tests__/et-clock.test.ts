import { describe, it, expect } from 'vitest';
import { getGreeting, getLongDateLabel, APP_TIME_ZONE } from '../et-clock';

/**
 * These helpers exist to kill a hydration mismatch: the dashboard used to call
 * `new Date().getHours()` / `toLocaleDateString()` during render. On Vercel the
 * server runs in UTC while the browser runs in ET, so server and client produced
 * different text and React bailed out with #425 on every dashboard load.
 *
 * Pinning to America/New_York makes the result identical no matter what the
 * host timezone is. Each case below is an instant where UTC and ET disagree
 * about the hour bucket AND the calendar day — so a naive local-time
 * implementation fails these on a UTC CI runner.
 */
describe('et-clock', () => {
  it('pins to America/New_York', () => {
    expect(APP_TIME_ZONE).toBe('America/New_York');
  });

  describe('getGreeting', () => {
    it('says "Good evening" at 00:58 UTC (= 20:58 previous day ET)', () => {
      // Naive UTC hour is 0 -> would wrongly say "Good morning".
      expect(getGreeting(new Date('2026-08-31T00:58:00Z'))).toBe('Good evening');
    });

    it('says "Good morning" at 13:00 UTC (= 09:00 ET)', () => {
      expect(getGreeting(new Date('2026-08-31T13:00:00Z'))).toBe('Good morning');
    });

    it('says "Good afternoon" at 17:00 UTC (= 13:00 ET)', () => {
      // Naive UTC hour is 17 -> would wrongly say "Good evening".
      expect(getGreeting(new Date('2026-08-31T17:00:00Z'))).toBe('Good afternoon');
    });

    it('flips to afternoon exactly at 12:00 ET, not before', () => {
      expect(getGreeting(new Date('2026-08-31T15:59:00Z'))).toBe('Good morning');
      expect(getGreeting(new Date('2026-08-31T16:00:00Z'))).toBe('Good afternoon');
    });

    it('flips to evening exactly at 17:00 ET', () => {
      expect(getGreeting(new Date('2026-08-31T20:59:00Z'))).toBe('Good afternoon');
      expect(getGreeting(new Date('2026-08-31T21:00:00Z'))).toBe('Good evening');
    });
  });

  describe('getLongDateLabel', () => {
    it('reports the ET calendar day, not the UTC one', () => {
      // 00:58 UTC on Aug 31 is still Aug 30 in ET.
      expect(getLongDateLabel(new Date('2026-08-31T00:58:00Z'))).toBe('Sunday, August 30, 2026');
    });

    it('formats a midday instant unambiguously', () => {
      expect(getLongDateLabel(new Date('2026-08-31T16:00:00Z'))).toBe('Monday, August 31, 2026');
    });
  });

  it('is stable across repeated calls for the same instant', () => {
    const at = new Date('2026-08-31T00:58:00Z');
    expect(getGreeting(at)).toBe(getGreeting(at));
    expect(getLongDateLabel(at)).toBe(getLongDateLabel(at));
  });
});
