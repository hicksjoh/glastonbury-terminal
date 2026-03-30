import { NextRequest, NextResponse } from 'next/server';

const ALPACA_BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

const alpacaHeaders = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
  'Content-Type': 'application/json',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { symbol, qty, side, type, time_in_force, limit_price, stop_price } = body;

    // Validate required fields
    if (!symbol || !qty || !side || !type) {
      return NextResponse.json(
        { error: 'Missing required fields: symbol, qty, side, type' },
        { status: 400 }
      );
    }

    if (!['buy', 'sell'].includes(side)) {
      return NextResponse.json({ error: 'Side must be "buy" or "sell"' }, { status: 400 });
    }

    if (!['market', 'limit', 'stop', 'stop_limit'].includes(type)) {
      return NextResponse.json({ error: 'Invalid order type' }, { status: 400 });
    }

    // Build Alpaca order payload
    const order: Record<string, unknown> = {
      symbol,
      qty: parseInt(qty),
      side,
      type,
      time_in_force: time_in_force || 'day',
    };

    if ((type === 'limit' || type === 'stop_limit') && limit_price) {
      order.limit_price = parseFloat(limit_price);
    }

    if ((type === 'stop' || type === 'stop_limit') && stop_price) {
      order.stop_price = parseFloat(stop_price);
    }

    // Submit to Alpaca
    const res = await fetch(`${ALPACA_BASE_URL}/v2/orders`, {
      method: 'POST',
      headers: alpacaHeaders,
      body: JSON.stringify(order),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Alpaca options order error:', res.status, errorText);
      return NextResponse.json(
        { error: `Order rejected: ${errorText}` },
        { status: res.status }
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
  } catch (err) {
    console.error('Options order error:', err);
    return NextResponse.json({ error: 'Failed to submit order' }, { status: 500 });
  }
}
