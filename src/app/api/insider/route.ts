import { NextRequest, NextResponse } from 'next/server';
import { apiFetchWithFallback } from '@/lib/api-client';
import { buildMeta, type ApiMeta } from '@/lib/api-meta';

interface InsiderTradeRaw {
  symbol?: string;
  reportingName?: string;
  owner?: string;
  typeOfOwner?: string;
  acquistionOrDisposition?: string;
  transactionType?: string;
  securitiesTransacted?: number;
  shares?: number;
  price?: number;
  transactionDate?: string;
  filingDate?: string;
  link?: string;
  [k: string]: unknown;
}

interface SenateTrade {
  ticker?: string;
  symbol?: string;
  representative?: string;
  firstName?: string;
  lastName?: string;
  party?: string;
  district?: string;
  type?: string;
  transactionType?: string;
  amount?: string;
  range?: string;
  transactionDate?: string;
  disclosureDate?: string;
  [k: string]: unknown;
}

export async function GET(req: NextRequest) {
  try {
    const symbol = req.nextUrl.searchParams.get('symbol') || '';
    const type = req.nextUrl.searchParams.get('type') || 'all';
    const days = Number(req.nextUrl.searchParams.get('days') || 30);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const metas: ApiMeta[] = [];

    // Fetch insider trades
    let insiderTrades: ReturnType<typeof parseInsiderTrades> = [];
    if (type === 'all' || type === 'insider') {
      if (symbol) {
        const res = await apiFetchWithFallback<InsiderTradeRaw[]>(
          'fmp', '/v4/insider-trading', { symbol, limit: '100' }, [],
          { cacheTtlMs: 15 * 60 * 1000 },
        );
        insiderTrades = parseInsiderTrades(res.data, cutoff, symbol);
        metas.push(res._meta);
      } else {
        const res = await apiFetchWithFallback<InsiderTradeRaw[]>(
          'fmp', '/v4/insider-trading-rss-feed', { limit: '50' }, [],
          { cacheTtlMs: 15 * 60 * 1000 },
        );
        insiderTrades = parseInsiderTrades(res.data, cutoff, '');
        metas.push(res._meta);
      }
    }

    // Fetch congressional trades
    let congressTrades: ReturnType<typeof parseCongressTrades> = [];
    if (type === 'all' || type === 'congress') {
      if (symbol) {
        const [senateRes, disclosureRes] = await Promise.all([
          apiFetchWithFallback<SenateTrade[]>('fmp', '/v4/senate-trading', { symbol }, [], { cacheTtlMs: 60 * 60 * 1000 }),
          apiFetchWithFallback<SenateTrade[]>('fmp', '/v4/senate-disclosure', { symbol }, [], { cacheTtlMs: 60 * 60 * 1000 }),
        ]);
        congressTrades = [
          ...parseCongressTrades(senateRes.data, cutoff, 'senate', symbol),
          ...parseCongressTrades(disclosureRes.data, cutoff, 'house', symbol),
        ];
        metas.push(senateRes._meta, disclosureRes._meta);
      } else {
        const [senateRes, disclosureRes] = await Promise.all([
          apiFetchWithFallback<SenateTrade[]>('fmp', '/v4/senate-trading-rss-feed', {}, [], { cacheTtlMs: 60 * 60 * 1000 }),
          apiFetchWithFallback<SenateTrade[]>('fmp', '/v4/senate-disclosure-rss-feed', {}, [], { cacheTtlMs: 60 * 60 * 1000 }),
        ]);
        congressTrades = [
          ...parseCongressTrades(senateRes.data, cutoff, 'senate', ''),
          ...parseCongressTrades(disclosureRes.data, cutoff, 'house', ''),
        ];
        metas.push(senateRes._meta, disclosureRes._meta);
      }
    }

    // Generate signals
    const signals = generateSignals(insiderTrades, congressTrades);
    const allLive = metas.length > 0 && metas.every(m => m.live);

    return NextResponse.json({
      insiderTrades,
      congressTrades,
      signals,
      _meta: buildMeta({
        source: 'fmp',
        live: allLive,
        cached: metas.some(m => m.cached),
        stale: metas.some(m => m.stale),
      }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: msg,
      _meta: buildMeta({ source: 'error', live: false, error: msg }),
    }, { status: 500 });
  }
}

function parseInsiderTrades(raw: unknown, cutoff: Date, fallbackSymbol: string) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t: InsiderTradeRaw) => {
      const d = new Date(t.transactionDate || t.filingDate || '');
      return d >= cutoff;
    })
    .map((t: InsiderTradeRaw) => ({
      symbol: String(t.symbol || fallbackSymbol),
      name: String(t.reportingName || t.owner || 'Unknown'),
      title: String(t.typeOfOwner || ''),
      transactionType: String(t.acquistionOrDisposition || t.transactionType || '').toLowerCase().includes('a') ? 'buy' as const : 'sell' as const,
      shares: Number(t.securitiesTransacted || t.shares || 0),
      pricePerShare: Number(t.price || 0),
      totalValue: Number(t.securitiesTransacted || 0) * Number(t.price || 0),
      date: String(t.transactionDate || t.filingDate || ''),
      filingUrl: String(t.link || ''),
    }))
    .slice(0, 50);
}

function parseCongressTrades(raw: unknown, cutoff: Date, chamber: string, fallbackSymbol: string) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t: SenateTrade) => {
      const d = new Date(t.transactionDate || t.disclosureDate || '');
      return d >= cutoff;
    })
    .map((t: SenateTrade) => ({
      symbol: t.ticker || t.symbol || fallbackSymbol || 'N/A',
      representative: t.representative || `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'Unknown',
      party: t.party || t.district || '',
      chamber,
      transactionType: String(t.type || t.transactionType || '').toLowerCase().includes('purchase') ? 'buy' as const : 'sell' as const,
      amount: t.amount || t.range || '',
      date: t.transactionDate || '',
      disclosureDate: t.disclosureDate || '',
    }))
    .slice(0, 50);
}

function generateSignals(
  insiderTrades: { symbol: string; transactionType: string; name: string; date: string }[],
  congressTrades: { symbol: string; transactionType: string; representative: string; party: string; date: string; disclosureDate: string }[],
) {
  const signals: { type: string; symbol: string; description: string; confidence: number; date: string }[] = [];

  // Cluster buy detection
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

  return signals;
}
