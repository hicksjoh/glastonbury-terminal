/**
 * Options strategy builder — leg structure, strike ordering, premium
 * sign conventions and OCC symbol round-trips.
 *
 * `strikeOffset` is documented in options/types.ts as an ABSOLUTE dollar
 * offset from ATM ("0 = ATM, +5 = 5 above"). These tests hold it to that
 * contract, and pin the low-priced-underlying edge where a dollar offset
 * can drive a strike to zero or below.
 */
import { describe, it, expect } from 'vitest';
import {
  STRATEGY_TEMPLATES, buildStrategy, getTemplateBySlug, getTemplatesByCategory,
} from '../strategies';
import { parseOCCSymbol, buildOCCSymbol } from '../symbols';

const EXP = '2026-12-18';

describe('STRATEGY_TEMPLATES — catalogue integrity', () => {
  it('has unique slugs', () => {
    const slugs = STRATEGY_TEMPLATES.map(t => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every template has at least one leg and a described risk profile', () => {
    for (const t of STRATEGY_TEMPLATES) {
      expect(t.legs.length, t.slug).toBeGreaterThan(0);
      expect(t.maxProfit.length, t.slug).toBeGreaterThan(0);
      expect(t.maxLoss.length, t.slug).toBeGreaterThan(0);
      expect(t.breakEven.length, t.slug).toBeGreaterThan(0);
      expect(t.description.length, t.slug).toBeGreaterThan(0);
    }
  });

  it('every leg has a positive quantity ratio and a finite strike offset', () => {
    for (const t of STRATEGY_TEMPLATES) {
      for (const leg of t.legs) {
        expect(leg.quantityRatio, `${t.slug} ratio`).toBeGreaterThan(0);
        expect(Number.isFinite(leg.strikeOffset), `${t.slug} offset`).toBe(true);
      }
    }
  });

  it('lookup helpers agree with the catalogue', () => {
    expect(getTemplateBySlug('iron-condor')?.name).toBe('Iron Condor');
    expect(getTemplateBySlug('does-not-exist')).toBeUndefined();
    const income = getTemplatesByCategory('income');
    expect(income.length).toBeGreaterThan(0);
    for (const t of income) expect(t.category).toBe('income');
  });
});

describe('buildStrategy — strike construction', () => {
  it('places a bull call spread with the long strike below the short strike', () => {
    const built = buildStrategy(getTemplateBySlug('bull-call-spread')!, 'AAPL', 200, EXP);
    const [long, short] = built.legs;
    expect(long.action).toBe('buy_to_open');
    expect(short.action).toBe('sell_to_open');
    expect(long.strike).toBeLessThan(short.strike);
  });

  it('places a bear put spread with the long strike above the short strike', () => {
    const built = buildStrategy(getTemplateBySlug('bear-put-spread')!, 'AAPL', 200, EXP);
    const [long, short] = built.legs;
    expect(long.strike).toBeGreaterThan(short.strike);
  });

  it('orders an iron condor put-long < put-short < call-short < call-long', () => {
    const built = buildStrategy(getTemplateBySlug('iron-condor')!, 'SPY', 500, EXP);
    const [shortPut, longPut, shortCall, longCall] = built.legs;
    expect(longPut.strike).toBeLessThan(shortPut.strike);
    expect(shortPut.strike).toBeLessThan(shortCall.strike);
    expect(shortCall.strike).toBeLessThan(longCall.strike);
    expect(longPut.type).toBe('put');
    expect(longCall.type).toBe('call');
  });

  it('centres an iron butterfly on the ATM strike', () => {
    const built = buildStrategy(getTemplateBySlug('iron-butterfly')!, 'SPY', 500, EXP);
    const [shortPut, longPut, shortCall, longCall] = built.legs;
    expect(shortPut.strike).toBe(shortCall.strike);
    expect(longPut.strike).toBeLessThan(shortPut.strike);
    expect(longCall.strike).toBeGreaterThan(shortCall.strike);
  });

  it('gives a long straddle both legs at the same strike', () => {
    const [call, put] = buildStrategy(getTemplateBySlug('long-straddle')!, 'AAPL', 200, EXP).legs;
    expect(call.strike).toBe(put.strike);
    expect(call.type).toBe('call');
    expect(put.type).toBe('put');
  });

  it('pushes a calendar spread back-leg expiration out by its offset', () => {
    const [front, back] = buildStrategy(getTemplateBySlug('calendar-spread')!, 'AAPL', 200, EXP).legs;
    expect(front.expiration).toBe(EXP);
    expect(new Date(back.expiration).getTime()).toBeGreaterThan(new Date(EXP).getTime());
    expect(front.strike).toBe(back.strike);
  });

  it('emits a valid, parseable OCC symbol for every leg', () => {
    for (const t of STRATEGY_TEMPLATES) {
      for (const leg of buildStrategy(t, 'AAPL', 200, EXP).legs) {
        expect(leg.symbol, `${t.slug}`).toBeDefined();
        const parsed = parseOCCSymbol(leg.symbol!);
        expect(parsed, `${t.slug} -> ${leg.symbol}`).not.toBeNull();
        expect(parsed!.underlying).toBe('AAPL');
        expect(parsed!.strike).toBeCloseTo(leg.strike, 6);
        expect(parsed!.type).toBe(leg.type);
      }
    }
  });

  it('never produces a zero or negative strike on a low-priced underlying', () => {
    // A $6 stock with an iron condor's -$10 put wing would otherwise
    // build strike -4, and buildOCCSymbol renders that as the malformed
    // symbol "...P0000-4000" — an order Alpaca cannot fill.
    for (const price of [0.5, 2, 6, 12, 20]) {
      for (const t of STRATEGY_TEMPLATES) {
        for (const leg of buildStrategy(t, 'PENNY', price, EXP).legs) {
          expect(leg.strike, `${t.slug} @ $${price}`).toBeGreaterThan(0);
          expect(leg.symbol, `${t.slug} @ $${price}`).not.toMatch(/-/);
          expect(parseOCCSymbol(leg.symbol!), `${t.slug} @ $${price}`).not.toBeNull();
        }
      }
    }
  });
});

describe('buildStrategy — premium accounting', () => {
  const bullCall = getTemplateBySlug('bull-call-spread')!;

  it('reports a debit spread as NEGATIVE net premium', () => {
    const built0 = buildStrategy(bullCall, 'AAPL', 200, EXP);
    const premiums = new Map<string, number>([
      [built0.legs[0].symbol!, 8],  // bought
      [built0.legs[1].symbol!, 3],  // sold
    ]);
    const built = buildStrategy(bullCall, 'AAPL', 200, EXP, premiums);
    // (-8 + 3) * 1 * 100 = -500
    expect(built.netPremium).toBeCloseTo(-500, 6);
    expect(built.capitalRequired).toBeCloseTo(500, 6);
  });

  it('reports a credit spread as POSITIVE net premium', () => {
    const bullPut = getTemplateBySlug('bull-put-spread')!;
    const built0 = buildStrategy(bullPut, 'AAPL', 200, EXP);
    const premiums = new Map<string, number>([
      [built0.legs[0].symbol!, 6],  // sold
      [built0.legs[1].symbol!, 2],  // bought
    ]);
    const built = buildStrategy(bullPut, 'AAPL', 200, EXP, premiums);
    expect(built.netPremium).toBeCloseTo(400, 6);
  });

  it('treats a missing premium estimate as zero, not NaN', () => {
    const built = buildStrategy(bullCall, 'AAPL', 200, EXP);
    expect(built.netPremium).toBe(0);
    expect(Number.isFinite(built.capitalRequired)).toBe(true);
  });

  it('capitalRequired is never negative', () => {
    for (const t of STRATEGY_TEMPLATES) {
      const b = buildStrategy(t, 'AAPL', 200, EXP);
      expect(b.capitalRequired, t.slug).toBeGreaterThanOrEqual(0);
    }
  });

  it('records the underlying and template slug it was built from', () => {
    const b = buildStrategy(bullCall, 'MSFT', 420, EXP);
    expect(b.underlying).toBe('MSFT');
    expect(b.template).toBe('bull-call-spread');
  });
});

describe('OCC symbols — round-trip', () => {
  it('builds and parses back to the same components', () => {
    for (const [underlying, expiry, type, strike] of [
      ['AAPL', '2026-04-18', 'call', 190],
      ['F', '2026-01-16', 'put', 12.5],
      ['SPY', '2027-12-17', 'call', 612.5],
      ['BRKB', '2026-06-19', 'put', 0.5],
    ] as const) {
      const occ = buildOCCSymbol(underlying, expiry, type, strike);
      const parsed = parseOCCSymbol(occ);
      expect(parsed, occ).not.toBeNull();
      expect(parsed!.underlying).toBe(underlying);
      expect(parsed!.expiry).toBe(expiry);
      expect(parsed!.type).toBe(type);
      expect(parsed!.strike).toBeCloseTo(strike, 6);
    }
  });

  it('matches the canonical OCC format', () => {
    expect(buildOCCSymbol('AAPL', '2026-04-18', 'call', 190)).toBe('AAPL260418C00190000');
  });

  it('rejects malformed symbols', () => {
    expect(parseOCCSymbol('AAPL')).toBeNull();
    expect(parseOCCSymbol('')).toBeNull();
    expect(parseOCCSymbol('AAPL260418X00190000')).toBeNull(); // bad type char
    expect(parseOCCSymbol('TOOLONGROOT260418C00190000')).toBeNull();
  });
});
