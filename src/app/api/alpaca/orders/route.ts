import { NextRequest, NextResponse } from 'next/server';
import { getOrders, submitOrder } from '@/lib/alpaca';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeSymbol } from '@/lib/sanitize';

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
    const order = await submitOrder(body);
    return NextResponse.json(order);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
