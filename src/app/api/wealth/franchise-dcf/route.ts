import { NextRequest, NextResponse } from 'next/server';
import { runFranchiseDcf, type DcfInputs } from '@/lib/wealth/franchise-dcf';
import { getCached, setCache } from '@/lib/server-cache';

// F4a — CR3 franchise DCF model.
//
// GET /api/wealth/franchise-dcf
// Query overrides: ?territories=23&avgRevenue=74000&growth=0.30&discount=0.15
//                   &topMultiple=1.5&topCount=5&margin=0.30&exitMultiple=8
//                   &years=5
//
// All values are integers/decimals; defaults reflect the CR3 baseline (23
// territories, 5 top-performers at 1.5x, 30% EBITDA margin, 30% growth,
// 15% discount rate, 8x terminal EV/EBITDA, 5-year projection).

const CACHE_TTL_MS = 30 * 60 * 1000;

function num(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const overrides: Partial<DcfInputs> = {
    territories: num(sp.get('territories'), 23),
    avgRevenuePerTerritoryUSD: num(sp.get('avgRevenue'), 74_000),
    topPerformerMultiple: num(sp.get('topMultiple'), 1.5),
    topPerformerCount: num(sp.get('topCount'), 5),
    ebitdaMargin: num(sp.get('margin'), 0.30),
    revenueGrowth: num(sp.get('growth'), 0.30),
    discountRate: num(sp.get('discount'), 0.15),
    terminalEvEbitdaMultiple: num(sp.get('exitMultiple'), 8),
    projectionYears: num(sp.get('years'), 5),
  };

  const cacheKey = `franchise-dcf:${JSON.stringify(overrides)}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const result = runFranchiseDcf(overrides);
  setCache(cacheKey, result, CACHE_TTL_MS);
  return NextResponse.json(result);
}
