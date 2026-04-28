import { NextRequest, NextResponse } from 'next/server';
import { getOrders, submitOrder } from '@/lib/alpaca';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeSymbol } from '@/lib/sanitize';
import { runOrderGuards } from '@/lib/order-guards';

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

    // F12 — pre-trade guards. `mode: 'preview'` returns the verdict
    // without actually submitting the order so the UI can show wash-sale
    // and PDT warnings before Wes hits buy/sell. `force: true` overrides
    // a "block" verdict when Wes has explicitly accepted the risk.
    const isPreview = body.mode === 'preview';
    const isForced = body.force === true;
    if (body.symbol && body.side && body.qty) {
      const guards = await runOrderGuards({
        symbol: String(body.symbol),
        side: body.side === 'sell' ? 'sell' : 'buy',
        qty: Number(body.qty),
        estimatedPrice: body.limit_price !== undefined ? Number(body.limit_price) : undefined,
      });

      if (isPreview) {
        return NextResponse.json({ preview: true, guards });
      }

      if (guards.verdict === 'block' && !isForced) {
        return NextResponse.json(
          {
            error: 'Order blocked by pre-trade guards',
            guards,
            hint: 'Re-submit with `force: true` if you have explicitly accepted this risk.',
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
