import { NextRequest, NextResponse } from 'next/server';
import { getOrders, submitOrder } from '@/lib/alpaca';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { runOrderGuards } from '@/lib/order-guards';
import { runDebateGate, shouldRunDebateGate, type DebateGateVerdict } from '@/lib/order-guards/debate-gate';
import { alpacaOrderRequestSchema } from '@/lib/order-schemas';
import { publicError, validationError, captureAndPublic } from '@/lib/api-error';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || 'all';
  try {
    const orders = await getOrders(status);
    return NextResponse.json(orders);
  } catch (error) {
    return captureAndPublic(error, 'INTERNAL_ERROR');
  }
}

export async function POST(req: NextRequest) {
  // Codex round-3 P1: durable, session-keyed limit. The pre-fix in-memory
  // limiter forked per Vercel instance, so the effective cap was
  // 30 × N warm workers — a real money-moving amplification surface.
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('alpaca-orders', key, 30, 60);
  if (!allowed) return publicError('RATE_LIMITED', 'Too many requests');

  let parsed;
  try {
    const raw = await req.json();
    // P0-4 (hardening/p0-codex-fixes): the equity order schema rejects NaN
    // qty, lowercase symbols, unknown fields, and missing limit_price for
    // type=limit. `mode` and `force` are the only extras the route allows.
    const result = alpacaOrderRequestSchema.safeParse(raw);
    if (!result.success) return validationError(result.error);
    parsed = result.data;
  } catch (err) {
    return captureAndPublic(err, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  // F12 — pre-trade guards (PDT + wash-sale). `mode: 'preview'` returns
  // the verdict without submitting; `force: true` overrides a 'block'
  // verdict when Wes has explicitly accepted the risk.
  // F11 — Debate-agent gate fires for orders ≥ $5K notional and can also
  // block submission with a 'reject' verdict.
  const isPreview = parsed.mode === 'preview';
  const isForced = parsed.force === true;
  const estimatedPrice = parsed.limit_price ?? 0;

  const guards = await runOrderGuards({
    symbol: parsed.symbol,
    side: parsed.side,
    qty: parsed.qty,
    estimatedPrice: estimatedPrice || undefined,
  });

  let debate: DebateGateVerdict | null = null;
  if (estimatedPrice > 0 && shouldRunDebateGate(parsed.qty * estimatedPrice)) {
    const contextNotes = [
      `F12 verdict: ${guards.verdict}`,
      ...guards.reasons.map(r => `  - ${r}`),
    ].join('\n');
    debate = await runDebateGate({
      symbol: parsed.symbol,
      side: parsed.side,
      qty: parsed.qty,
      estimatedPrice,
      contextNotes,
    });
  }

  if (isPreview) {
    return NextResponse.json({ preview: true, guards, debate });
  }

  if (guards.verdict === 'block' && !isForced) {
    return NextResponse.json(
      {
        code: 'ORDER_BLOCKED',
        message: 'Order blocked by pre-trade guards',
        guards,
        debate,
        hint: 'Re-submit with `force: true` if you have explicitly accepted this risk.',
      },
      { status: 409 },
    );
  }

  if (debate?.verdict === 'reject' && !isForced) {
    return NextResponse.json(
      {
        code: 'ORDER_BLOCKED',
        message: 'Order rejected by debate gate',
        guards,
        debate,
        hint: 'Re-submit with `force: true` to override the debate verdict.',
      },
      { status: 409 },
    );
  }

  try {
    // submitOrder() expects the broker payload, not our extras.
    const broker = {
      symbol: parsed.symbol,
      qty: parsed.qty,
      side: parsed.side,
      type: parsed.type,
      time_in_force: parsed.time_in_force,
      ...(parsed.limit_price !== undefined ? { limit_price: parsed.limit_price } : {}),
      ...(parsed.stop_price !== undefined ? { stop_price: parsed.stop_price } : {}),
    };
    const order = await submitOrder(broker);
    return NextResponse.json(order);
  } catch (error) {
    return captureAndPublic(error, 'ORDER_REJECTED');
  }
}
