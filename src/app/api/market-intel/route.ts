import { NextRequest, NextResponse } from 'next/server';
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

    switch (action) {
      case 'news': {
        const news = await getMarketNews(symbols.length > 0 ? symbols : undefined, 10);
        return NextResponse.json({ news });
      }
      case 'profile': {
        const profile = await getCompanyProfile(symbol);
        return NextResponse.json({ profile });
      }
      case 'quote': {
        const quote = await getStockQuote(symbol);
        return NextResponse.json({ quote });
      }
      case 'earnings': {
        const earnings = await getStockEarnings(symbol);
        return NextResponse.json({ earnings });
      }
      case 'metrics': {
        const metrics = await getKeyMetrics(symbol);
        const estimates = await getAnalystEstimates(symbol);
        return NextResponse.json({ metrics, estimates });
      }
      case 'movers': {
        const [gainers, losers] = await Promise.all([getMarketGainers(), getMarketLosers()]);
        return NextResponse.json({ gainers, losers });
      }
      default:
        return NextResponse.json({ error: 'Invalid action. Use: news, profile, quote, earnings, metrics, movers' }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Market intel error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
