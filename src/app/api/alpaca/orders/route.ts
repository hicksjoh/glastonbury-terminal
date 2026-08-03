import { NextRequest, NextResponse } from 'next/server';
import { getOrders, submitOrder } from '@/lib/alpaca';
import { rateLimit } from '@/lib/rate-limit';
import { runOrderGuards } from '@/lib/order-guards';
import { runDebateGate, shouldRunDebateGate, type DebateGateVerdict } from '@/lib/order-guards/debate-gate';
import { alpacaOrderRequestSchema } from '@/lib/order-schemas';
import { publicError, validationError, captureAndPublic } from '@/lib/api-error';
import { assertLiveOrderAllowed, formatLiveOrderRejection, resolveNotionalUsd } from '@/lib/live-order-safety';
import { LiveOrderRejectedError } from '@/lib/trading-mode';

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
  const { allowed } = rateLimit('orders', 30, 60000);
  if (!allowed) return publicError('RATE_LIMITED', 'Too many requests');

  let parsed;
  let typedConfirm: string | undefined;
  try {
    const raw = await req.json();
    // P0-4 (hardening/p0-codex-fixes): the equity order schema rejects NaN
    // qty, lowercase symbols, unknown fields, and missing limit_price for
    // type=limit. `mode` and `force` are the only extras the schema allows.
    // `typedConfirm` is a route-level live-safety field, plucked before parse.
    if (raw && typeof raw === 'object') {
      typedConfirm = typeof (raw as { typedConfirm?: unknown }).typedConfirm === 'string'
        ? (raw as { typedConfirm: string }).typedConfirm
        : undefined;
      delete (raw as { typedConfirm?: unknown }).typedConfirm;
    }
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

  // Live-mode safety layer — no-op in paper, hard-blocks in live without
  // (a) mode/URL alignment, (b) valid session-bound x-live-ack header,
  // (c) typedConfirm matching notional when ≥ LIVE_TYPED_CONFIRM_THRESHOLD_USD.
  // resolveNotionalUsd falls back to a live quote for market orders so a
  // large market order can't slip the gate by having no limit_price.
  const notionalUsd = await resolveNotionalUsd({
    symbol: parsed.symbol,
    qty: parsed.qty,
    limitPrice: parsed.limit_price,
    stopPrice: parsed.stop_price,
  });
  try {
    await assertLiveOrderAllowed({
      request: req,
      typedConfirm,
      notionalUsd,
      auditContext: { route: 'alpaca/orders', symbol: parsed.symbol, side: parsed.side, qty: parsed.qty },
    });
  } catch (err) {
    if (err instanceof LiveOrderRejectedError) {
      const [body, init] = formatLiveOrderRejection(err);
      return NextResponse.json(body, init);
    }
    return captureAndPublic(err, 'INTERNAL_ERROR');
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
