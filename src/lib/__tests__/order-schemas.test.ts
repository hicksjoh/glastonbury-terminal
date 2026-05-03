import { describe, it, expect } from 'vitest';
import {
  equityOrderSchema,
  alpacaOrderRequestSchema,
  optionsOrderSchema,
  optionLegSchema,
  multiLegOrderSchema,
  occSymbolSchema,
  equitySymbolSchema,
} from '../order-schemas';

describe('equityOrderSchema', () => {
  it('accepts a valid market order', () => {
    const r = equityOrderSchema.safeParse({
      symbol: 'AAPL',
      qty: 10,
      side: 'buy',
      type: 'market',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.time_in_force).toBe('day'); // default
    }
  });

  it('accepts BRK.B-style class shares', () => {
    const r = equityOrderSchema.safeParse({
      symbol: 'BRK.B',
      qty: 1,
      side: 'buy',
      type: 'market',
    });
    expect(r.success).toBe(true);
  });

  it('rejects lowercase symbols', () => {
    const r = equityOrderSchema.safeParse({
      symbol: 'aapl',
      qty: 1,
      side: 'buy',
      type: 'market',
    });
    expect(r.success).toBe(false);
  });

  it('rejects NaN qty (string "abc")', () => {
    const r = equityOrderSchema.safeParse({
      symbol: 'AAPL',
      qty: 'abc',
      side: 'buy',
      type: 'market',
    });
    expect(r.success).toBe(false);
  });

  it('coerces numeric strings ("10") to integer qty', () => {
    const r = equityOrderSchema.safeParse({
      symbol: 'AAPL',
      qty: '10',
      side: 'buy',
      type: 'market',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.qty).toBe(10);
  });

  it('rejects fractional qty (1.5)', () => {
    const r = equityOrderSchema.safeParse({
      symbol: 'AAPL',
      qty: 1.5,
      side: 'buy',
      type: 'market',
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown fields (.strict)', () => {
    const r = equityOrderSchema.safeParse({
      symbol: 'AAPL',
      qty: 1,
      side: 'buy',
      type: 'market',
      malicious_extra: 'pwn',
    });
    expect(r.success).toBe(false);
  });

  it('requires limit_price when type=limit', () => {
    const r = equityOrderSchema.safeParse({
      symbol: 'AAPL',
      qty: 1,
      side: 'buy',
      type: 'limit',
    });
    expect(r.success).toBe(false);
  });

  it('accepts limit order with limit_price', () => {
    const r = equityOrderSchema.safeParse({
      symbol: 'AAPL',
      qty: 1,
      side: 'buy',
      type: 'limit',
      limit_price: 100.5,
    });
    expect(r.success).toBe(true);
  });

  it('requires stop_price when type=stop_limit', () => {
    const r = equityOrderSchema.safeParse({
      symbol: 'AAPL',
      qty: 1,
      side: 'sell',
      type: 'stop_limit',
      limit_price: 90,
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown side', () => {
    const r = equityOrderSchema.safeParse({
      symbol: 'AAPL',
      qty: 1,
      side: 'short',
      type: 'market',
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown time_in_force', () => {
    const r = equityOrderSchema.safeParse({
      symbol: 'AAPL',
      qty: 1,
      side: 'buy',
      type: 'market',
      time_in_force: 'forever',
    });
    expect(r.success).toBe(false);
  });
});

describe('alpacaOrderRequestSchema', () => {
  it('accepts mode=preview and force=true alongside the order body', () => {
    const r = alpacaOrderRequestSchema.safeParse({
      symbol: 'AAPL',
      qty: 1,
      side: 'buy',
      type: 'market',
      mode: 'preview',
      force: true,
    });
    expect(r.success).toBe(true);
  });

  it('still rejects unknown extras even with mode/force present', () => {
    const r = alpacaOrderRequestSchema.safeParse({
      symbol: 'AAPL',
      qty: 1,
      side: 'buy',
      type: 'market',
      force: true,
      extra: 'nope',
    });
    expect(r.success).toBe(false);
  });
});

describe('occSymbolSchema', () => {
  it('accepts a valid OCC symbol (AAPL240119C00190000)', () => {
    const r = occSymbolSchema.safeParse('AAPL240119C00190000');
    expect(r.success).toBe(true);
  });

  it('rejects lowercase root', () => {
    const r = occSymbolSchema.safeParse('aapl240119C00190000');
    expect(r.success).toBe(false);
  });

  it('rejects bad expiration length', () => {
    const r = occSymbolSchema.safeParse('AAPL2401C00190000');
    expect(r.success).toBe(false);
  });

  it('rejects bad type code (X)', () => {
    const r = occSymbolSchema.safeParse('AAPL240119X00190000');
    expect(r.success).toBe(false);
  });
});

describe('optionsOrderSchema', () => {
  it('accepts a valid OCC market order', () => {
    const r = optionsOrderSchema.safeParse({
      symbol: 'AAPL240119C00190000',
      qty: 1,
      side: 'buy',
      type: 'market',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an equity symbol passed to the options schema', () => {
    const r = optionsOrderSchema.safeParse({
      symbol: 'AAPL',
      qty: 1,
      side: 'buy',
      type: 'market',
    });
    expect(r.success).toBe(false);
  });
});

describe('optionLegSchema', () => {
  it('accepts a valid leg', () => {
    const r = optionLegSchema.safeParse({
      symbol: 'AAPL240119C00190000',
      side: 'buy',
      ratio_qty: 1,
    });
    expect(r.success).toBe(true);
  });

  it('rejects ratio_qty=0', () => {
    const r = optionLegSchema.safeParse({
      symbol: 'AAPL240119C00190000',
      side: 'buy',
      ratio_qty: 0,
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown extra keys', () => {
    const r = optionLegSchema.safeParse({
      symbol: 'AAPL240119C00190000',
      side: 'buy',
      ratio_qty: 1,
      poison: 'value',
    });
    expect(r.success).toBe(false);
  });
});

describe('multiLegOrderSchema', () => {
  const validLeg = (override: Partial<{ symbol: string; side: 'buy' | 'sell'; ratio_qty: number }> = {}) => ({
    symbol: 'AAPL240119C00190000',
    side: 'buy' as const,
    ratio_qty: 1,
    ...override,
  });

  it('accepts a 2-leg vertical with limit_price', () => {
    const r = multiLegOrderSchema.safeParse({
      legs: [
        validLeg({ symbol: 'AAPL240119C00190000', side: 'buy' }),
        validLeg({ symbol: 'AAPL240119C00200000', side: 'sell' }),
      ],
      type: 'limit',
      limit_price: 1.5,
    });
    expect(r.success).toBe(true);
  });

  it('rejects 1-leg "multi-leg" orders', () => {
    const r = multiLegOrderSchema.safeParse({
      legs: [validLeg()],
      type: 'limit',
      limit_price: 1.5,
    });
    expect(r.success).toBe(false);
  });

  it('rejects 5-leg orders (Alpaca caps at 4)', () => {
    const r = multiLegOrderSchema.safeParse({
      legs: [validLeg(), validLeg(), validLeg(), validLeg(), validLeg()],
      type: 'limit',
      limit_price: 1.5,
    });
    expect(r.success).toBe(false);
  });

  it('rejects total ratio_qty over 10K', () => {
    const r = multiLegOrderSchema.safeParse({
      legs: [
        validLeg({ ratio_qty: 6_000 }),
        validLeg({ ratio_qty: 6_000 }),
      ],
      type: 'limit',
      limit_price: 1.5,
    });
    expect(r.success).toBe(false);
  });

  it('requires limit_price when type=limit', () => {
    const r = multiLegOrderSchema.safeParse({
      legs: [validLeg(), validLeg()],
      type: 'limit',
    });
    expect(r.success).toBe(false);
  });

  it('rejects equity symbol in a leg', () => {
    const r = multiLegOrderSchema.safeParse({
      legs: [validLeg({ symbol: 'AAPL' as string }), validLeg()],
      type: 'limit',
      limit_price: 1.5,
    });
    expect(r.success).toBe(false);
  });
});

describe('equitySymbolSchema', () => {
  it('accepts AAPL', () => {
    expect(equitySymbolSchema.safeParse('AAPL').success).toBe(true);
  });
  it('rejects empty string', () => {
    expect(equitySymbolSchema.safeParse('').success).toBe(false);
  });
  it('rejects symbols with digits', () => {
    expect(equitySymbolSchema.safeParse('AAPL1').success).toBe(false);
  });
});
