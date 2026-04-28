import { NextRequest, NextResponse } from 'next/server';
import { getOrders, submitOrder } from '@/lib/alpaca';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeSymbol } from '@/lib/sanitize';
import { runOrderGuards } from '@/lib/order-guards';
import { runDebateGate, shouldRunDebateGate, type DebateGateVerdict } from '@/lib/order-guards/debate-gate';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || 'all';
  try {
    const orders = await getOrders(status);
    return NextResponse.json(orders);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('orders', 30, 60000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const body = await req.json();
    if (body.symbol) body.symbol = sanitizeSymbol(body.symbol);

    // F12 — pre-trade guards (PDT + wash-sale). `mode: 'preview'` returns
    // the verdict without submitting; `force: true` overrides a 'block'
    // verdict when Wes has explicitly accepted the risk.
    // F11 — Debate-agent gate fires for orders ≥ $5K notional and can
    // also block submission with a 'reject' verdict.
    const isPreview = body.mode === 'preview';
    const isForced = body.force === true;
    if (body.symbol && body.side && body.qty) {
      const symbol = String(body.symbol);
      const side: 'buy' | 'sell' = body.side === 'sell' ? 'sell' : 'buy';
      const qty = Number(body.qty);
      const estimatedPrice = body.limit_price !== undefined ? Number(body.limit_price) : 0;

      const guards = await runOrderGuards({
        symbol,
        side,
        qty,
        estimatedPrice: estimatedPrice || undefined,
      });

      let debate: DebateGateVerdict | null = null;
      if (estimatedPrice > 0 && shouldRunDebateGate(qty * estimatedPrice)) {
        const contextNotes = [
          `F12 verdict: ${guards.verdict}`,
          ...guards.reasons.map(r => `  - ${r}`),
        ].join('\n');
        debate = await runDebateGate({ symbol, side, qty, estimatedPrice, contextNotes });
      }

      if (isPreview) {
        return NextResponse.json({ preview: true, guards, debate });
      }

      if (guards.verdict === 'block' && !isForced) {
        return NextResponse.json(
          {
            error: 'Order blocked by pre-trade guards',
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
            error: 'Order rejected by debate gate',
            guards,
            debate,
            hint: 'Re-submit with `force: true` to override the debate verdict.',
          },
          { status: 409 },
        );
      }
    }

    const order = await submitOrder(body);
    return NextResponse.json(order);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
