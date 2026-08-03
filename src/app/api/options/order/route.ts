import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { ALPACA_BASE_URL } from '@/lib/alpaca';
import { singleOrderSchema } from '@/lib/order-schemas';
import { publicError, validationError, captureAndPublic } from '@/lib/api-error';
import { assertLiveOrderAllowed, formatLiveOrderRejection, resolveNotionalUsd } from '@/lib/live-order-safety';
import { LiveOrderRejectedError } from '@/lib/trading-mode';

const alpacaHeaders = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
  'Content-Type': 'application/json',
};

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('options-order', 10, 60000);
  if (!allowed) return publicError('RATE_LIMITED', 'Too many order requests');

  let parsed;
  let typedConfirm: string | undefined;
  try {
    const raw = await req.json();
    if (raw && typeof raw === 'object') {
      typedConfirm = typeof (raw as { typedConfirm?: unknown }).typedConfirm === 'string'
        ? (raw as { typedConfirm: string }).typedConfirm
        : undefined;
      delete (raw as { typedConfirm?: unknown }).typedConfirm;
    }
    // P0-4 (hardening/p0-codex-fixes): zod parse before any property reads
    // so NaN qty, lowercase symbols, and unknown fields die at the boundary.
    const result = singleOrderSchema.safeParse(raw);
    if (!result.success) return validationError(result.error);
    parsed = result.data;
  } catch (err) {
    return captureAndPublic(err, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  // Build Alpaca order payload from validated input.
  const order: Record<string, unknown> = {
    symbol: parsed.symbol,
    qty: parsed.qty,
    side: parsed.side,
    type: parsed.type,
    time_in_force: parsed.time_in_force,
  };
  if (parsed.limit_price !== undefined) order.limit_price = parsed.limit_price;
  if (parsed.stop_price !== undefined) order.stop_price = parsed.stop_price;

  // Options settle per-share × 100. skipQuoteLookup because OCC symbols
  // aren't equity-quotable — a market options order therefore resolves to
  // NaN and FAILS CLOSED (assertNotionalTypedConfirm rejects it with
  // notional_indeterminate, telling the user to use a limit order).
  const notionalUsd = await resolveNotionalUsd({
    symbol: parsed.symbol,
    qty: parsed.qty,
    limitPrice: parsed.limit_price,
    stopPrice: parsed.stop_price,
    multiplier: 100,
    skipQuoteLookup: true,
  });

  // Live-mode safety: mode/URL alignment, x-live-ack header, typedConfirm.
  try {
    await assertLiveOrderAllowed({
      request: req,
      typedConfirm,
      notionalUsd,
      auditContext: { route: 'options/order', symbol: parsed.symbol, side: parsed.side, qty: parsed.qty },
    });
  } catch (lockErr) {
    if (lockErr instanceof LiveOrderRejectedError) {
      const [body, init] = formatLiveOrderRejection(lockErr);
      return NextResponse.json(body, init);
    }
    return captureAndPublic(lockErr, 'INTERNAL_ERROR', 'Order blocked by safety layer');
  }

  let res: Response;
  try {
    res = await fetch(`${ALPACA_BASE_URL}/v2/orders`, {
      method: 'POST',
      headers: alpacaHeaders,
      body: JSON.stringify(order),
    });
  } catch (err) {
    return captureAndPublic(err, 'UPSTREAM_UNAVAILABLE');
  }

  if (!res.ok) {
    // Read the body for Sentry so we can debug, but DO NOT echo it back.
    // Before this fix, we returned `Order rejected: ${errorText}` straight
    // to the client — leaking Alpaca internals (account ID, position state).
    const errorText = await res.text().catch(() => '<no body>');
    return captureAndPublic(
      new Error(`Alpaca order rejected: HTTP ${res.status}: ${errorText.slice(0, 500)}`),
      'ORDER_REJECTED',
      undefined,
      res.status === 422 ? 422 : 502,
    );
  }

  const result = await res.json();
  return NextResponse.json({
    success: true,
    order: {
      id: result.id,
      symbol: result.symbol,
      qty: result.qty,
      side: result.side,
      type: result.type,
      status: result.status,
      submitted_at: result.submitted_at,
    },
  });
}
