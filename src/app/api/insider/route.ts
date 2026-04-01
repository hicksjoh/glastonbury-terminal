import { NextRequest, NextResponse } from 'next/server';

const FMP_KEY = process.env.FMP_API_KEY;

export async function GET(req: NextRequest) {
  try {
    if (!FMP_KEY) {
      return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });
    }

    const symbol = req.nextUrl.searchParams.get('symbol') || '';
    const type = req.nextUrl.searchParams.get('type') || 'all';
    const days = Number(req.nextUrl.searchParams.get('days') || 30);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Build fetch promises based on type
    const fetches: Promise<Response | null>[] = [];

    if (type === 'all' || type === 'insider') {
      if (symbol) {
        fetches.push(fetch(`https://financialmodelingprep.com/api/v4/insider-trading?symbol=${symbol}&limit=100&apikey=${FMP_KEY}`).catch(() => null));
      } else {
        fetches.push(fetch(`https://financialmodelingprep.com/api/v4/insider-trading-rss-feed?limit=50&apikey=${FMP_KEY}`).catch(() => null));
      }
    } else {
      fetches.push(Promise.resolve(null));
    }

    if (type === 'all' || type === 'congress') {
      if (symbol) {
        fetches.push(fetch(`https://financialmodelingprep.com/api/v4/senate-trading?symbol=${symbol}&apikey=${FMP_KEY}`).catch(() => null));
        fetches.push(fetch(`https://financialmodelingprep.com/api/v4/senate-disclosure?symbol=${symbol}&apikey=${FMP_KEY}`).catch(() => null));
      } else {
        fetches.push(fetch(`https://financialmodelingprep.com/api/v4/senate-trading-rss-feed?apikey=${FMP_KEY}`).catch(() => null));
        fetches.push(fetch(`https://financialmodelingprep.com/api/v4/senate-disclosure-rss-feed?apikey=${FMP_KEY}`).catch(() => null));
      }
    }

    const results = await Promise.all(fetches);

    // Parse insider trades
    const insiderRaw = results[0]?.ok ? await results[0].json() : [];
    const insiderTrades = (Array.isArray(insiderRaw) ? insiderRaw : [])
      .filter((t: { transactionDate?: string; filingDate?: string }) => {
        const d = new Date(t.transactionDate || t.filingDate || '');
        return d >= cutoff;
      })
      .map((t: Record<string, unknown>) => ({
        symbol: t.symbol || symbol,
        name: t.reportingName || t.owner || 'Unknown',
        title: t.typeOfOwner || '',
        transactionType: String(t.acquistionOrDisposition || t.transactionType || '').toLowerCase().includes('a') ? 'buy' : 'sell',
        shares: Number(t.securitiesTransacted || t.shares || 0),
        pricePerShare: Number(t.price || 0),
        totalValue: Number(t.securitiesTransacted || 0) * Number(t.price || 0),
        date: t.transactionDate || t.filingDate || '',
        filingUrl: t.link || '',
      }))
      .slice(0, 50);

    // Parse congressional trades
    const congressTrades: {
      symbol: string; representative: string; party: string; chamber: string;
      transactionType: string; amount: string; date: string; disclosureDate: string;
    }[] = [];

    for (let i = 1; i < results.length; i++) {
      const raw = results[i]?.ok ? await results[i]!.json() : [];
      if (!Array.isArray(raw)) continue;
      const chamber = i === 1 ? 'senate' : 'house';
      for (const t of raw) {
        const d = new Date(t.transactionDate || t.disclosureDate || '');
        if (d < cutoff) continue;
        congressTrades.push({
          symbol: t.ticker || t.symbol || symbol || 'N/A',
          representative: t.representative || t.firstName + ' ' + t.lastName || 'Unknown',
          party: t.party || t.district || '',
          chamber,
          transactionType: String(t.type || t.transactionType || '').toLowerCase().includes('purchase') ? 'buy' : 'sell',
          amount: t.amount || t.range || '',
          date: t.transactionDate || '',
          disclosureDate: t.disclosureDate || '',
        });
      }
    }

    // Generate signals
    const signals: { type: string; symbol: string; description: string; confidence: number; date: string }[] = [];

    // Cluster buy detection: 3+ insiders buying same stock within 14 days
    const buysBySymbol: Record<string, { name: string; date: string }[]> = {};
    for (const t of insiderTrades) {
      if (t.transactionType === 'buy') {
        if (!buysBySymbol[t.symbol]) buysBySymbol[t.symbol] = [];
        buysBySymbol[t.symbol].push({ name: t.name, date: t.date });
      }
    }

    for (const [sym, buys] of Object.entries(buysBySymbol)) {
      if (buys.length >= 3) {
        const dates = buys.map(b => new Date(b.date).getTime());
        const range = Math.max(...dates) - Math.min(...dates);
        if (range <= 14 * 86400000) {
          signals.push({
            type: 'cluster_buy',
            symbol: sym,
            description: `${buys.length} insiders bought ${sym} within 14 days`,
            confidence: Math.min(0.95, 0.6 + buys.length * 0.1),
            date: buys[0].date,
          });
        }
      }
    }

    // Congressional buy signals
    for (const t of congressTrades) {
      if (t.transactionType === 'buy') {
        signals.push({
          type: 'congress_buy',
          symbol: t.symbol,
          description: `${t.representative} (${t.party}) purchased ${t.symbol}`,
          confidence: 0.7,
          date: t.date || t.disclosureDate,
        });
      }
    }

    return NextResponse.json({ insiderTrades, congressTrades, signals });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
