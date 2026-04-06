import { NextRequest, NextResponse } from 'next/server';
import { getCached, setCache, TTL } from '@/lib/server-cache';
import {
  getMarketNews,
  getCompanyProfile,
  getStockQuote,
  getStockEarnings,
  getKeyMetrics,
  getAnalystEstimates,
  getMarketGainers,
  getMarketLosers,
} from '@/lib/market-intel';

// GET /api/market-intel?action=news&symbols=AAPL,NVDA
// GET /api/market-intel?action=profile&symbol=AAPL
// GET /api/market-intel?action=quote&symbol=AAPL
// GET /api/market-intel?action=earnings&symbol=AAPL
// GET /api/market-intel?action=metrics&symbol=AAPL
// GET /api/market-intel?action=movers
export async function GET(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get('action');
    const symbol = req.nextUrl.searchParams.get('symbol') || '';
    const symbols = req.nextUrl.searchParams.get('symbols')?.split(',') || [];

    const cacheKey = `market-intel:${action}:${symbol}:${symbols.join(',')}`;
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json(cached);

    let payload: Record<string, unknown>;

    switch (action) {
      case 'news': {
        const news = await getMarketNews(symbols.length > 0 ? symbols : undefined, 10);
        payload = { news };
        break;
      }
      case 'profile': {
        const profile = await getCompanyProfile(symbol);
        payload = { profile };
        break;
      }
      case 'quote': {
        const quote = await getStockQuote(symbol);
        payload = { quote };
        break;
      }
      case 'earnings': {
        const earnings = await getStockEarnings(symbol);
        payload = { earnings };
        break;
      }
      case 'metrics': {
        const metrics = await getKeyMetrics(symbol);
        const estimates = await getAnalystEstimates(symbol);
        payload = { metrics, estimates };
        break;
      }
      case 'movers': {
        const [gainers, losers] = await Promise.all([getMarketGainers(), getMarketLosers()]);
        payload = { gainers, losers };
        break;
      }
      default:
        return NextResponse.json({ error: 'Invalid action. Use: news, profile, quote, earnings, metrics, movers' }, { status: 400 });
    }

    setCache(cacheKey, payload, TTL.SHORT);
    return NextResponse.json(payload);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Market intel error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
