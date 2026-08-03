import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { ALPACA_BASE_URL } from '@/lib/alpaca';
import { multiLegOrderSchema } from '@/lib/order-schemas';
import { publicError, validationError, captureAndPublic } from '@/lib/api-error';
import { assertLiveOrderAllowed, formatLiveOrderRejection } from '@/lib/live-order-safety';
import { LiveOrderRejectedError } from '@/lib/trading-mode';

const alpacaHeaders = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
  'Content-Type': 'application/json',
};

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('multi-leg-order', 10, 60000);
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
    // P0-4: zod-validate the entire multi-leg shape — bounds leg count to
    // ≤4, asserts every leg's OCC symbol matches the regex, and caps total
    // ratio_qty so a malformed payload can't queue a 100M-contract trade.
    const result = multiLegOrderSchema.safeParse(raw);
    if (!result.success) return validationError(result.error);
    parsed = result.data;
  } catch (err) {
    return captureAndPublic(err, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const order: Record<string, unknown> = {
    order_class: 'mleg',
    type: parsed.type,
    time_in_force: parsed.time_in_force,
    legs: parsed.legs.map(leg => ({
      symbol: leg.symbol,
      side: leg.side,
      ratio_qty: leg.ratio_qty,
      ...(leg.position_intent ? { position_intent: leg.position_intent } : {}),
    })),
  };
  if (parsed.limit_price !== undefined) order.limit_price = parsed.limit_price;

  // Multi-leg notional.
  //
  // The pre-fix version used Σ(ratio) × NET limit_price × 100. That is not
  // the order's economic exposure: for a credit spread the net price is
  // negative or near-zero, so a structure with five-figure max loss scored
  // as a sub-threshold order and skipped the typed-confirm gate.
  //
  // Without per-leg option prices we cannot compute true max loss here, so
  // we take the conservative route: GROSS ratio × |net price| × 100, and
  // fail closed (NaN) whenever there is no limit price at all. Anything
  // whose exposure we can't bound gets rejected with notional_indeterminate
  // rather than waved through.
  const grossRatio = parsed.legs.reduce((s, l) => s + Math.abs(l.ratio_qty || 0), 0);
  const netPrice = Math.abs(Number(parsed.limit_price ?? Number.NaN));
  const notionalUsd = Number.isFinite(netPrice) && netPrice > 0
    ? grossRatio * netPrice * 100
    : Number.NaN;

  try {
    await assertLiveOrderAllowed({
      request: req,
      typedConfirm,
      notionalUsd,
      auditContext: { route: 'options/multi-leg', legs: parsed.legs.length, type: parsed.type },
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
    const errorText = await res.text().catch(() => '<no body>');
    return captureAndPublic(
      new Error(`Alpaca multi-leg rejected: HTTP ${res.status}: ${errorText.slice(0, 500)}`),
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
      order_class: result.order_class,
      type: result.type,
      status: result.status,
      legs: result.legs,
      submitted_at: result.submitted_at,
    },
  });
}
