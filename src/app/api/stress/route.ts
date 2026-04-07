import { NextRequest, NextResponse } from 'next/server';
import { runAllStressTests, STRESS_SCENARIOS } from '@/lib/stress-test-engine';
import { buildMeta } from '@/lib/api-meta';

export async function GET(req: NextRequest) {
  try {
    const scenario = req.nextUrl.searchParams.get('scenario');

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
    const positionInputs = (Array.isArray(positions) ? positions : []).map((p: Record<string, unknown>) => ({
      symbol: String(p.symbol || ''),
      value: Math.abs(Number(p.market_value || 0)),
      sector: undefined as string | undefined,
      beta: undefined as number | undefined,
    }));

    if (scenario) {
      // Run single scenario
      const found = STRESS_SCENARIOS.find(s =>
        s.name.toLowerCase().replace(/\s/g, '_') === scenario.toLowerCase() ||
        s.name.toLowerCase() === scenario.toLowerCase()
      );

      if (!found) {
        return NextResponse.json({
          error: `Unknown scenario: ${scenario}`,
          available: STRESS_SCENARIOS.map(s => s.name),
          _meta: buildMeta({ source: 'error', live: false }),
        }, { status: 400 });
      }

      const { runStressTest } = await import('@/lib/stress-test-engine');
      const result = runStressTest(positionInputs, found);

      return NextResponse.json({
        result,
        positionCount: positionInputs.length,
        _meta: buildMeta({ source: 'alpaca:computed', live: true }),
      });
    }

    // Run all scenarios
    const results = runAllStressTests(positionInputs);

    return NextResponse.json({
      results,
      scenarios: STRESS_SCENARIOS.map(s => s.name),
      positionCount: positionInputs.length,
      worstCase: results.reduce((worst, r) =>
        r.portfolioImpact < worst.portfolioImpact ? r : worst, results[0]),
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
