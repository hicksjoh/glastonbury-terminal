import { NextRequest, NextResponse } from 'next/server';
import { getLatestQuote } from '@/lib/alpaca';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');
  if (!symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 });
  try {
    const quote = await getLatestQuote(symbol);
    return NextResponse.json(quote);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
