import { NextRequest, NextResponse } from 'next/server';
import { getRecentFilings, get13FHoldings, get13DFilings, get8KEvents, searchFilings } from '@/lib/edgar-client';
import { buildMeta } from '@/lib/api-meta';

export async function GET(req: NextRequest) {
  try {
    const symbol = req.nextUrl.searchParams.get('symbol');
    const type = req.nextUrl.searchParams.get('type') || 'all';
    const query = req.nextUrl.searchParams.get('q');

    // Full-text search
    if (query) {
      const { results, meta } = await searchFilings(query);
      return NextResponse.json({ results, _meta: meta });
    }

    if (!symbol) {
      return NextResponse.json({
        error: 'symbol parameter required',
        _meta: buildMeta({ source: 'edgar', live: false, error: 'Missing symbol' }),
      }, { status: 400 });
    }

    let result;
    switch (type) {
      case '13f':
        result = await get13FHoldings(symbol);
        break;
      case '13d':
        result = await get13DFilings(symbol);
        break;
      case '8k':
        result = await get8KEvents(symbol);
        break;
      default:
        result = await getRecentFilings(symbol);
    }

    return NextResponse.json({
      symbol,
      type,
      filings: result.filings,
      company: result.company,
      _meta: result.meta,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: msg,
      _meta: buildMeta({ source: 'edgar', live: false, error: msg }),
    }, { status: 500 });
  }
}
