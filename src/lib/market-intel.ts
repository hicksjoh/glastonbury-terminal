// Market Intelligence Layer — Alpaca News + Financial Modeling Prep
// Provides Keisha with live market data, news, fundamentals, and earnings

const ALPACA_DATA_URL = 'https://data.alpaca.markets';
const FMP_BASE_URL = 'https://financialmodelingprep.com/api/v3';

const alpacaHeaders = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
};

const fmpKey = () => process.env.FMP_API_KEY || '';

// ═══════════════════════════════════════════
//  ALPACA NEWS (free with existing keys)
// ═══════════════════════════════════════════

export interface NewsArticle {
  headline: string;
  summary: string;
  source: string;
  url: string;
  symbols: string[];
  created_at: string;
}

/**
 * Fetch latest market news from Alpaca (Benzinga feed)
 * @param symbols - Optional array of symbols to filter news for
 * @param limit - Number of articles (default 10, max 50)
 */
export async function getMarketNews(symbols?: string[], limit = 10): Promise<NewsArticle[]> {
  try {
    const params = new URLSearchParams({ limit: String(limit) });
    if (symbols && symbols.length > 0) {
      params.set('symbols', symbols.join(','));
    }
    // Sort by most recent
    params.set('sort', 'desc');

    const res = await fetch(`${ALPACA_DATA_URL}/v1beta1/news?${params}`, {
      headers: alpacaHeaders,
    });

    if (!res.ok) {
      console.error('Alpaca news error:', res.status);
      return [];
    }

    const data = await res.json();
    return (data.news || []).map((n: {
      headline: string;
      summary: string;
      source: string;
      url: string;
      symbols: string[];
      created_at: string;
    }) => ({
      headline: n.headline,
      summary: n.summary || '',
      source: n.source,
      url: n.url,
      symbols: n.symbols || [],
      created_at: n.created_at,
    }));
  } catch (err) {
    console.error('News fetch error:', err);
    return [];
  }
}

// ═══════════════════════════════════════════
//  FINANCIAL MODELING PREP (free tier: 250/day)
// ═══════════════════════════════════════════

export interface CompanyProfile {
  symbol: string;
  companyName: string;
  price: number;
  changes: number;
  changesPercentage: string;
  marketCap: number;
  sector: string;
  industry: string;
  beta: number;
  description: string;
  exchange: string;
  currency: string;
  country: string;
  isActivelyTrading: boolean;
  dcf: number;
  ipoDate: string;
}

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  changesPercentage: number;
  change: number;
  dayLow: number;
  dayHigh: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
  volume: number;
  avgVolume: number;
  open: number;
  previousClose: number;
  eps: number;
  pe: number;
  earningsAnnouncement: string;
}

export interface EarningsData {
  date: string;
  symbol: string;
  eps: number;
  epsEstimated: number;
  revenue: number;
  revenueEstimated: number;
}

export interface MarketMover {
  symbol: string;
  name: string;
  change: number;
  price: number;
  changesPercentage: number;
}

async function fmpFetch<T>(endpoint: string): Promise<T | null> {
  const key = fmpKey();
  if (!key || key === 'your_fmp_key_here') {
    return null;
  }
  try {
    const separator = endpoint.includes('?') ? '&' : '?';
    const res = await fetch(`${FMP_BASE_URL}${endpoint}${separator}apikey=${key}`);
    if (!res.ok) {
      console.error(`FMP error on ${endpoint}:`, res.status);
      return null;
    }
    return res.json();
  } catch (err) {
    console.error('FMP fetch error:', err);
    return null;
  }
}

export async function getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  const data = await fmpFetch<CompanyProfile[]>(`/profile/${symbol}`);
  return data && data.length > 0 ? data[0] : null;
}

export async function getStockQuote(symbol: string): Promise<StockQuote | null> {
  const data = await fmpFetch<StockQuote[]>(`/quote/${symbol}`);
  return data && data.length > 0 ? data[0] : null;
}

export async function getBatchQuotes(symbols: string[]): Promise<StockQuote[]> {
  if (symbols.length === 0) return [];
  const data = await fmpFetch<StockQuote[]>(`/quote/${symbols.join(',')}`);
  return data || [];
}

export async function getEarningsCalendar(): Promise<EarningsData[]> {
  const today = new Date();
  const future = new Date(today);
  future.setDate(future.getDate() + 30);
  const from = today.toISOString().split('T')[0];
  const to = future.toISOString().split('T')[0];
  const data = await fmpFetch<EarningsData[]>(`/earning_calendar?from=${from}&to=${to}`);
  return data || [];
}

export async function getStockEarnings(symbol: string): Promise<EarningsData[]> {
  const data = await fmpFetch<EarningsData[]>(`/historical/earning_calendar/${symbol}?limit=4`);
  return data || [];
}

export async function getMarketGainers(): Promise<MarketMover[]> {
  const data = await fmpFetch<MarketMover[]>('/stock_market/gainers');
  return (data || []).slice(0, 5);
}

export async function getMarketLosers(): Promise<MarketMover[]> {
  const data = await fmpFetch<MarketMover[]>('/stock_market/losers');
  return (data || []).slice(0, 5);
}

export async function getKeyMetrics(symbol: string): Promise<Record<string, unknown> | null> {
  const data = await fmpFetch<Record<string, unknown>[]>(`/key-metrics-ttm/${symbol}`);
  return data && data.length > 0 ? data[0] : null;
}

export async function getAnalystEstimates(symbol: string): Promise<Record<string, unknown>[]> {
  const data = await fmpFetch<Record<string, unknown>[]>(`/analyst-estimates/${symbol}?limit=1`);
  return data || [];
}

// ═══════════════════════════════════════════
//  COMBINED MARKET CONTEXT FOR KEISHA
// ═══════════════════════════════════════════

export async function buildMarketContext(portfolioSymbols: string[]): Promise<string> {
  const parts: string[] = [];

  const [
    generalNews,
    portfolioNews,
    gainers,
    losers,
    earnings,
    portfolioQuotes,
  ] = await Promise.all([
    getMarketNews(undefined, 5),
    portfolioSymbols.length > 0
      ? getMarketNews(portfolioSymbols, 5)
      : Promise.resolve([]),
    getMarketGainers(),
    getMarketLosers(),
    getEarningsCalendar(),
    portfolioSymbols.length > 0
      ? getBatchQuotes(portfolioSymbols)
      : Promise.resolve([]),
  ]);

  if (generalNews.length > 0) {
    parts.push(`MARKET NEWS (latest):\n${generalNews.map(n =>
      `  - [${n.source}] ${n.headline}${n.symbols.length > 0 ? ' (' + n.symbols.join(', ') + ')' : ''}\n    ${n.summary.slice(0, 150)}${n.summary.length > 150 ? '...' : ''}`
    ).join('\n')}`);
  }

  if (portfolioNews.length > 0) {
    const uniqueNews = portfolioNews.filter(pn =>
      !generalNews.some(gn => gn.headline === pn.headline)
    );
    if (uniqueNews.length > 0) {
      parts.push(`NEWS FOR YOUR HOLDINGS:\n${uniqueNews.slice(0, 5).map(n =>
        `  - [${n.source}] ${n.headline} (${n.symbols.join(', ')})\n    ${n.summary.slice(0, 150)}${n.summary.length > 150 ? '...' : ''}`
      ).join('\n')}`);
    }
  }

  if (portfolioQuotes.length > 0) {
    parts.push(`LIVE QUOTES FOR PORTFOLIO:\n${portfolioQuotes.map(q =>
      `  - ${q.symbol}: $${q.price?.toFixed(2)} (${q.changesPercentage >= 0 ? '+' : ''}${q.changesPercentage?.toFixed(2)}%) | Vol: ${(q.volume || 0).toLocaleString()} | P/E: ${q.pe?.toFixed(1) || 'N/A'} | EPS: $${q.eps?.toFixed(2) || 'N/A'} | 52w: $${q.yearLow?.toFixed(2)}-$${q.yearHigh?.toFixed(2)}`
    ).join('\n')}`);
  }

  if (gainers.length > 0 || losers.length > 0) {
    let moversStr = 'MARKET MOVERS TODAY:\n';
    if (gainers.length > 0) {
      moversStr += `  Top Gainers:\n${gainers.map(g =>
        `    - ${g.symbol} (${g.name?.slice(0, 30)}): $${g.price?.toFixed(2)} (+${g.changesPercentage?.toFixed(1)}%)`
      ).join('\n')}\n`;
    }
    if (losers.length > 0) {
      moversStr += `  Top Losers:\n${losers.map(l =>
        `    - ${l.symbol} (${l.name?.slice(0, 30)}): $${l.price?.toFixed(2)} (${l.changesPercentage?.toFixed(1)}%)`
      ).join('\n')}`;
    }
    parts.push(moversStr);
  }

  if (earnings.length > 0) {
    const relevantEarnings = earnings
      .filter(e => portfolioSymbols.includes(e.symbol) || ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'].includes(e.symbol))
      .slice(0, 8);
    if (relevantEarnings.length > 0) {
      parts.push(`UPCOMING EARNINGS (relevant):\n${relevantEarnings.map(e =>
        `  - ${e.symbol} on ${e.date} | EPS Est: $${e.epsEstimated?.toFixed(2) || 'N/A'} | Rev Est: $${e.revenueEstimated ? (e.revenueEstimated / 1e9).toFixed(2) + 'B' : 'N/A'}`
      ).join('\n')}`);
    }
  }

  if (parts.length === 0) {
    return 'Market data: No live market intelligence available. Alpaca news may be unavailable outside market hours. Configure FMP_API_KEY for additional data.';
  }

  return parts.join('\n\n');
}
