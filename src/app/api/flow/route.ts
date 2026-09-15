import { NextRequest, NextResponse } from 'next/server';
import { findUnusualFlow, type FlowCandidate } from '@/lib/alpaca-options';
import { createServiceClient } from '@/lib/supabase';
import { buildMeta } from '@/lib/api-meta';
import { getCached, setCache } from '@/lib/server-cache';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

// F5 — Free options flow (Alpaca snapshots + watchlist scan)
//
// Replaces the previous dual-dead implementation (Polygon /v3/snapshot/options/*
// was 403 on the current tier; FMP /api/v3/stock_market/* was retired entirely).
// This endpoint ranks option contracts across a user's watchlist by daily-bar
// volume and volume/OI ratio — a rough but honest "unusual activity" signal
// that's free at the data-provider layer.

const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'AAPL', 'NVDA', 'TSLA', 'AMZN', 'META', 'MSFT', 'GOOGL'];
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadWatchlistSymbols(fallback: string[]): Promise<string[]> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase.from('watchlist').select('symbol').limit(15);
    if (data && data.length > 0) {
      const syms = (data as { symbol: string }[]).map(r => r.symbol).filter(Boolean);
      if (syms.length > 0) return syms;
    }
  } catch { /* fall through */ }
  return fallback;
}

async function GET_impl(req: NextRequest) {
  const minPremium = Number(req.nextUrl.searchParams.get('minPremium') || 50_000);
  const minVolOI = Number(req.nextUrl.searchParams.get('minVolOI') || 2);
  const typeFilter = req.nextUrl.searchParams.get('type') || '';
  const symbolsParam = req.nextUrl.searchParams.get('symbols');
  const cap = Number(req.nextUrl.searchParams.get('maxResults') || 50);

  const symbols = symbolsParam
    ? symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    : await loadWatchlistSymbols(DEFAULT_SYMBOLS);

  const cacheKey = `flow:${symbols.join(',')}:${minPremium}:${minVolOI}:${typeFilter}:${cap}`;
  const cached = getCached<{ flows: FlowCandidate[]; summary: unknown }>(cacheKey);
  if (cached) {
    return NextResponse.json({
      ...cached,
      _meta: buildMeta({ source: 'alpaca-options', live: true, cached: true }),
    });
  }

  try {
    let flows = await findUnusualFlow(symbols, {
      minPremiumUSD: minPremium,
      minVolOi: minVolOI,
      maxResults: cap,
    });

    if (typeFilter === 'sweep' || typeFilter === 'block' || typeFilter === 'unusual') {
      flows = flows.filter(f => f.flowType === typeFilter);
    }

    const bullish = flows.filter(f => f.direction === 'bullish').length;
    // `flows.length || 1` used to stand in here as a divide-by-zero guard, which
    // made the `total > 0` check below always true: with zero flows it computed
    // 0/1 bullish and 1/1 bearish and reported a confident "100% bearish" on no
    // data at all. Guard on the real count and report null instead.
    const total = flows.length;
    const symCounts: Record<string, number> = {};
    for (const f of flows) symCounts[f.underlying] = (symCounts[f.underlying] ?? 0) + 1;
    const topSymbols = Object.entries(symCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([s]) => s);

    const payload = {
      flows,
      summary: {
        totalFlows: flows.length,
        bullishPct: total > 0 ? Math.round((bullish / total) * 100) : null,
        bearishPct: total > 0 ? Math.round(((total - bullish) / total) * 100) : null,
        topSymbols,
        scannedSymbols: symbols,
      },
    };

    setCache(cacheKey, payload, CACHE_TTL_MS);

    return NextResponse.json({
      ...payload,
      _meta: buildMeta({ source: 'alpaca-options', live: true }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({
      error: msg,
      _meta: buildMeta({ source: 'error', live: false, error: msg }),
    }, { status: 500 });
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('flow', RATE.UPSTREAM, GET_impl);
