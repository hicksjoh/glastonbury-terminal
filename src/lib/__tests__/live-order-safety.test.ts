/**
 * live-order-safety — the paper/real-money boundary, tested as an adversary.
 *
 * Every assertion here asks the same question: can an order reach Alpaca
 * in LIVE mode without passing this gate? Each gate must FAIL CLOSED —
 * a missing env var, a missing header, a broken dependency, or an
 * unpriceable order must BLOCK, never fall through.
 *
 * The gates, in order:
 *   1. assertOrderSubmissionAllowed()  — TRADING_MODE / ALPACA_BASE_URL alignment
 *   2. verifyLiveAckToken()            — session-bound x-live-ack header
 *   3. assertNotionalTypedConfirm()    — typed dollar confirm above threshold
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const alpacaMock = vi.hoisted(() => ({
  assertOrderSubmissionAllowed: vi.fn(),
  getLatestTrade: vi.fn(),
  getSnapshot: vi.fn(),
}));
const ackMock = vi.hoisted(() => ({ verifyLiveAckToken: vi.fn() }));
const identityMock = vi.hoisted(() => ({ getRateLimitIdentity: vi.fn() }));
const sentryMock = vi.hoisted(() => ({ addBreadcrumb: vi.fn() }));

vi.mock('@/lib/alpaca', () => alpacaMock);
vi.mock('@/lib/live-ack', () => ackMock);
vi.mock('@/lib/rate-limit-durable', () => identityMock);
vi.mock('@sentry/nextjs', () => sentryMock);

import {
  assertLiveOrderAllowed,
  resolveNotionalUsd,
  formatLiveOrderRejection,
} from '../live-order-safety';
import { LiveOrderRejectedError, assertNotionalTypedConfirm } from '../trading-mode';

/** Minimal request shape: the safety layer only reads headers. */
function req(headers: Record<string, string> = {}): NextRequest {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (k: string) => lower.get(k.toLowerCase()) ?? null },
  } as unknown as NextRequest;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  alpacaMock.assertOrderSubmissionAllowed.mockImplementation(() => {});
  ackMock.verifyLiveAckToken.mockResolvedValue({ token: 'x', user_hint: 'sub:wes' });
  identityMock.getRateLimitIdentity.mockResolvedValue({ key: 'sub:wes' });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function setMode(mode: string | undefined) {
  if (mode === undefined) delete process.env.TRADING_MODE;
  else process.env.TRADING_MODE = mode;
}

// ---------------------------------------------------------------------------
// resolveNotionalUsd — can it be tricked into UNDER-reporting?
// ---------------------------------------------------------------------------

describe('resolveNotionalUsd — bounded orders', () => {
  it('uses limit_price as the bound', async () => {
    expect(await resolveNotionalUsd({ symbol: 'AAPL', qty: 10, limitPrice: 200 })).toBe(2000);
  });

  it('applies the options multiplier', async () => {
    expect(await resolveNotionalUsd({
      symbol: 'AAPL260116C00200000', qty: 5, limitPrice: 12, multiplier: 100, skipQuoteLookup: true,
    })).toBe(6000);
  });

  it('prefers limit_price over stop_price when both are present', async () => {
    expect(await resolveNotionalUsd({ symbol: 'AAPL', qty: 10, limitPrice: 200, stopPrice: 1 })).toBe(2000);
  });

  it('falls back to stop_price for a stop order', async () => {
    expect(await resolveNotionalUsd({ symbol: 'AAPL', qty: 10, stopPrice: 150 })).toBe(1500);
  });

  it('never consults the network when a bound is available', async () => {
    await resolveNotionalUsd({ symbol: 'AAPL', qty: 10, limitPrice: 200 });
    expect(alpacaMock.getLatestTrade).not.toHaveBeenCalled();
    expect(alpacaMock.getSnapshot).not.toHaveBeenCalled();
  });
});

describe('resolveNotionalUsd — market orders must not evaluate to $0', () => {
  it('prices a market order from the latest trade', async () => {
    alpacaMock.getLatestTrade.mockResolvedValue({ trade: { p: 250 } });
    expect(await resolveNotionalUsd({ symbol: 'AAPL', qty: 1000 })).toBe(250_000);
  });

  it('falls back to the snapshot last trade when getLatestTrade throws', async () => {
    alpacaMock.getLatestTrade.mockRejectedValue(new Error('upstream down'));
    alpacaMock.getSnapshot.mockResolvedValue({ latestTrade: { p: 300 } });
    expect(await resolveNotionalUsd({ symbol: 'AAPL', qty: 100 })).toBe(30_000);
  });

  it('uses the ASK (conservative, higher) when no trade price exists', async () => {
    alpacaMock.getLatestTrade.mockResolvedValue({});
    alpacaMock.getSnapshot.mockResolvedValue({ latestQuote: { ap: 310, bp: 290 } });
    expect(await resolveNotionalUsd({ symbol: 'AAPL', qty: 100 })).toBe(31_000);
  });

  it('returns NaN — NOT 0 — when every price source fails', async () => {
    alpacaMock.getLatestTrade.mockRejectedValue(new Error('x'));
    alpacaMock.getSnapshot.mockRejectedValue(new Error('x'));
    const n = await resolveNotionalUsd({ symbol: 'AAPL', qty: 1_000_000 });
    expect(Number.isNaN(n)).toBe(true);
    // Nothing downstream may read this as "small".
    expect(n < 5000).toBe(false);
  });

  it('returns NaN when the broker reports a zero or negative price', async () => {
    alpacaMock.getLatestTrade.mockResolvedValue({ trade: { p: 0 } });
    alpacaMock.getSnapshot.mockResolvedValue({ latestTrade: { p: -5 }, latestQuote: { ap: 0 } });
    expect(Number.isNaN(await resolveNotionalUsd({ symbol: 'AAPL', qty: 100 }))).toBe(true);
  });

  it('returns NaN for an options market order (OCC symbols are not equity-quotable)', async () => {
    const n = await resolveNotionalUsd({
      symbol: 'AAPL260116C00200000', qty: 50, multiplier: 100, skipQuoteLookup: true,
    });
    expect(Number.isNaN(n)).toBe(true);
  });
});

describe('resolveNotionalUsd — malformed quantity and price fail closed', () => {
  const badQty = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const qty of badQty) {
    it(`returns NaN for qty = ${qty}`, async () => {
      expect(Number.isNaN(await resolveNotionalUsd({ symbol: 'AAPL', qty, limitPrice: 100 }))).toBe(true);
    });
  }

  it('ignores a zero or negative limit price rather than pricing the order at $0', async () => {
    alpacaMock.getLatestTrade.mockResolvedValue({ trade: { p: 250 } });
    expect(await resolveNotionalUsd({ symbol: 'AAPL', qty: 100, limitPrice: 0 })).toBe(25_000);
    expect(await resolveNotionalUsd({ symbol: 'AAPL', qty: 100, limitPrice: -50 })).toBe(25_000);
  });

  it('ignores a non-finite limit price and re-prices from the market', async () => {
    alpacaMock.getLatestTrade.mockResolvedValue({ trade: { p: 250 } });
    expect(await resolveNotionalUsd({ symbol: 'AAPL', qty: 100, limitPrice: Number.NaN })).toBe(25_000);
  });

  it('refuses to price an OCC option symbol at the equity multiplier', async () => {
    // Defence in depth against a 100x under-report. The equity order
    // schema already rejects OCC symbols, but a future caller wiring an
    // options contract through the equity path must not silently size it
    // as 1 share per contract.
    const n = await resolveNotionalUsd({ symbol: 'AAPL260116C00200000', qty: 50, limitPrice: 12 });
    expect(Number.isNaN(n)).toBe(true);
  });

  it('never returns a finite number smaller than the true notional', async () => {
    // Property: whatever price source wins, notional === qty x price x mult.
    alpacaMock.getLatestTrade.mockResolvedValue({ trade: { p: 42.5 } });
    for (const qty of [1, 7, 1000, 250_000]) {
      expect(await resolveNotionalUsd({ symbol: 'AAPL', qty })).toBeCloseTo(qty * 42.5, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// assertLiveOrderAllowed — the gates themselves
// ---------------------------------------------------------------------------

describe('assertLiveOrderAllowed — paper mode', () => {
  it('is a no-op that requires no ack and no typed confirm', async () => {
    setMode('paper');
    await expect(assertLiveOrderAllowed({
      request: req(), notionalUsd: 5_000_000, auditContext: {},
    })).resolves.toBeUndefined();
    expect(ackMock.verifyLiveAckToken).not.toHaveBeenCalled();
  });

  it('still enforces mode/URL alignment in paper mode', async () => {
    setMode('paper');
    alpacaMock.assertOrderSubmissionAllowed.mockImplementation(() => {
      throw new Error('Refusing to submit order: ALPACA_BASE_URL host is "api.alpaca.markets"');
    });
    await expect(assertLiveOrderAllowed({ request: req(), notionalUsd: 100, auditContext: {} }))
      .rejects.toThrow(/Refusing to submit order/);
  });

  it('treats an unset TRADING_MODE as paper, never live', async () => {
    setMode(undefined);
    await expect(assertLiveOrderAllowed({ request: req(), notionalUsd: 1_000_000, auditContext: {} }))
      .resolves.toBeUndefined();
    expect(ackMock.verifyLiveAckToken).not.toHaveBeenCalled();
  });

  for (const junk of ['liv', 'true', '1', 'real', '', 'paper', 'LIVEX']) {
    it(`treats TRADING_MODE="${junk}" as paper`, async () => {
      setMode(junk);
      await expect(assertLiveOrderAllowed({ request: req(), notionalUsd: 1_000_000, auditContext: {} }))
        .resolves.toBeUndefined();
    });
  }

  // Deliberate, documented normalisation: getServerTradingMode() trims and
  // lowercases. " LIVE " is a real live-mode setting, not junk — asserted
  // here so nobody "fixes" the trim later and silently unlocks live mode.
  for (const live of ['live', 'LIVE', ' live ', 'Live']) {
    it(`treats TRADING_MODE="${live}" as LIVE and demands an ack`, async () => {
      setMode(live);
      ackMock.verifyLiveAckToken.mockRejectedValue(
        new LiveOrderRejectedError('live_ack_required', 'ack needed'));
      await expect(assertLiveOrderAllowed({ request: req(), notionalUsd: 100, auditContext: {} }))
        .rejects.toMatchObject({ code: 'live_ack_required' });
    });
  }
});

describe('assertLiveOrderAllowed — live mode gates', () => {
  beforeEach(() => { setMode('live'); process.env.LIVE_TYPED_CONFIRM_THRESHOLD_USD = '5000'; });

  it('runs the mode/URL check BEFORE looking up any ack token', async () => {
    alpacaMock.assertOrderSubmissionAllowed.mockImplementation(() => { throw new Error('url drift'); });
    await expect(assertLiveOrderAllowed({ request: req(), notionalUsd: 100, auditContext: {} }))
      .rejects.toThrow(/url drift/);
    expect(ackMock.verifyLiveAckToken).not.toHaveBeenCalled();
  });

  it('BLOCKS when the x-live-ack header is missing', async () => {
    ackMock.verifyLiveAckToken.mockRejectedValue(
      new LiveOrderRejectedError('live_ack_required', 'Live-mode orders require a live-ack token'));
    await expect(assertLiveOrderAllowed({ request: req(), notionalUsd: 100, auditContext: {} }))
      .rejects.toMatchObject({ code: 'live_ack_required' });
    expect(ackMock.verifyLiveAckToken).toHaveBeenCalledWith(undefined, 'sub:wes');
  });

  it('passes the header value and the session subject to the verifier', async () => {
    await assertLiveOrderAllowed({
      request: req({ 'x-live-ack': 'a'.repeat(64) }), notionalUsd: 100, auditContext: {},
    });
    expect(ackMock.verifyLiveAckToken).toHaveBeenCalledWith('a'.repeat(64), 'sub:wes');
  });

  it('BLOCKS when the ack belongs to a different session', async () => {
    ackMock.verifyLiveAckToken.mockRejectedValue(
      new LiveOrderRejectedError('live_ack_invalid', 'Live-ack token was issued to a different session.'));
    await expect(assertLiveOrderAllowed({
      request: req({ 'x-live-ack': 'b'.repeat(64) }), notionalUsd: 100, auditContext: {},
    })).rejects.toMatchObject({ code: 'live_ack_invalid' });
  });

  it('BLOCKS when identity resolution itself fails — it does not skip the ack', async () => {
    identityMock.getRateLimitIdentity.mockRejectedValue(new Error('no session'));
    await expect(assertLiveOrderAllowed({
      request: req({ 'x-live-ack': 'c'.repeat(64) }), notionalUsd: 100, auditContext: {},
    })).rejects.toThrow(/no session/);
  });

  it('BLOCKS a large order with no typed confirm', async () => {
    await expect(assertLiveOrderAllowed({
      request: req({ 'x-live-ack': 'd'.repeat(64) }), notionalUsd: 25_000, auditContext: {},
    })).rejects.toMatchObject({ code: 'typed_confirm_required' });
  });

  it('BLOCKS a large order whose typed confirm does not match', async () => {
    await expect(assertLiveOrderAllowed({
      request: req({ 'x-live-ack': 'd'.repeat(64) }),
      typedConfirm: '2500', notionalUsd: 25_000, auditContext: {},
    })).rejects.toMatchObject({ code: 'typed_confirm_required' });
  });

  it('ALLOWS a large order with an exactly matching typed confirm', async () => {
    await expect(assertLiveOrderAllowed({
      request: req({ 'x-live-ack': 'd'.repeat(64) }),
      typedConfirm: '25000', notionalUsd: 25_000, auditContext: {},
    })).resolves.toBeUndefined();
  });

  it('ALLOWS a small live order without a typed confirm', async () => {
    await expect(assertLiveOrderAllowed({
      request: req({ 'x-live-ack': 'd'.repeat(64) }), notionalUsd: 100, auditContext: {},
    })).resolves.toBeUndefined();
  });

  const indeterminate = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const n of indeterminate) {
    it(`BLOCKS an order whose notional is ${n}`, async () => {
      await expect(assertLiveOrderAllowed({
        request: req({ 'x-live-ack': 'd'.repeat(64) }), notionalUsd: n, auditContext: {},
      })).rejects.toMatchObject({ code: 'notional_indeterminate' });
    });
  }

  it('BLOCKS a negative notional instead of treating it as below threshold', async () => {
    await expect(assertLiveOrderAllowed({
      request: req({ 'x-live-ack': 'd'.repeat(64) }), notionalUsd: -1_000_000, auditContext: {},
    })).rejects.toBeInstanceOf(LiveOrderRejectedError);
  });

  it('records a breadcrumb for every live attempt, pass or reject', async () => {
    await assertLiveOrderAllowed({
      request: req({ 'x-live-ack': 'd'.repeat(64) }), notionalUsd: 100, auditContext: { route: 'r' },
    });
    const categories = sentryMock.addBreadcrumb.mock.calls.map(c => c[0].category);
    expect(categories).toContain('trading.live_attempt');
    expect(categories).toContain('trading.live_pass');
  });

  it('records a reject breadcrumb when a gate blocks', async () => {
    await expect(assertLiveOrderAllowed({
      request: req({ 'x-live-ack': 'd'.repeat(64) }), notionalUsd: 25_000, auditContext: {},
    })).rejects.toThrow();
    const categories = sentryMock.addBreadcrumb.mock.calls.map(c => c[0].category);
    expect(categories).toContain('trading.live_reject');
  });
});

// ---------------------------------------------------------------------------
// assertNotionalTypedConfirm — the typed-confirm comparison itself
// ---------------------------------------------------------------------------

describe('assertNotionalTypedConfirm', () => {
  beforeEach(() => { process.env.LIVE_TYPED_CONFIRM_THRESHOLD_USD = '5000'; });

  it('is a no-op in paper mode regardless of size', () => {
    expect(() => assertNotionalTypedConfirm(10_000_000, undefined, 'paper')).not.toThrow();
  });

  it('passes below the threshold', () => {
    expect(() => assertNotionalTypedConfirm(4_999, undefined, 'live')).not.toThrow();
  });

  it('fires exactly AT the threshold', () => {
    expect(() => assertNotionalTypedConfirm(5_000, undefined, 'live')).toThrow(LiveOrderRejectedError);
    expect(() => assertNotionalTypedConfirm(5_000, '5000', 'live')).not.toThrow();
  });

  it('compares against the notional rounded to the nearest dollar', () => {
    expect(() => assertNotionalTypedConfirm(25_000.49, '25000', 'live')).not.toThrow();
    expect(() => assertNotionalTypedConfirm(25_000.51, '25001', 'live')).not.toThrow();
    expect(() => assertNotionalTypedConfirm(25_000.51, '25000', 'live')).toThrow();
  });

  it('trims surrounding whitespace but rejects formatting', () => {
    expect(() => assertNotionalTypedConfirm(25_000, '  25000 ', 'live')).not.toThrow();
    for (const bad of ['$25000', '25,000', '25000.00', '25 000', '2.5e4', '']) {
      expect(() => assertNotionalTypedConfirm(25_000, bad, 'live'), bad).toThrow();
    }
  });

  it('fails closed on an indeterminate notional', () => {
    for (const n of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      let caught: unknown;
      try { assertNotionalTypedConfirm(n, '999999999', 'live'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(LiveOrderRejectedError);
      expect((caught as LiveOrderRejectedError).code).toBe('notional_indeterminate');
    }
  });

  it('rejects a negative notional', () => {
    expect(() => assertNotionalTypedConfirm(-25_000, undefined, 'live')).toThrow(LiveOrderRejectedError);
  });

  it('honours a custom threshold and ignores a malformed one', () => {
    process.env.LIVE_TYPED_CONFIRM_THRESHOLD_USD = '1000';
    expect(() => assertNotionalTypedConfirm(1_500, undefined, 'live')).toThrow();

    process.env.LIVE_TYPED_CONFIRM_THRESHOLD_USD = 'not-a-number';
    expect(() => assertNotionalTypedConfirm(4_999, undefined, 'live')).not.toThrow(); // default 5000
    expect(() => assertNotionalTypedConfirm(5_001, undefined, 'live')).toThrow();

    process.env.LIVE_TYPED_CONFIRM_THRESHOLD_USD = '-1';
    expect(() => assertNotionalTypedConfirm(5_001, undefined, 'live')).toThrow(); // negative -> default
  });
});

describe('formatLiveOrderRejection', () => {
  it('maps each code to its HTTP status', () => {
    const cases: Array<[LiveOrderRejectedError['code'], number]> = [
      ['trading_mode_paper', 403],
      ['live_ack_required', 428],
      ['live_ack_expired', 428],
      ['live_ack_invalid', 403],
      ['typed_confirm_required', 428],
      ['notional_indeterminate', 428],
      ['autopilot_live_disabled', 403],
    ];
    for (const [code, status] of cases) {
      const [, init] = formatLiveOrderRejection(new LiveOrderRejectedError(code, 'm'));
      expect(init.status, code).toBe(status);
    }
  });

  it("echoes the SERVER's notional so the confirm dialog cannot loop forever", () => {
    const [body] = formatLiveOrderRejection(
      new LiveOrderRejectedError('typed_confirm_required', 'm', { notionalUsd: 25_000, thresholdUsd: 5_000 }));
    expect(body.notional_usd).toBe(25_000);
    expect(body.threshold_usd).toBe(5_000);
    expect(body.code).toBe('typed_confirm_required');
  });

  it('omits the detail fields when there are none', () => {
    const [body] = formatLiveOrderRejection(new LiveOrderRejectedError('live_ack_required', 'm'));
    expect(body).not.toHaveProperty('notional_usd');
  });
});
