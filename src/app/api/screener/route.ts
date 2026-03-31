import { NextRequest, NextResponse } from 'next/server';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_API_KEY || '';

export async function POST(req: NextRequest) {
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
    if (!res.ok) {
      return NextResponse.json({ results: [] });
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
    console.error('Screener error:', error);
    return NextResponse.json({ results: [] });
  }
}
