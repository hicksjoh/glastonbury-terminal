import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { rateLimit } from '@/lib/rate-limit';
import { getCached, setCache, TTL } from '@/lib/server-cache';
import { buildMeta } from '@/lib/api-meta';
import { getQuiverCongressTrades } from '@/lib/quiver';

const FMP_BASE = 'https://financialmodelingprep.com/stable';

export interface CongressTrade {
  id: string;
  politician: string;
  party: string | null;
  state: string | null;
  ticker: string;
  transaction_type: string;
  amount_range: string | null;
  date_filed: string | null;
  date_traded: string | null;
  filing_url: string | null;
  source: string;
}

async function fetchFromFMP(): Promise<CongressTrade[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return [];

  try {
    const [senateRes, houseRes] = await Promise.all([
      fetch(`${FMP_BASE}/senate-trading?apikey=${apiKey}`, { signal: AbortSignal.timeout(10000) }).catch(() => null),
      fetch(`${FMP_BASE}/house-disclosure?apikey=${apiKey}`, { signal: AbortSignal.timeout(10000) }).catch(() => null),
    ]);

    const trades: CongressTrade[] = [];

    if (senateRes?.ok) {
      const data = await senateRes.json();
      if (Array.isArray(data)) {
        for (const t of data.slice(0, 100)) {
          trades.push({
            id: `senate-${t.firstName}-${t.lastName}-${t.transactionDate}-${t.ticker}`,
            politician: `${t.firstName || ''} ${t.lastName || ''}`.trim(),
            party: t.party || null,
            state: t.state || null,
            ticker: String(t.ticker || '').toUpperCase(),
            transaction_type: (t.type || '').toLowerCase().includes('purchase') ? 'buy' : 'sell',
            amount_range: t.amount || null,
            date_filed: t.disclosureDate || null,
            date_traded: t.transactionDate || null,
            filing_url: t.link || null,
            source: 'senate',
          });
        }
      }
    }

    if (houseRes?.ok) {
      const data = await houseRes.json();
      if (Array.isArray(data)) {
        for (const t of data.slice(0, 100)) {
          trades.push({
            id: `house-${t.representative}-${t.transactionDate}-${t.ticker}`,
            politician: String(t.representative || ''),
            party: t.party || null,
            state: t.district || null,
            ticker: String(t.ticker || '').toUpperCase(),
            transaction_type: (t.type || '').toLowerCase().includes('purchase') ? 'buy' : 'sell',
            amount_range: t.amount || null,
            date_filed: t.disclosureDate || null,
            date_traded: t.transactionDate || null,
            filing_url: t.link || null,
            source: 'house',
          });
        }
      }
    }

    return trades;
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rl = rateLimit('congress', 30, 60000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const quiverConfigured = Boolean(process.env.QUIVER_API_KEY);
  const cacheKey = `congress-trades:${quiverConfigured ? 'quiver' : 'fallback'}`;
  const cached = getCached<{ trades: CongressTrade[]; source: string }>(cacheKey);

  let trades: CongressTrade[];
  let dataSource = quiverConfigured ? 'quiver' : 'fmp';
  let wasCached = false;
  if (cached) {
    trades = cached.trades;
    dataSource = cached.source;
    wasCached = true;
  } else {
    const supabase = createServiceClient();
    trades = [];

    if (quiverConfigured) {
      try {
        const result = await getQuiverCongressTrades();
        trades = result.data.slice(0, 200).map((trade, index) => ({
          id: `quiver-${trade.representative}-${trade.transactionDate}-${trade.ticker}-${index}`,
          politician: trade.representative,
          party: trade.party || null,
          state: trade.state || null,
          ticker: trade.ticker,
          transaction_type: trade.transactionType,
          amount_range: trade.amount || null,
          date_filed: trade.disclosureDate || null,
          date_traded: trade.transactionDate || null,
          filing_url: trade.filingUrl || null,
          source: trade.chamber || 'quiver',
        }));
      } catch { /* fall through to persisted/FMP data */ }
    }

    if (trades.length === 0) {
      const { data: dbTrades } = await supabase
        .from('congress_trades').select('*').order('date_traded', { ascending: false }).limit(200);
      if (dbTrades && dbTrades.length > 0) {
        trades = dbTrades as CongressTrade[];
        dataSource = 'supabase';
      } else {
        trades = await fetchFromFMP();
        dataSource = 'fmp';
      }
    }

    if (trades.length > 0 && dataSource !== 'supabase') {
        try {
          await supabase.from('congress_trades').upsert(
            trades.map(t => ({
              politician: t.politician,
              party: t.party,
              state: t.state,
              ticker: t.ticker,
              transaction_type: t.transaction_type,
              amount_range: t.amount_range,
              date_filed: t.date_filed,
              date_traded: t.date_traded,
              filing_url: t.filing_url,
              source: t.source,
            })),
            { onConflict: 'politician,ticker,date_traded,transaction_type', ignoreDuplicates: true }
          );
        } catch { /* non-critical */ }
    }

    setCache(cacheKey, { trades, source: dataSource }, TTL.LONG);
  }

  // Apply filters from query params
  const { searchParams } = new URL(request.url);
  const party = searchParams.get('party');
  const txType = searchParams.get('type');
  const ticker = searchParams.get('ticker');

  let filtered = trades;
  if (party) filtered = filtered.filter(t => t.party === party);
  if (txType) filtered = filtered.filter(t => t.transaction_type === txType);
  if (ticker) filtered = filtered.filter(t => t.ticker.includes(ticker.toUpperCase()));

  return NextResponse.json({
    trades: filtered,
    total: filtered.length,
    _meta: buildMeta({
      source: dataSource,
      live: trades.length > 0,
      cached: wasCached,
    }),
  });
}
