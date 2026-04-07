import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

const ALPACA_BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

const alpacaHeaders = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
  'Content-Type': 'application/json',
};

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('multi-leg-order', 10, 60000);
  if (!allowed) return NextResponse.json({ error: 'Too many order requests' }, { status: 429 });

  try {
    const body = await req.json();
    const { legs, type, time_in_force, limit_price } = body;

    if (!legs || !Array.isArray(legs) || legs.length < 2) {
      return NextResponse.json(
        { error: 'Multi-leg orders require at least 2 legs' },
        { status: 400 }
      );
    }

    // Validate each leg
    for (const leg of legs) {
      if (!leg.symbol || !leg.side || !leg.ratio_qty) {
        return NextResponse.json(
          { error: 'Each leg requires: symbol, side, ratio_qty' },
          { status: 400 }
        );
      }
    }

    // Build multi-leg order for Alpaca
    const order: Record<string, unknown> = {
      order_class: 'mleg',
      type: type || 'limit',
      time_in_force: time_in_force || 'day',
      legs: legs.map((leg: { symbol: string; side: string; ratio_qty: number }) => ({
        symbol: leg.symbol,
        side: leg.side,
        ratio_qty: leg.ratio_qty,
      })),
    };

    if (limit_price) {
      order.limit_price = parseFloat(limit_price);
    }

    const res = await fetch(`${ALPACA_BASE_URL}/v2/orders`, {
      method: 'POST',
      headers: alpacaHeaders,
      body: JSON.stringify(order),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Alpaca multi-leg order error:', res.status, errorText);
      return NextResponse.json(
        { error: `Multi-leg order rejected: ${errorText}` },
        { status: res.status }
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
  } catch (err) {
    console.error('Multi-leg order error:', err);
    return NextResponse.json({ error: 'Failed to submit multi-leg order' }, { status: 500 });
  }
}
