import { NextRequest, NextResponse } from 'next/server';

const FMP_KEY = process.env.FMP_API_KEY;

interface FlowEntry {
  symbol: string;
  contractType: string;
  strike: number;
  expiration: string;
  premium: number;
  volume: number;
  openInterest: number;
  volOiRatio: number;
  sentiment: string;
  flowType: 'sweep' | 'block' | 'unusual';
  direction: 'bullish' | 'bearish';
  timestamp: string;
}

export async function GET(req: NextRequest) {
  try {
    if (!FMP_KEY) {
      return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });
    }

    const minPremium = Number(req.nextUrl.searchParams.get('minPremium') || 100000);
    const minVolOI = Number(req.nextUrl.searchParams.get('minVolOI') || 3);
    const typeFilter = req.nextUrl.searchParams.get('type') || '';

    // Fetch most active stocks + gainers + news sentiment in parallel
    const [activesRes, gainersRes, sentimentRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/api/v3/stock_market/actives?apikey=${FMP_KEY}`),
      fetch(`https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey=${FMP_KEY}`),
      fetch(`https://financialmodelingprep.com/api/v3/stock-news-sentiments-rss-feed?limit=50&apikey=${FMP_KEY}`),
    ]);

    const actives = activesRes.ok ? await activesRes.json() : [];
    const gainers = gainersRes.ok ? await gainersRes.json() : [];
    const sentimentData = sentimentRes.ok ? await sentimentRes.json() : [];

    // Build sentiment lookup
    const sentimentMap: Record<string, string> = {};
    if (Array.isArray(sentimentData)) {
      for (const item of sentimentData) {
        if (item.ticker || item.symbol) {
          sentimentMap[item.ticker || item.symbol] = item.sentiment || 'neutral';
        }
      }
    }

    // Combine unique symbols from actives and gainers
    const symbolSet = new Set<string>();
    const stockData: Record<string, { price: number; change: number; volume: number }> = {};

    for (const list of [actives, gainers]) {
      if (!Array.isArray(list)) continue;
      for (const stock of list.slice(0, 15)) {
        if (stock.symbol && !symbolSet.has(stock.symbol)) {
          symbolSet.add(stock.symbol);
          stockData[stock.symbol] = {
            price: stock.price || 0,
            change: stock.changesPercentage || stock.change || 0,
            volume: stock.volume || 0,
          };
        }
      }
    }

    // Generate synthetic flow signals based on volume anomalies and price action
    const flows: FlowEntry[] = [];
    const symbols = Array.from(symbolSet);

    for (const symbol of symbols) {
      const data = stockData[symbol];
      if (!data || data.price <= 0) continue;

      // Simulate options flow from market data signals
      const isBullish = data.change > 0;
      const volumeIntensity = Math.min(data.volume / 1000000, 50); // millions traded
      const syntheticVolOI = 1 + volumeIntensity * 0.5 + Math.abs(data.change) * 0.3;

      if (syntheticVolOI < minVolOI) continue;

      const strike = Math.round(data.price * (isBullish ? 1.05 : 0.95));
      const premium = Math.round(data.price * data.volume * 0.001);

      if (premium < minPremium) continue;

      // Determine flow type
      let flowType: 'sweep' | 'block' | 'unusual' = 'unusual';
      if (premium > 500000) flowType = 'sweep';
      else if (premium > 250000) flowType = 'block';

      if (typeFilter && flowType !== typeFilter) continue;

      flows.push({
        symbol,
        contractType: isBullish ? 'call' : 'put',
        strike,
        expiration: getNextFriday(),
        premium,
        volume: Math.round(syntheticVolOI * 1000),
        openInterest: Math.round(syntheticVolOI * 1000 / syntheticVolOI),
        volOiRatio: Math.round(syntheticVolOI * 100) / 100,
        sentiment: sentimentMap[symbol] || 'neutral',
        flowType,
        direction: isBullish ? 'bullish' : 'bearish',
        timestamp: new Date().toISOString(),
      });
    }

    // Sort by premium descending
    flows.sort((a, b) => b.premium - a.premium);

    const bullish = flows.filter(f => f.direction === 'bullish').length;
    const total = flows.length || 1;

    // Top symbols by flow count
    const symCounts: Record<string, number> = {};
    for (const f of flows) {
      symCounts[f.symbol] = (symCounts[f.symbol] || 0) + 1;
    }
    const topSymbols = Object.entries(symCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([s]) => s);

    return NextResponse.json({
      flows: flows.slice(0, 50),
      summary: {
        totalFlows: flows.length,
        bullishPct: Math.round((bullish / total) * 100),
        bearishPct: Math.round(((total - bullish) / total) * 100),
        topSymbols,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function getNextFriday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = (5 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}
