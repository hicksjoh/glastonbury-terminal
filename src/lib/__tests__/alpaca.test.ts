import { describe, it, expect } from 'vitest';
import { assertPaperTrading } from '../alpaca';

// ═══════════════════════════════════════════════════════════════════════════
//  S2 — Paper-trading lock (Codex QA review 2026-04-28)
//
//  Defense-in-depth: every order endpoint must funnel through
//  assertPaperTrading() so a misconfigured ALPACA_BASE_URL on Vercel
//  cannot route REAL orders. The guard throws unless the URL host is
//  exactly `paper-api.alpaca.markets`.
// ═══════════════════════════════════════════════════════════════════════════

describe('assertPaperTrading', () => {
  it('does not throw for the canonical paper endpoint', () => {
    expect(() => assertPaperTrading('https://paper-api.alpaca.markets')).not.toThrow();
  });

  it('does not throw for the paper endpoint with a trailing path', () => {
    expect(() => assertPaperTrading('https://paper-api.alpaca.markets/v2')).not.toThrow();
  });

  it('throws for the live trading endpoint', () => {
    expect(() => assertPaperTrading('https://api.alpaca.markets')).toThrow(
      /Refusing to submit order/,
    );
  });

  it('throws for the live trading endpoint with a trailing path', () => {
    expect(() => assertPaperTrading('https://api.alpaca.markets/v2/orders')).toThrow(
      /Refusing to submit order/,
    );
  });

  it('throws for any non-paper host (typo, copy-paste, attacker)', () => {
    expect(() => assertPaperTrading('https://evil.example.com')).toThrow(/Refusing to submit/);
    expect(() => assertPaperTrading('https://paper-api.alpaca.markets.evil.com')).toThrow(
      /Refusing to submit/,
    );
    expect(() => assertPaperTrading('https://data.alpaca.markets')).toThrow(/Refusing to submit/);
  });

  it('throws a clear error for invalid URLs (env-config drift)', () => {
    expect(() => assertPaperTrading('not-a-url')).toThrow(/Invalid ALPACA_BASE_URL/);
    expect(() => assertPaperTrading('')).toThrow(/Invalid ALPACA_BASE_URL/);
  });

  it('error message names the offending host so logs are actionable', () => {
    try {
      assertPaperTrading('https://api.alpaca.markets');
      throw new Error('expected throw');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toContain('api.alpaca.markets');
      expect(msg).toContain('paper-api.alpaca.markets');
    }
  });
});
