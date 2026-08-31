/**
 * The single helper every order-submission route calls before dropping
 * an order into Alpaca. Bundles the three live-mode checks:
 *   1. Mode/URL alignment (assertOrderSubmissionAllowed)
 *   2. Session ack token (verifyLiveAckToken)
 *   3. Notional typed confirm (assertNotionalTypedConfirm)
 *
 * Paper-mode fast path is a no-op. Live-mode failure throws
 * LiveOrderRejectedError with a machine-readable code the route can
 * translate to an HTTP status + JSON body.
 *
 * Also records a Sentry breadcrumb for every live-mode attempt
 * (success OR reject) so post-hoc audit is possible.
 */

import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { assertOrderSubmissionAllowed, getLatestTrade, getSnapshot } from '@/lib/alpaca';
import { assertNotionalTypedConfirm, getServerTradingMode, LiveOrderRejectedError } from '@/lib/trading-mode';
import { verifyLiveAckToken } from '@/lib/live-ack';
import { getRateLimitIdentity } from '@/lib/rate-limit-durable';

/** OCC contract symbol: ROOT(1-6) + YYMMDD + C|P + 8-digit strike. */
const OCC_SYMBOL_RE = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/;

/**
 * Resolve the dollar value of an order so the typed-confirm gate can be
 * applied to it.
 *
 * The original implementation computed `qty × (limit_price ?? 0)`, which
 * meant every MARKET order — the exact orders whose fill price is
 * unbounded — evaluated to $0 and skipped the gate no matter how large.
 * A 1,000,000-share market buy sailed through.
 *
 * Resolution order:
 *   1. limit_price when present (the price the order can't exceed)
 *   2. stop_price for stop orders (best available bound)
 *   3. a live quote from Alpaca's data API for market orders
 *   4. NaN → caller's assertNotionalTypedConfirm FAILS CLOSED
 *
 * Returns NaN rather than throwing so the caller decides the policy;
 * assertNotionalTypedConfirm rejects non-finite notionals in live mode.
 */
export async function resolveNotionalUsd(args: {
  symbol: string;
  qty: number;
  limitPrice?: number;
  stopPrice?: number;
  /** 100 for options contracts, 1 (default) for equities. */
  multiplier?: number;
  /** Skip the network quote — options symbols aren't equity-quotable. */
  skipQuoteLookup?: boolean;
}): Promise<number> {
  const mult = args.multiplier ?? 1;
  const qty = Number(args.qty);
  if (!Number.isFinite(qty) || qty <= 0) return Number.NaN;

  // Defence in depth against a 100x under-report. An OCC contract priced
  // at the equity multiplier reports 1/100th of its true exposure, which
  // is exactly how a five-figure order slips under the typed-confirm
  // threshold. The equity order schema already rejects OCC symbols; this
  // makes the mistake impossible for any future caller too.
  if (OCC_SYMBOL_RE.test(args.symbol) && mult !== 100) return Number.NaN;

  const bounded = Number(args.limitPrice ?? args.stopPrice ?? Number.NaN);
  if (Number.isFinite(bounded) && bounded > 0) return qty * bounded * mult;

  if (args.skipQuoteLookup) return Number.NaN;

  // Market order — ask the broker what it's currently worth.
  try {
    const trade = await getLatestTrade(args.symbol) as { trade?: { p?: number } };
    const px = Number(trade?.trade?.p);
    if (Number.isFinite(px) && px > 0) return qty * px * mult;
  } catch { /* fall through to snapshot */ }

  try {
    const snap = await getSnapshot(args.symbol) as {
      latestTrade?: { p?: number };
      latestQuote?: { ap?: number; bp?: number };
    };
    const last = Number(snap?.latestTrade?.p);
    if (Number.isFinite(last) && last > 0) return qty * last * mult;
    // Use the ASK for a conservative (higher) estimate on a buy.
    const ask = Number(snap?.latestQuote?.ap);
    if (Number.isFinite(ask) && ask > 0) return qty * ask * mult;
  } catch { /* fall through to NaN */ }

  return Number.NaN;
}

export interface LiveOrderCheckArgs {
  request: NextRequest;
  /**
   * Client-supplied typed confirm string (from the POST body). Compared
   * against Math.round(notionalUsd).toString() when notional >= threshold.
   */
  typedConfirm?: string;
  /**
   * Order notional in USD. Use resolveNotionalUsd() to compute it — a
   * hand-rolled `qty × limit_price` reintroduces the market-order bypass.
   * NaN is legal and FAILS CLOSED in live mode.
   */
  notionalUsd: number;
  /** Free-form label for the audit trail (route name, symbol). */
  auditContext: Record<string, string | number>;
}

export async function assertLiveOrderAllowed(args: LiveOrderCheckArgs): Promise<void> {
  const mode = getServerTradingMode();

  // 1. Mode/URL alignment — throws on drift (both modes).
  assertOrderSubmissionAllowed();

  // Paper mode fast-path: no ack / no typed confirm needed.
  if (mode !== 'live') return;

  // Breadcrumb every live-mode attempt regardless of outcome.
  Sentry.addBreadcrumb({
    category: 'trading.live_attempt',
    level: 'warning',
    message: 'Live-mode order submission attempted',
    data: {
      notional_usd: args.notionalUsd,
      ...args.auditContext,
    },
  });

  // 2. Session ack — token comes in via the x-live-ack header, and must
  //    have been minted for THIS session (possession alone is not enough).
  const token = args.request.headers.get('x-live-ack') ?? undefined;
  try {
    const { key: subject } = await getRateLimitIdentity(args.request);
    await verifyLiveAckToken(token, subject);
  } catch (err) {
    Sentry.addBreadcrumb({
      category: 'trading.live_reject',
      level: 'error',
      message: 'Live-mode order rejected: ack invalid',
      data: { reason: (err as Error).message, ...args.auditContext },
    });
    throw err;
  }

  // 3. Notional typed confirm — throws LiveOrderRejectedError.typed_confirm_required
  try {
    assertNotionalTypedConfirm(args.notionalUsd, args.typedConfirm, mode);
  } catch (err) {
    Sentry.addBreadcrumb({
      category: 'trading.live_reject',
      level: 'error',
      message: 'Live-mode order rejected: typed confirm missing / mismatched',
      data: {
        notional_usd: args.notionalUsd,
        typed_confirm_supplied: !!args.typedConfirm,
        ...args.auditContext,
      },
    });
    throw err;
  }

  Sentry.addBreadcrumb({
    category: 'trading.live_pass',
    level: 'info',
    message: 'Live-mode order passed safety checks',
    data: { notional_usd: args.notionalUsd, ...args.auditContext },
  });
}

/**
 * Format LiveOrderRejectedError as a NextResponse-compatible tuple.
 * Routes can do: `if (err instanceof LiveOrderRejectedError) return NextResponse.json(...formatLiveOrderRejection(err))`.
 */
export function formatLiveOrderRejection(
  err: LiveOrderRejectedError,
): [Record<string, string | number>, { status: number }] {
  return [
    {
      error: err.message,
      code: err.code,
      // Echo the SERVER's notional so the confirm dialog renders the exact
      // figure the server will compare against. Without this the client's
      // own estimate (stale quote, market order) can differ and the user
      // types a number that never matches — an unbreakable loop.
      ...(err.detail?.notionalUsd !== undefined ? { notional_usd: err.detail.notionalUsd } : {}),
      ...(err.detail?.thresholdUsd !== undefined ? { threshold_usd: err.detail.thresholdUsd } : {}),
    },
    { status: err.status() },
  ];
}
