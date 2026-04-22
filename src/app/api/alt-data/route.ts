import { NextResponse } from 'next/server';
import { fetchTradeIndicators } from '@/lib/alt-data/fred-trade';
import { getCached, setCache } from '@/lib/server-cache';

// F9 — Trade & shipping alt-data overlay.
//
// Surfaces FRED-sourced freight, trade, and fuel indicators as a rough
// macro-demand pulse. Served at /api/alt-data so the dashboard can drop
// in a widget and the MCP server / Keisha can cite numbers in briefings.
//
// Cached 1h — FRED series update daily/monthly so aggressive caching is
// safe and keeps us well under FRED's 120 req/min quota.

const CACHE_TTL_MS = 60 * 60 * 1000;

export async function GET() {
  const cacheKey = 'alt-data:trade-indicators';
  const cached = getCached<unknown>(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const series = await fetchTradeIndicators(24);

    const up = series.filter((s) => s.changePct !== null && s.changePct > 0).length;
    const down = series.filter((s) => s.changePct !== null && s.changePct < 0).length;

    const payload = {
      series,
      summary: {
        count: series.length,
        trending_up: up,
        trending_down: down,
        mixed: series.length - up - down,
      },
      source: 'fred',
      updatedAt: new Date().toISOString(),
    };

    setCache(cacheKey, payload, CACHE_TTL_MS);
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({
      series: [],
      summary: { count: 0, trending_up: 0, trending_down: 0, mixed: 0 },
      error: msg,
      source: 'fred',
    }, { status: 500 });
  }
}
