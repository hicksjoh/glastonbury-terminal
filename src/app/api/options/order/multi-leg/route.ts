import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { ALPACA_BASE_URL, assertPaperTrading } from '@/lib/alpaca';
import { multiLegOrderSchema } from '@/lib/order-schemas';
import { publicError, validationError, captureAndPublic } from '@/lib/api-error';

const alpacaHeaders = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
  'Content-Type': 'application/json',
};

export async function POST(req: NextRequest) {
  // Codex round-3 P1: durable, session-keyed limit. Multi-leg orders can
  // submit up to 4 simultaneous fills, so the wallet impact of an unbounded
  // caller is 4× a single-order amplification.
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('options-multi-leg-order', key, 10, 60);
  if (!allowed) return publicError('RATE_LIMITED', 'Too many order requests');

  let parsed;
  try {
    const raw = await req.json();
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

  try {
    assertPaperTrading();
  } catch (lockErr) {
    return captureAndPublic(lockErr, 'INTERNAL_ERROR', 'Paper-trading lock engaged');
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
