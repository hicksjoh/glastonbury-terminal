import { NextRequest, NextResponse } from 'next/server';
import { analyzeFactorExposure } from '@/lib/factor-engine';
import { buildMeta } from '@/lib/api-meta';

export async function GET(req: NextRequest) {
  try {
    // Get portfolio positions from Alpaca
    const alpacaKey = process.env.ALPACA_API_KEY;
    const alpacaSecret = process.env.ALPACA_SECRET_KEY;

    if (!alpacaKey || !alpacaSecret) {
      return NextResponse.json({
        error: 'Alpaca not configured',
        _meta: buildMeta({ source: 'alpaca', live: false, error: 'No API key' }),
      }, { status: 500 });
    }

    const res = await fetch('https://paper-api.alpaca.markets/v2/positions', {
      headers: {
        'APCA-API-KEY-ID': alpacaKey,
        'APCA-API-SECRET-KEY': alpacaSecret,
      },
    });

    if (!res.ok) {
      return NextResponse.json({
        error: 'Failed to fetch positions',
        _meta: buildMeta({ source: 'alpaca', live: false, error: `HTTP ${res.status}` }),
      }, { status: 500 });
    }

    const positions = await res.json();
    if (!Array.isArray(positions) || positions.length === 0) {
      return NextResponse.json({
        analysis: analyzeFactorExposure([]),
        positions: [],
        _meta: buildMeta({ source: 'alpaca', live: true }),
      });
    }

    // Map Alpaca positions to factor analysis input
    const holdings = positions.map((p: Record<string, unknown>) => ({
      symbol: String(p.symbol || ''),
      weight: Number(p.market_value || 0),
      beta: undefined, // could be enriched with FMP data
      marketCap: undefined,
      peRatio: undefined,
      momentum1Y: Number(p.unrealized_plpc || 0) * 100,
      volatility: undefined,
      roe: undefined,
    }));

    // Normalize weights to sum to 1
    const totalValue = holdings.reduce((sum: number, h: { weight: number }) => sum + h.weight, 0);
    if (totalValue > 0) {
      for (const h of holdings) {
        h.weight = h.weight / totalValue;
      }
    }

    const analysis = analyzeFactorExposure(holdings);

    return NextResponse.json({
      analysis,
      positionCount: positions.length,
      totalValue,
      _meta: buildMeta({ source: 'alpaca:computed', live: true }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: msg,
      _meta: buildMeta({ source: 'error', live: false, error: msg }),
    }, { status: 500 });
  }
}
