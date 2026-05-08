import { NextRequest, NextResponse } from 'next/server';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_API_KEY || '';

export async function POST(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'screener' });
  try {
    if (!FMP_KEY) {
      return NextResponse.json({ results: [], error: 'FMP API key not configured' });
    }

    const { filters } = await req.json() as {
      filters: { field: string; operator: string; value: string | number }[];
    };

    // Map filter fields to FMP stock-screener query params
    const params = new URLSearchParams({ apikey: FMP_KEY, limit: '50' });

    const fieldMap: Record<string, { more: string; less: string }> = {
      marketCap: { more: 'marketCapMoreThan', less: 'marketCapLowerThan' },
      pe: { more: 'peMoreThan', less: 'peLowerThan' },
      beta: { more: 'betaMoreThan', less: 'betaLowerThan' },
      volume: { more: 'volumeMoreThan', less: 'volumeLowerThan' },
      dividendYield: { more: 'dividendMoreThan', less: 'dividendLowerThan' },
      price: { more: 'priceMoreThan', less: 'priceLowerThan' },
      roe: { more: 'returnOnEquityMoreThan', less: 'returnOnEquityLowerThan' },
      roa: { more: 'returnOnAssetsMoreThan', less: 'returnOnAssetsLowerThan' },
      netMargin: { more: 'netIncomeRatioMoreThan', less: 'netIncomeRatioLowerThan' },
      revenueGrowth: { more: 'revenueGrowthMoreThan', less: 'revenueGrowthLowerThan' },
    };

    for (const f of filters) {
      if (f.field === 'sector' && f.value) {
        params.set('sector', String(f.value));
        continue;
      }
      if (f.field === 'industry' && f.value) {
        params.set('industry', String(f.value));
        continue;
      }
      if (f.field === 'exchange' && f.value) {
        params.set('exchange', String(f.value));
        continue;
      }

      const mapping = fieldMap[f.field];
      if (mapping) {
        if (f.operator === '>' || f.operator === '>=') {
          params.set(mapping.more, String(f.value));
        } else if (f.operator === '<' || f.operator === '<=') {
          params.set(mapping.less, String(f.value));
        }
      }
    }

    const res = await fetch(`${FMP_BASE}/stock-screener?${params}`);
    if (res.status === 429) {
      return NextResponse.json({ results: [], error: 'FMP rate limit exceeded — try again in a moment' });
    }
    if (!res.ok) {
      return NextResponse.json({ results: [], error: 'Screener query failed' });
    }

    const data = await res.json();
    const results = (Array.isArray(data) ? data : []).map((s: Record<string, unknown>) => ({
      symbol: s.symbol,
      companyName: s.companyName,
      marketCap: s.marketCap,
      price: s.price,
      beta: s.beta,
      volume: s.volume,
      sector: s.sector,
      industry: s.industry,
      exchange: s.exchange,
      dividendYield: s.lastAnnualDividend,
      pe: null, // FMP screener doesn't return P/E directly
    }));

    return NextResponse.json({ results });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'screener' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'screener threw');
    return NextResponse.json({ results: [], sentry_event_id: eventId });
  }
}
