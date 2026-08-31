/**
 * Behavioral guardrails — trigger boundaries and non-firing conditions.
 *
 * These alerts are advisory (they never block), but they feed the trade
 * guard's STOP / CAUTION verdict, so a boundary that fires one notch too
 * early or too late changes the verdict shown before a real order.
 */
import { describe, it, expect } from 'vitest';
import {
  checkBehavioralGuards, type TradeContext, type PortfolioContext,
} from '../behavioral-guard';

const emptyPortfolio: PortfolioContext = { positions: [], recentSells: [] };

const sell = (over: Partial<TradeContext> = {}): TradeContext =>
  ({ action: 'sell', ticker: 'AAPL', quantity: 10, ...over });
const buy = (over: Partial<TradeContext> = {}): TradeContext =>
  ({ action: 'buy', ticker: 'AAPL', quantity: 10, ...over });

const types = (alerts: ReturnType<typeof checkBehavioralGuards>) => alerts.map(a => a.type);

describe('panic selling', () => {
  it('fires at 3 sells with VIX at 25 — the documented boundary', () => {
    expect(types(checkBehavioralGuards(sell({ recentOrderCount5Min: 3, vixLevel: 25 }), emptyPortfolio)))
      .toContain('panic_sell');
  });

  it('does NOT fire at 2 sells, however high the VIX', () => {
    expect(types(checkBehavioralGuards(sell({ recentOrderCount5Min: 2, vixLevel: 80 }), emptyPortfolio)))
      .not.toContain('panic_sell');
  });

  it('does NOT fire below VIX 25, however many sells', () => {
    expect(types(checkBehavioralGuards(sell({ recentOrderCount5Min: 20, vixLevel: 24.99 }), emptyPortfolio)))
      .not.toContain('panic_sell');
  });

  it('does NOT fire on a buy', () => {
    expect(types(checkBehavioralGuards(buy({ recentOrderCount5Min: 10, vixLevel: 40 }), emptyPortfolio)))
      .not.toContain('panic_sell');
  });

  it('does not fire when VIX or order count is missing', () => {
    expect(types(checkBehavioralGuards(sell({ recentOrderCount5Min: 10 }), emptyPortfolio)))
      .not.toContain('panic_sell');
    expect(types(checkBehavioralGuards(sell({ vixLevel: 40 }), emptyPortfolio)))
      .not.toContain('panic_sell');
  });

  it('is marked critical and renders no NaN', () => {
    const [a] = checkBehavioralGuards(sell({ recentOrderCount5Min: 5, vixLevel: 32.5 }), emptyPortfolio);
    expect(a.severity).toBe('critical');
    expect(a.message).not.toMatch(/NaN|undefined/);
    expect(a.message).toContain('5');
    expect(a.message).toContain('32.5');
  });

  it('does not fire — and does not render NaN — for a non-finite VIX', () => {
    const alerts = checkBehavioralGuards(sell({ recentOrderCount5Min: 5, vixLevel: Number.NaN }), emptyPortfolio);
    expect(types(alerts)).not.toContain('panic_sell');
  });
});

describe('performance chasing', () => {
  it('fires at exactly +20% over 5 days for an unwatched name', () => {
    expect(types(checkBehavioralGuards(buy({ stockChangeLast5Days: 20 }), emptyPortfolio)))
      .toContain('performance_chase');
  });

  it('does NOT fire just below the threshold', () => {
    expect(types(checkBehavioralGuards(buy({ stockChangeLast5Days: 19.99 }), emptyPortfolio)))
      .not.toContain('performance_chase');
  });

  it('does NOT fire when the name was already on the watchlist', () => {
    expect(types(checkBehavioralGuards(
      buy({ stockChangeLast5Days: 50, wasOnWatchlist: true }), emptyPortfolio)))
      .not.toContain('performance_chase');
  });

  it('does NOT fire on a sell', () => {
    expect(types(checkBehavioralGuards(sell({ stockChangeLast5Days: 50 }), emptyPortfolio)))
      .not.toContain('performance_chase');
  });

  it('is a warning, not critical, and renders the actual move', () => {
    const [a] = checkBehavioralGuards(buy({ stockChangeLast5Days: 42.5 }), emptyPortfolio);
    expect(a.severity).toBe('warning');
    expect(a.message).toContain('42.5');
    expect(a.message).not.toMatch(/NaN/);
  });
});

describe('disposition effect', () => {
  const withWinner: PortfolioContext = {
    positions: [{ symbol: 'NVDA', unrealizedPlPct: 45, holdingDays: 120 }],
    recentSells: [],
  };

  it('fires when selling a >=10% loser while holding a >20% winner', () => {
    expect(types(checkBehavioralGuards(sell({ unrealizedLossPct: -10 }), withWinner)))
      .toContain('disposition_effect');
  });

  it('does NOT fire for a shallower loss', () => {
    expect(types(checkBehavioralGuards(sell({ unrealizedLossPct: -9.99 }), withWinner)))
      .not.toContain('disposition_effect');
  });

  it('does NOT fire with no big winners held', () => {
    const small: PortfolioContext = {
      positions: [{ symbol: 'NVDA', unrealizedPlPct: 20, holdingDays: 120 }], recentSells: [],
    };
    expect(types(checkBehavioralGuards(sell({ unrealizedLossPct: -30 }), small)))
      .not.toContain('disposition_effect');
  });

  it('does NOT fire on a buy or when there is no loss', () => {
    expect(types(checkBehavioralGuards(buy({ unrealizedLossPct: -30 }), withWinner)))
      .not.toContain('disposition_effect');
    expect(types(checkBehavioralGuards(sell({}), withWinner)))
      .not.toContain('disposition_effect');
  });

  it('counts the winners it names', () => {
    const many: PortfolioContext = {
      positions: [
        { symbol: 'NVDA', unrealizedPlPct: 45, holdingDays: 120 },
        { symbol: 'MSFT', unrealizedPlPct: 25, holdingDays: 300 },
        { symbol: 'F', unrealizedPlPct: 5, holdingDays: 30 },
      ],
      recentSells: [],
    };
    const [a] = checkBehavioralGuards(sell({ unrealizedLossPct: -15 }), many);
    expect(a.data.winnerCount).toBe(2);
    expect(a.message).toContain('2 position(s)');
  });
});

describe('checkBehavioralGuards — composition', () => {
  it('returns an empty list for a clean trade', () => {
    expect(checkBehavioralGuards(buy({ stockChangeLast5Days: 2 }), emptyPortfolio)).toEqual([]);
  });

  it('can return more than one alert at once', () => {
    const withWinner: PortfolioContext = {
      positions: [{ symbol: 'NVDA', unrealizedPlPct: 45, holdingDays: 120 }], recentSells: [],
    };
    const alerts = checkBehavioralGuards(
      sell({ recentOrderCount5Min: 6, vixLevel: 40, unrealizedLossPct: -25 }), withWinner);
    expect(types(alerts)).toEqual(expect.arrayContaining(['panic_sell', 'disposition_effect']));
  });

  it('every alert carries a title, message and recommendation', () => {
    const withWinner: PortfolioContext = {
      positions: [{ symbol: 'NVDA', unrealizedPlPct: 45, holdingDays: 120 }], recentSells: [],
    };
    const alerts = checkBehavioralGuards(
      sell({ recentOrderCount5Min: 6, vixLevel: 40, unrealizedLossPct: -25 }), withWinner);
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) {
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.message.length).toBeGreaterThan(0);
      expect(a.recommendation.length).toBeGreaterThan(0);
      expect(`${a.title}${a.message}${a.recommendation}`).not.toMatch(/NaN|undefined|null/);
    }
  });

  it('skips the wash-sale check when no trade history is supplied', () => {
    expect(types(checkBehavioralGuards(sell({}), emptyPortfolio, []))).not.toContain('wash_sale_risk');
    expect(types(checkBehavioralGuards(sell({}), emptyPortfolio))).not.toContain('wash_sale_risk');
  });
});
