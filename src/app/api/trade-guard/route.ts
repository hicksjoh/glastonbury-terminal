import { NextRequest, NextResponse } from 'next/server';
import { runTradeGuard } from '@/lib/trade-guard-engine';

/**
 * Trade Guard API — Pre-trade safety net
 * Delegates to shared engine for behavioral checks, Kelly sizing, and regime detection
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { symbol, side, quantity, price, winRate, avgWin, avgLoss, wasOnWatchlist } = body;

    const result = await runTradeGuard({
      symbol,
      side,
      quantity,
      price,
      winRate,
      avgWin,
      avgLoss,
      wasOnWatchlist,
    });

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Trade guard error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
