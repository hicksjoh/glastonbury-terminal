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
import { assertOrderSubmissionAllowed } from '@/lib/alpaca';
import { assertNotionalTypedConfirm, getServerTradingMode, LiveOrderRejectedError } from '@/lib/trading-mode';
import { verifyLiveAckToken } from '@/lib/live-ack';

export interface LiveOrderCheckArgs {
  request: NextRequest;
  /**
   * Client-supplied typed confirm string (from the POST body). Compared
   * against Math.round(notionalUsd).toString() when notional >= threshold.
   */
  typedConfirm?: string;
  /**
   * Estimated notional in USD (qty × price). Market orders pass 0 here;
   * the typed-confirm check auto-passes for market orders unless the
   * caller supplies an estimate.
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

  // 2. Session ack — token comes in via the x-live-ack header
  const token = args.request.headers.get('x-live-ack') ?? undefined;
  try {
    await verifyLiveAckToken(token);
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
export function formatLiveOrderRejection(err: LiveOrderRejectedError): [Record<string, string>, { status: number }] {
  return [
    { error: err.message, code: err.code },
    { status: err.status() },
  ];
}
