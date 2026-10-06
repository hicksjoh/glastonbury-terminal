import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/alpaca', () => ({ getSnapshots: vi.fn() }));
vi.mock('@/lib/fmp-client', () => ({ getQuote: vi.fn(), isFmpRateLimited: vi.fn() }));

import { getSnapshots } from '@/lib/alpaca';
import { getQuote, isFmpRateLimited } from '@/lib/fmp-client';
import { getLiveQuotes, quoteFromSnapshot } from '../watchlist-quotes';

const snaps = vi.mocked(getSnapshots);
const fmpQuote = vi.mocked(getQuote);
const fmpLimited = vi.mocked(isFmpRateLimited);

beforeEach(() => {
  vi.resetAllMocks();
  fmpLimited.mockReturnValue(false);
});

describe('quoteFromSnapshot', () => {
  it('prefers latest trade and computes change vs previous close', () => {
    const q = quoteFromSnapshot('NVDA', {
      latestTrade: { p: 110, t: '2026-10-05T19:59:00Z' },
      dailyBar: { c: 109 },
      prevDailyBar: { c: 100 },
    });
    expect(q).toEqual({
      symbol: 'NVDA', price: 110, prevClose: 100, changePct: 10,
      asOf: '2026-10-05T19:59:00Z', source: 'alpaca',
    });
  });

  it('falls back to the daily bar close', () => {
    const q = quoteFromSnapshot('SPY', { latestTrade: null, dailyBar: { c: 500, t: 't1' } });
    expect(q?.price).toBe(500);
    expect(q?.asOf).toBe('t1');
    expect(q?.changePct).toBeNull();
  });

  it('returns null rather than inventing a price', () => {
    expect(quoteFromSnapshot('X', undefined)).toBeNull();
    expect(quoteFromSnapshot('X', { latestTrade: { p: 0 } })).toBeNull();
  });
});

describe('getLiveQuotes', () => {
  it('uses one Alpaca batch call and only falls back to FMP for misses', async () => {
    snaps.mockResolvedValue({ SPY: { latestTrade: { p: 500 } } });
    fmpQuote.mockResolvedValue({ symbol: 'BLDR', price: 150, changePercentage: 1.5 } as never);

    const out = await getLiveQuotes(['spy', 'BLDR']);

    expect(snaps).toHaveBeenCalledTimes(1);
    expect(fmpQuote).toHaveBeenCalledTimes(1);
    expect(fmpQuote).toHaveBeenCalledWith('BLDR');
    expect(out.get('SPY')?.source).toBe('alpaca');
    expect(out.get('BLDR')).toMatchObject({ price: 150, source: 'fmp', changePct: 1.5 });
  });

  it('skips FMP while the rate-limit latch is set', async () => {
    snaps.mockResolvedValue({});
    fmpLimited.mockReturnValue(true);
    const out = await getLiveQuotes(['HD']);
    expect(fmpQuote).not.toHaveBeenCalled();
    expect(out.size).toBe(0);
  });

  it('survives an Alpaca failure by using FMP', async () => {
    snaps.mockRejectedValue(new Error('Alpaca 403'));
    fmpQuote.mockResolvedValue({ symbol: 'HD', price: 400, changePercentage: -0.5 } as never);
    const out = await getLiveQuotes(['HD']);
    expect(out.get('HD')?.source).toBe('fmp');
  });
});
