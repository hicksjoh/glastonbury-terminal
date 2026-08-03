import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertPaperTrading } from '../alpaca';
import {
  assertTradingModeAllowed,
  assertNotionalTypedConfirm,
  LiveOrderRejectedError,
  ALPACA_PAPER_HOST,
  ALPACA_LIVE_HOST,
} from '../trading-mode';

// ═══════════════════════════════════════════════════════════════════════════
//  Trading-mode guard suite
//
//  Historically this suite proved `assertPaperTrading` was a HARD block:
//  it always refused live URLs. That invariant changed when live trading
//  unlocked (safety/live-trading-unlock branch). The mode/URL alignment
//  is now the invariant — the URL must match the declared TRADING_MODE.
//  A mismatch in either direction throws.
//
//  These tests cover:
//    - paper mode + paper URL     → OK
//    - paper mode + live URL      → THROW  (drift protection)
//    - live mode + live URL       → OK
//    - live mode + paper URL      → THROW  (drift protection)
//    - malformed URL              → THROW  (config error)
//    - unset TRADING_MODE         → defaults to paper (never silently live)
//    - typed-confirm threshold    → notional ≥ $5K in live requires match
// ═══════════════════════════════════════════════════════════════════════════

const PAPER_URL = `https://${ALPACA_PAPER_HOST}`;
const LIVE_URL  = `https://${ALPACA_LIVE_HOST}`;

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => { process.env = { ...ORIGINAL_ENV }; });
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe('assertTradingModeAllowed — paper mode (default)', () => {
  beforeEach(() => { delete process.env.TRADING_MODE; });

  it('accepts the paper URL', () => {
    expect(() => assertTradingModeAllowed(PAPER_URL)).not.toThrow();
  });

  it('accepts paper URL with a trailing path', () => {
    expect(() => assertTradingModeAllowed(`${PAPER_URL}/v2`)).not.toThrow();
  });

  it('THROWS on the live URL (drift protection)', () => {
    expect(() => assertTradingModeAllowed(LIVE_URL)).toThrow(/Refusing to submit order/);
  });

  it('throws on live URL with a trailing path', () => {
    expect(() => assertTradingModeAllowed(`${LIVE_URL}/v2/orders`)).toThrow(/Refusing to submit/);
  });

  it('throws on any non-alpaca host (typo, attacker)', () => {
    expect(() => assertTradingModeAllowed('https://evil.example.com')).toThrow(/Refusing to submit/);
    expect(() => assertTradingModeAllowed('https://paper-api.alpaca.markets.evil.com')).toThrow(/Refusing to submit/);
    expect(() => assertTradingModeAllowed('https://data.alpaca.markets')).toThrow(/Refusing to submit/);
  });
});

describe('assertTradingModeAllowed — live mode', () => {
  beforeEach(() => { process.env.TRADING_MODE = 'live'; });

  it('accepts the live URL', () => {
    expect(() => assertTradingModeAllowed(LIVE_URL)).not.toThrow();
  });

  it('accepts live URL with a trailing path', () => {
    expect(() => assertTradingModeAllowed(`${LIVE_URL}/v2/orders`)).not.toThrow();
  });

  it('THROWS on the paper URL (mode/URL mismatch)', () => {
    expect(() => assertTradingModeAllowed(PAPER_URL)).toThrow(/Refusing to submit/);
  });

  it('error message names both the offending host and the expected host', () => {
    try {
      assertTradingModeAllowed(PAPER_URL);
      throw new Error('expected throw');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toContain(ALPACA_PAPER_HOST);
      expect(msg).toContain(ALPACA_LIVE_HOST);
      expect(msg).toContain('live');
    }
  });
});

describe('assertTradingModeAllowed — transport hardening (Codex finding #6)', () => {
  // The pre-fix guard compared only URL.host, so plaintext HTTP to the
  // real broker hostname passed and would have shipped credentials in
  // the clear.
  it('rejects http:// even when the host is correct (paper)', () => {
    delete process.env.TRADING_MODE;
    expect(() => assertTradingModeAllowed(`http://${ALPACA_PAPER_HOST}`)).toThrow(/HTTPS is required/);
  });

  it('rejects http:// even when the host is correct (live)', () => {
    process.env.TRADING_MODE = 'live';
    expect(() => assertTradingModeAllowed(`http://${ALPACA_LIVE_HOST}`)).toThrow(/HTTPS is required/);
  });

  it('rejects embedded credentials in the URL', () => {
    process.env.TRADING_MODE = 'live';
    expect(() => assertTradingModeAllowed(`https://user:pass@${ALPACA_LIVE_HOST}`)).toThrow(/must not embed credentials/);
  });

  it('rejects a non-443 port on the broker host', () => {
    process.env.TRADING_MODE = 'live';
    expect(() => assertTradingModeAllowed(`https://${ALPACA_LIVE_HOST}:8443`)).toThrow(/unexpected port/);
  });

  it('still accepts the plain https broker URL', () => {
    process.env.TRADING_MODE = 'live';
    expect(() => assertTradingModeAllowed(`https://${ALPACA_LIVE_HOST}`)).not.toThrow();
  });
});

describe('assertNotionalTypedConfirm — indeterminate notional FAILS CLOSED (Codex finding #1)', () => {
  // Root cause of the market-order bypass: the pre-fix code returned early
  // when !Number.isFinite(notional), so a market order (no limit price →
  // notional NaN) skipped the gate entirely no matter how large.
  it('live mode + NaN notional: throws notional_indeterminate (does NOT pass)', () => {
    process.env.TRADING_MODE = 'live';
    expect(() => assertNotionalTypedConfirm(Number.NaN, undefined)).toThrow(LiveOrderRejectedError);
    try {
      assertNotionalTypedConfirm(Number.NaN, undefined);
    } catch (err) {
      expect((err as LiveOrderRejectedError).code).toBe('notional_indeterminate');
      expect((err as LiveOrderRejectedError).status()).toBe(428);
    }
  });

  it('live mode + Infinity notional: throws notional_indeterminate', () => {
    process.env.TRADING_MODE = 'live';
    expect(() => assertNotionalTypedConfirm(Number.POSITIVE_INFINITY, undefined)).toThrow(/Cannot determine/);
  });

  it('a typedConfirm string cannot talk its way past an indeterminate notional', () => {
    process.env.TRADING_MODE = 'live';
    expect(() => assertNotionalTypedConfirm(Number.NaN, '999999')).toThrow(LiveOrderRejectedError);
  });

  it('paper mode + NaN notional: still a no-op (gate only applies live)', () => {
    delete process.env.TRADING_MODE;
    expect(() => assertNotionalTypedConfirm(Number.NaN, undefined)).not.toThrow();
  });

  it('rejection carries the server-computed notional so the client dialog matches', () => {
    process.env.TRADING_MODE = 'live';
    try {
      assertNotionalTypedConfirm(7_500, undefined);
    } catch (err) {
      const e = err as LiveOrderRejectedError;
      expect(e.detail?.notionalUsd).toBe(7500);
      expect(e.detail?.thresholdUsd).toBe(5000);
    }
  });
});

describe('assertTradingModeAllowed — malformed / mis-set env', () => {
  it('unset TRADING_MODE defaults to paper', () => {
    delete process.env.TRADING_MODE;
    expect(() => assertTradingModeAllowed(PAPER_URL)).not.toThrow();
    expect(() => assertTradingModeAllowed(LIVE_URL)).toThrow(/paper/);
  });

  it('empty TRADING_MODE defaults to paper', () => {
    process.env.TRADING_MODE = '';
    expect(() => assertTradingModeAllowed(LIVE_URL)).toThrow(/paper/);
  });

  it('malformed TRADING_MODE (typo) defaults to paper — never silent live', () => {
    process.env.TRADING_MODE = 'LivE_TRADE'; // typo — must NOT enable live
    expect(() => assertTradingModeAllowed(LIVE_URL)).toThrow(/paper/);
  });

  it('gracefully rejects malformed URLs', () => {
    expect(() => assertTradingModeAllowed('not-a-url')).toThrow(/Invalid ALPACA_BASE_URL/);
    expect(() => assertTradingModeAllowed('')).toThrow(/Invalid ALPACA_BASE_URL/);
  });
});

describe('assertPaperTrading (deprecated shim)', () => {
  // The shim now delegates to assertTradingModeAllowed with the CURRENT
  // server mode, not a hardcoded 'paper'. That was the deliberate change
  // when live trading unlocked. Callers that need strict paper-only
  // behavior (test harnesses, migrations) should call
  // assertTradingModeAllowed(url, 'paper') explicitly.

  it('paper mode: accepts paper URL', () => {
    delete process.env.TRADING_MODE;
    expect(() => assertPaperTrading(PAPER_URL)).not.toThrow();
  });

  it('paper mode: throws on live URL', () => {
    delete process.env.TRADING_MODE;
    expect(() => assertPaperTrading(LIVE_URL)).toThrow(/Refusing to submit/);
  });

  it('live mode: accepts live URL (behavior change)', () => {
    process.env.TRADING_MODE = 'live';
    expect(() => assertPaperTrading(LIVE_URL)).not.toThrow();
  });
});

describe('assertNotionalTypedConfirm', () => {
  it('paper mode: never requires typed confirm', () => {
    delete process.env.TRADING_MODE;
    expect(() => assertNotionalTypedConfirm(1_000_000, undefined)).not.toThrow();
  });

  it('live mode + notional below threshold: passes without typed confirm', () => {
    process.env.TRADING_MODE = 'live';
    delete process.env.LIVE_TYPED_CONFIRM_THRESHOLD_USD;
    expect(() => assertNotionalTypedConfirm(4_999, undefined)).not.toThrow();
  });

  it('live mode + notional at threshold: requires typed confirm', () => {
    process.env.TRADING_MODE = 'live';
    delete process.env.LIVE_TYPED_CONFIRM_THRESHOLD_USD;
    expect(() => assertNotionalTypedConfirm(5_000, undefined)).toThrow(LiveOrderRejectedError);
  });

  it('live mode + notional ≥ threshold + matching typed confirm: passes', () => {
    process.env.TRADING_MODE = 'live';
    expect(() => assertNotionalTypedConfirm(7_500, '7500')).not.toThrow();
  });

  it('live mode + notional ≥ threshold + non-matching typed confirm: throws', () => {
    process.env.TRADING_MODE = 'live';
    expect(() => assertNotionalTypedConfirm(7_500, '7501')).toThrow(LiveOrderRejectedError);
  });

  it('rounds notional to nearest dollar when checking match', () => {
    process.env.TRADING_MODE = 'live';
    expect(() => assertNotionalTypedConfirm(7_500.4, '7500')).not.toThrow();
    expect(() => assertNotionalTypedConfirm(7_500.6, '7501')).not.toThrow();
  });

  it('respects LIVE_TYPED_CONFIRM_THRESHOLD_USD override', () => {
    process.env.TRADING_MODE = 'live';
    process.env.LIVE_TYPED_CONFIRM_THRESHOLD_USD = '100';
    expect(() => assertNotionalTypedConfirm(99, undefined)).not.toThrow();
    expect(() => assertNotionalTypedConfirm(101, undefined)).toThrow(LiveOrderRejectedError);
    expect(() => assertNotionalTypedConfirm(101, '101')).not.toThrow();
  });

  it('emits LiveOrderRejectedError with typed_confirm_required code', () => {
    process.env.TRADING_MODE = 'live';
    try {
      assertNotionalTypedConfirm(5_000, undefined);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LiveOrderRejectedError);
      expect((err as LiveOrderRejectedError).code).toBe('typed_confirm_required');
      expect((err as LiveOrderRejectedError).status()).toBe(428);
    }
  });
});
