// SEC EDGAR API client — FREE, no key needed
// Fetches institutional holdings (13F), activist stakes (13D), material events (8-K)
// Rate limit: 10 req/sec (must include User-Agent with email)

import { buildMeta, type ApiMeta } from './api-meta';
import { getCached, setCache } from './server-cache';

const USER_AGENT = 'GlastonburyTerminal/1.0 hicksjoh@gmail.com';
const BASE = 'https://data.sec.gov';
const EFTS_BASE = 'https://efts.sec.gov/LATEST';

// Gemini round-3 P0: SEC EDGAR can be slow and the prior bare fetch had no
// timeout — a hung response would eat the full Vercel 60s function budget.
// 10s matches the SLA we hold FMP/Alpaca/Resend to (paper-api 8s, FMP 5s,
// Resend 10s) — generous enough that legit EDGAR latency doesn't false-trip,
// tight enough that one stalled call doesn't take the route with it.
const EDGAR_TIMEOUT_MS = 10_000;

interface EdgarFiling {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
  description?: string;
}

interface EdgarCompanyInfo {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
}

// CIK lookup by ticker
const CIK_CACHE = new Map<string, string>();

async function edgarFetch<T>(url: string, cacheTtlMs = 60 * 60 * 1000): Promise<{ data: T | null; meta: ApiMeta }> {
  const cacheKey = `edgar:${url}`;
  const cached = getCached<T>(cacheKey);
  if (cached) {
    return { data: cached, meta: buildMeta({ source: 'edgar', live: true, cached: true }) };
  }

  try {
    // Respect 10 req/sec limit
    await new Promise(r => setTimeout(r, 120));

    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(EDGAR_TIMEOUT_MS),
    });

    if (!res.ok) throw new Error(`EDGAR HTTP ${res.status}`);
    const data = await res.json() as T;
    setCache(cacheKey, data, cacheTtlMs);

    return { data, meta: buildMeta({ source: 'edgar', live: true }) };
  } catch (err) {
    return { data: null, meta: buildMeta({ source: 'edgar', live: false, error: String(err) }) };
  }
}

// Resolve ticker to CIK
export async function resolveCIK(ticker: string): Promise<string | null> {
  const upper = ticker.toUpperCase();
  if (CIK_CACHE.has(upper)) return CIK_CACHE.get(upper)!;

  const { data } = await edgarFetch<Record<string, { cik_str: number; ticker: string; title: string }>>(
    `${BASE}/files/company_tickers.json`,
    24 * 60 * 60 * 1000, // 24hr cache
  );

  if (!data) return null;

  for (const entry of Object.values(data)) {
    CIK_CACHE.set(entry.ticker.toUpperCase(), String(entry.cik_str).padStart(10, '0'));
  }

  return CIK_CACHE.get(upper) ?? null;
}

// Get recent filings for a company
export async function getRecentFilings(ticker: string, formTypes?: string[]): Promise<{
  filings: EdgarFiling[];
  company: EdgarCompanyInfo | null;
  meta: ApiMeta;
}> {
  const cik = await resolveCIK(ticker);
  if (!cik) {
    return {
      filings: [],
      company: null,
      meta: buildMeta({ source: 'edgar', live: false, error: `CIK not found for ${ticker}` }),
    };
  }

  const { data, meta } = await edgarFetch<{
    name?: string;
    tickers?: string[];
    exchanges?: string[];
    filings?: { recent?: { form: string[]; filingDate: string[]; accessionNumber: string[]; primaryDocument: string[] } };
  }>(`${BASE}/submissions/CIK${cik}.json`);

  if (!data?.filings?.recent) {
    return { filings: [], company: null, meta };
  }

  const recent = data.filings.recent;
  const filings: EdgarFiling[] = [];

  for (let i = 0; i < Math.min(recent.form.length, 50); i++) {
    const form = recent.form[i];
    if (formTypes && formTypes.length > 0 && !formTypes.includes(form)) continue;

    filings.push({
      form,
      filingDate: recent.filingDate[i],
      accessionNumber: recent.accessionNumber[i],
      primaryDocument: recent.primaryDocument[i],
    });
  }

  return {
    filings,
    company: {
      cik,
      name: data.name ?? ticker,
      tickers: data.tickers ?? [ticker],
      exchanges: data.exchanges ?? [],
    },
    meta,
  };
}

// Get 13F institutional holdings
export async function get13FHoldings(ticker: string) {
  return getRecentFilings(ticker, ['13F-HR', '13F-HR/A']);
}

// Get 13D activist stakes
export async function get13DFilings(ticker: string) {
  return getRecentFilings(ticker, ['SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A']);
}

// Get 8-K material events
export async function get8KEvents(ticker: string) {
  return getRecentFilings(ticker, ['8-K', '8-K/A']);
}

// Full-text search via EDGAR EFTS
export async function searchFilings(query: string, dateRange?: { from: string; to: string }): Promise<{
  results: { entityName: string; ticker: string; form: string; filedAt: string; description: string }[];
  meta: ApiMeta;
}> {
  let url = `${EFTS_BASE}/search-index?q=${encodeURIComponent(query)}&dateRange=custom&forms=13F-HR,SC 13D,8-K&hits.hits.total.value=true`;
  if (dateRange) {
    url += `&startdt=${dateRange.from}&enddt=${dateRange.to}`;
  }

  const { data, meta } = await edgarFetch<{
    hits?: { hits?: { _source: { entity_name?: string; ticker?: string; file_type?: string; file_date?: string; file_description?: string } }[] };
  }>(url, 30 * 60 * 1000);

  const results = (data?.hits?.hits ?? []).slice(0, 20).map(h => ({
    entityName: h._source.entity_name ?? '',
    ticker: h._source.ticker ?? '',
    form: h._source.file_type ?? '',
    filedAt: h._source.file_date ?? '',
    description: h._source.file_description ?? '',
  }));

  return { results, meta };
}
