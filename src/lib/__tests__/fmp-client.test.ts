import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildStableUrl,
  getQuote,
  getMarketGainers,
  getMarketLosers,
  getMarketActives,
  getStockScreener,
  getEarningsCalendar,
  getEarningsSurprises,
  getHistoricalEarnings,
  getDividendCalendar,
  getTreasuryRates,
  getEconomicCalendar,
  getInsiderTrades,
  getLatestInsiderTrades,
  getSenateTrades,
  getHouseTrades,
  getLatestSenateTrades,
  getLatestHouseTrades,
} from '../fmp-client';
import { apiFetch, ApiError } from '../api-client';

// Track every URL fmp-client tries to hit. Each test asserts the URL the
// wrapper produced — that's the whole point of the migration: no /v3 or /v4
// paths anywhere, all calls land on /stable/...
const STABLE = 'https://financialmodelingprep.com/stable';

describe('fmp-client /stable URL contracts', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.FMP_API_KEY;
  let lastUrl = '';

  beforeEach(() => {
    process.env.FMP_API_KEY = 'test-key';
    lastUrl = '';
    global.fetch = vi.fn().mockImplementation((url: string) => {
      lastUrl = url;
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.FMP_API_KEY;
    else process.env.FMP_API_KEY = originalEnv;
  });

  it('buildStableUrl returns null when FMP_API_KEY is not set', () => {
    delete process.env.FMP_API_KEY;
    expect(buildStableUrl('/anything')).toBeNull();
  });

  it('buildStableUrl produces /stable URL with apikey', () => {
    const url = buildStableUrl('/quote', { symbol: 'AAPL' });
    expect(url).toMatch(/^https:\/\/financialmodelingprep\.com\/stable\/quote\?/);
    expect(url).toContain('symbol=AAPL');
    expect(url).toContain('apikey=test-key');
  });

  it('getQuote hits /stable/quote with symbol query param', async () => {
    await getQuote('AAPL');
    expect(lastUrl).toContain(`${STABLE}/quote`);
    expect(lastUrl).toContain('symbol=AAPL');
    expect(lastUrl).not.toMatch(/\/(v3|v4)\//);
  });

  it('getMarketGainers hits /stable/biggest-gainers', async () => {
    await getMarketGainers();
    expect(lastUrl).toContain(`${STABLE}/biggest-gainers`);
    expect(lastUrl).not.toContain('/stock_market/');
  });

  it('getMarketLosers hits /stable/biggest-losers', async () => {
    await getMarketLosers();
    expect(lastUrl).toContain(`${STABLE}/biggest-losers`);
  });

  it('getMarketActives hits /stable/most-actives', async () => {
    await getMarketActives();
    expect(lastUrl).toContain(`${STABLE}/most-actives`);
  });

  it('getStockScreener hits /stable/company-screener', async () => {
    await getStockScreener({ marketCapMoreThan: 1_000_000_000, priceMoreThan: 5 });
    expect(lastUrl).toContain(`${STABLE}/company-screener`);
    expect(lastUrl).toContain('marketCapMoreThan=1000000000');
    expect(lastUrl).toContain('priceMoreThan=5');
    expect(lastUrl).not.toContain('stock-screener');
  });

  it('getEarningsCalendar hits /stable/earnings-calendar with from+to', async () => {
    await getEarningsCalendar('2026-04-01', '2026-04-30');
    expect(lastUrl).toContain(`${STABLE}/earnings-calendar`);
    expect(lastUrl).toContain('from=2026-04-01');
    expect(lastUrl).toContain('to=2026-04-30');
    expect(lastUrl).not.toContain('earning_calendar');
  });

  it('getEarningsSurprises hits /stable/earnings-surprises with symbol query', async () => {
    await getEarningsSurprises('AAPL');
    expect(lastUrl).toContain(`${STABLE}/earnings-surprises`);
    expect(lastUrl).toContain('symbol=AAPL');
    expect(lastUrl).not.toMatch(/earnings-surprises\/AAPL/);
  });

  it('getHistoricalEarnings hits /stable/earnings with symbol+limit', async () => {
    await getHistoricalEarnings('AAPL', 10);
    expect(lastUrl).toContain(`${STABLE}/earnings`);
    expect(lastUrl).toContain('symbol=AAPL');
    expect(lastUrl).toContain('limit=10');
    expect(lastUrl).not.toContain('historical/earning_calendar');
  });

  it('getDividendCalendar hits /stable/dividends-calendar', async () => {
    await getDividendCalendar('2026-04-01', '2026-05-01');
    expect(lastUrl).toContain(`${STABLE}/dividends-calendar`);
    expect(lastUrl).not.toContain('stock_dividend_calendar');
  });

  it('getTreasuryRates hits /stable/treasury-rates', async () => {
    await getTreasuryRates('2026-04-01', '2026-04-30');
    expect(lastUrl).toContain(`${STABLE}/treasury-rates`);
    expect(lastUrl).not.toMatch(/\/v4\/treasury/);
  });

  it('getEconomicCalendar hits /stable/economic-calendar', async () => {
    await getEconomicCalendar('2026-04-01', '2026-05-01');
    expect(lastUrl).toContain(`${STABLE}/economic-calendar`);
    expect(lastUrl).not.toContain('economic_calendar');
  });

  it('getInsiderTrades hits /stable/insider-trading with symbol+limit', async () => {
    await getInsiderTrades('AAPL', 50);
    expect(lastUrl).toContain(`${STABLE}/insider-trading`);
    expect(lastUrl).toContain('symbol=AAPL');
    expect(lastUrl).toContain('limit=50');
    expect(lastUrl).not.toMatch(/\/v4\//);
  });

  it('getLatestInsiderTrades hits /stable/insider-trading-latest', async () => {
    await getLatestInsiderTrades(25);
    expect(lastUrl).toContain(`${STABLE}/insider-trading-latest`);
    expect(lastUrl).not.toContain('insider-trading-rss-feed');
  });

  it('getSenateTrades / getHouseTrades / latest variants hit /stable paths', async () => {
    await getSenateTrades('AAPL');
    expect(lastUrl).toContain(`${STABLE}/senate-trades`);

    await getHouseTrades('AAPL');
    expect(lastUrl).toContain(`${STABLE}/house-trades`);

    await getLatestSenateTrades();
    expect(lastUrl).toContain(`${STABLE}/senate-trades-latest`);

    await getLatestHouseTrades();
    expect(lastUrl).toContain(`${STABLE}/house-trades-latest`);

    // None of those four URLs should contain a v4 path or a /senate-disclosure*
    // path (the legacy names).
    expect(lastUrl).not.toMatch(/\/v4\//);
    expect(lastUrl).not.toMatch(/senate-disclosure/);
  });
});

describe('api-client refuses FMP /v3 and /v4 paths', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.FMP_API_KEY = 'test-key';
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('throws ApiError when fmp endpoint starts with /v3', async () => {
    await expect(apiFetch('fmp', '/v3/quote/AAPL')).rejects.toThrow(ApiError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws ApiError when fmp endpoint starts with /v4', async () => {
    await expect(apiFetch('fmp', '/v4/treasury')).rejects.toThrow(ApiError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not throw for non-fmp providers using /v3 (e.g. Polygon)', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    process.env.POLYGON_API_KEY = 'poly-key';
    await expect(apiFetch('polygon', '/v3/snapshot/options/AAPL')).resolves.toBeDefined();
  });
});
