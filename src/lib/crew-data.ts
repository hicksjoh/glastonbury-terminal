/**
 * Shared data fetchers + computed indicators for the Trading Crew (Phase 3).
 * Every fetch times out fast and returns null on failure — specialists should
 * degrade gracefully when one upstream is down.
 */

import { getQuote, getProfile } from '@/lib/fmp-client';

const ALPACA_DATA = process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets';
const ALPACA_KEY = process.env.ALPACA_API_KEY || '';
const ALPACA_SECRET = process.env.ALPACA_API_SECRET || process.env.ALPACA_SECRET_KEY || '';
const FMP_KEY = process.env.FMP_API_KEY || '';
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || '';
const POLYGON_KEY = process.env.POLYGON_API_KEY || '';

// ── Alpaca bars ──────────────────────────────────────────────────────────────
export type Bar = { t: string; o: number; h: number; l: number; c: number; v: number };

export async function fetchBars(symbol: string, timeframe = '1Day', limit = 200): Promise<Bar[]> {
  if (!ALPACA_KEY || !ALPACA_SECRET) return [];
  try {
    const end = new Date();
    const start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1y back
    const url = `${ALPACA_DATA}/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${timeframe}&start=${start.toISOString()}&end=${end.toISOString()}&limit=${limit}&adjustment=split`;
    const res = await fetch(url, {
      headers: { 'APCA-API-KEY-ID': ALPACA_KEY, 'APCA-API-SECRET-KEY': ALPACA_SECRET },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { bars?: Bar[] };
    return body.bars ?? [];
  } catch {
    return [];
  }
}

// ── Indicators ───────────────────────────────────────────────────────────────
export type Indicators = {
  last_close: number | null;
  change_1d_pct: number | null;
  change_5d_pct: number | null;
  change_20d_pct: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  support: number | null;
  resistance: number | null;
  volatility_20d: number | null;
};

function sma(values: number[], window: number): number | null {
  if (values.length < window) return null;
  const slice = values.slice(-window);
  return slice.reduce((a, b) => a + b, 0) / window;
}

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  const avgG = gain / period;
  const avgL = loss / period;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function computeIndicators(bars: Bar[]): Indicators {
  const closes = bars.map(b => b.c);
  const len = closes.length;
  const last = closes[len - 1] ?? null;
  const prev = closes[len - 2] ?? null;
  const prev5 = closes[len - 6] ?? null;
  const prev20 = closes[len - 21] ?? null;

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - (ema26[i] ?? 0));
  const signalLine = ema(macdLine, 9);
  const macd = macdLine[macdLine.length - 1] ?? null;
  const macdSig = signalLine[signalLine.length - 1] ?? null;

  const recent = closes.slice(-20);
  const rets = recent.slice(1).map((c, i) => (c - recent[i]) / recent[i]);
  const vol20 = stddev(rets);

  const sl = closes.slice(-60);
  const support = sl.length ? Math.min(...sl) : null;
  const resistance = sl.length ? Math.max(...sl) : null;

  return {
    last_close: last,
    change_1d_pct: last != null && prev != null ? ((last - prev) / prev) * 100 : null,
    change_5d_pct: last != null && prev5 != null ? ((last - prev5) / prev5) * 100 : null,
    change_20d_pct: last != null && prev20 != null ? ((last - prev20) / prev20) * 100 : null,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    rsi14: rsi(closes, 14),
    macd,
    macd_signal: macdSig,
    macd_hist: macd != null && macdSig != null ? macd - macdSig : null,
    support,
    resistance,
    volatility_20d: vol20 != null ? vol20 * Math.sqrt(252) * 100 : null,
  };
}

// ── Quote + company profile ─────────────────────────────────────────────────
export type Quote = { price: number; change_pct: number; prev_close: number | null };

export async function fetchQuote(symbol: string): Promise<Quote | null> {
  // Finnhub first — free tier is generous; FMP has daily cap
  if (FINNHUB_KEY) {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const j = (await res.json()) as { c: number; d: number; dp: number; pc: number };
        if (typeof j.c === 'number' && j.c > 0) {
          return { price: j.c, change_pct: j.dp, prev_close: j.pc };
        }
      }
    } catch { /* fallthrough */ }
  }
  try {
    const q = await getQuote(symbol);
    if (q?.price) {
      return { price: q.price, change_pct: q.changePercentage, prev_close: null };
    }
  } catch { /* noop */ }
  return null;
}

export type CompanyProfile = {
  name: string | null;
  industry: string | null;
  market_cap: number | null;
  pe: number | null;
  description: string | null;
};

export async function fetchCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  try {
    const p = await getProfile(symbol);
    if (p) {
      return {
        name: p.companyName ?? null,
        industry: p.industry ?? null,
        market_cap: p.marketCap ?? null,
        pe: null, // `/stable/profile` on current tier does not return pe
        description: p.description?.slice(0, 600) ?? null,
      };
    }
  } catch { /* noop */ }
  if (FINNHUB_KEY) {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const j = (await res.json()) as { name?: string; finnhubIndustry?: string; marketCapitalization?: number };
        return {
          name: j.name ?? null,
          industry: j.finnhubIndustry ?? null,
          market_cap: j.marketCapitalization ? j.marketCapitalization * 1_000_000 : null,
          pe: null,
          description: null,
        };
      }
    } catch { /* noop */ }
  }
  return null;
}

// ── Filings ─────────────────────────────────────────────────────────────────
export type Filing = { form: string; filed_date: string; url: string | null; title?: string | null };

export async function fetchRecentFilings(symbol: string, limit = 5): Promise<Filing[]> {
  // FMP /stable dropped sec-filings on the current tier (404). Fall through
  // to empty — callers should consider SEC EDGAR direct via src/app/api/edgar.
  // TODO(F6/Wave 2): wire the 13F-whale-mirror EDGAR client as the source here too.
  if (!FMP_KEY) return [];
  try {
    const res = await fetch(`https://financialmodelingprep.com/stable/sec_filings/${encodeURIComponent(symbol)}?limit=${limit}&apikey=${FMP_KEY}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    if (!Array.isArray(body)) return [];
    return body.slice(0, limit).map((f: { type?: string; fillingDate?: string; finalLink?: string; link?: string; symbol?: string }) => ({
      form: f.type ?? 'unknown',
      filed_date: f.fillingDate ?? '',
      url: f.finalLink ?? f.link ?? null,
      title: f.type ?? null,
    }));
  } catch {
    return [];
  }
}

// ── Options snapshot (Polygon or FMP) ───────────────────────────────────────
export type OptionsSnapshot = {
  total_call_oi: number | null;
  total_put_oi: number | null;
  put_call_ratio: number | null;
  iv_rank: number | null;
  top_strikes: { strike: number; type: 'call' | 'put'; open_interest: number; volume: number }[];
  max_pain: number | null;
};

export async function fetchOptionsSnapshot(symbol: string): Promise<OptionsSnapshot | null> {
  if (!POLYGON_KEY) return null;
  try {
    const res = await fetch(
      `https://api.polygon.io/v3/snapshot/options/${encodeURIComponent(symbol)}?limit=250&apiKey=${POLYGON_KEY}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      results?: Array<{
        details?: { strike_price?: number; contract_type?: 'call' | 'put' };
        open_interest?: number;
        day?: { volume?: number };
      }>;
    };
    const contracts = body.results ?? [];
    let callOi = 0;
    let putOi = 0;
    const byStrike: Record<string, { strike: number; type: 'call' | 'put'; open_interest: number; volume: number }> = {};
    for (const c of contracts) {
      const type = c.details?.contract_type;
      const strike = c.details?.strike_price;
      const oi = c.open_interest ?? 0;
      const vol = c.day?.volume ?? 0;
      if (!type || !strike) continue;
      if (type === 'call') callOi += oi;
      else putOi += oi;
      const key = `${strike}-${type}`;
      byStrike[key] = { strike, type, open_interest: oi, volume: vol };
    }
    const top = Object.values(byStrike)
      .sort((a, b) => b.open_interest - a.open_interest)
      .slice(0, 10);
    const pcr = callOi > 0 ? putOi / callOi : null;
    return {
      total_call_oi: callOi || null,
      total_put_oi: putOi || null,
      put_call_ratio: pcr,
      iv_rank: null, // not computed here
      top_strikes: top,
      max_pain: null,
    };
  } catch {
    return null;
  }
}

// ── News (Finnhub company-news) ─────────────────────────────────────────────
export type NewsItem = {
  headline: string;
  source: string;
  url: string;
  datetime: string;
  summary?: string;
};

export async function fetchRecentNews(symbol: string, hours = 72, limit = 15): Promise<NewsItem[]> {
  if (!FINNHUB_KEY) return [];
  try {
    const to = new Date();
    const from = new Date(Date.now() - hours * 60 * 60 * 1000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${iso(from)}&to=${iso(to)}&token=${FINNHUB_KEY}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as Array<{ headline?: string; source?: string; url?: string; datetime?: number; summary?: string }>;
    return body
      .slice(0, limit)
      .map(n => ({
        headline: n.headline ?? '',
        source: n.source ?? '',
        url: n.url ?? '',
        datetime: n.datetime ? new Date(n.datetime * 1000).toISOString() : '',
        summary: n.summary?.slice(0, 240),
      }))
      .filter(n => n.headline);
  } catch {
    return [];
  }
}
