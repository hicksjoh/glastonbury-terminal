import { describe, it, expect } from 'vitest';
import { earningsToneQuerySchema } from '../schema';

/**
 * Codex round-3 P1 — earnings-tone query validation.
 *
 * The pre-fix handler interpolated raw `symbol`, `quarter`, `year` from
 * the query string into:
 *   - a Supabase `.eq()` filter,
 *   - an FMP URL,
 *   - a Claude prompt body.
 *
 * Any one of those is a high-leverage abuse vector if the input isn't
 * shape-checked first (Supabase injection via crafted values, prompt
 * injection via long strings, FMP credit burn via fuzzing).
 */
describe('earningsToneQuerySchema', () => {
  it('accepts a clean equity ticker + valid quarter/year', () => {
    const r = earningsToneQuerySchema.safeParse({ symbol: 'AAPL', quarter: '1', year: '2026' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.symbol).toBe('AAPL');
      expect(r.data.quarter).toBe(1);
      expect(r.data.year).toBe(2026);
    }
  });

  it('uppercases the symbol via validateEquitySymbol', () => {
    const r = earningsToneQuerySchema.safeParse({ symbol: 'aapl', quarter: '1', year: '2026' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.symbol).toBe('AAPL');
  });

  it('rejects a symbol with path-traversal-ish characters', () => {
    const r = earningsToneQuerySchema.safeParse({ symbol: 'AAPL/../', quarter: '1', year: '2026' });
    expect(r.success).toBe(false);
  });

  it('rejects a symbol that exceeds the equity-shape length', () => {
    // validateEquitySymbol caps the length at 5 chars + optional .X suffix.
    const r = earningsToneQuerySchema.safeParse({ symbol: 'ABCDEFGHIJ', quarter: '1', year: '2026' });
    expect(r.success).toBe(false);
  });

  it('rejects quarter < 1', () => {
    const r = earningsToneQuerySchema.safeParse({ symbol: 'AAPL', quarter: '0', year: '2026' });
    expect(r.success).toBe(false);
  });

  it('rejects quarter > 4', () => {
    const r = earningsToneQuerySchema.safeParse({ symbol: 'AAPL', quarter: '5', year: '2026' });
    expect(r.success).toBe(false);
  });

  it('rejects non-integer quarter', () => {
    const r = earningsToneQuerySchema.safeParse({ symbol: 'AAPL', quarter: '1.5', year: '2026' });
    expect(r.success).toBe(false);
  });

  it('rejects year far in the future (>>current+1)', () => {
    const r = earningsToneQuerySchema.safeParse({ symbol: 'AAPL', quarter: '1', year: '9999' });
    expect(r.success).toBe(false);
  });

  it('rejects year before 1990', () => {
    const r = earningsToneQuerySchema.safeParse({ symbol: 'AAPL', quarter: '1', year: '1900' });
    expect(r.success).toBe(false);
  });

  it('rejects an injection attempt in the symbol field', () => {
    const r = earningsToneQuerySchema.safeParse({
      symbol: "AAPL'; DROP TABLE earnings_tone;--",
      quarter: '1',
      year: '2026',
    });
    expect(r.success).toBe(false);
  });
});
