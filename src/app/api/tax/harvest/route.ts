import { NextResponse } from 'next/server';
import { getCached, setCache, TTL } from '@/lib/server-cache';
import { rateLimit } from '@/lib/rate-limit';
import { scanForHarvestCandidates, type HarvestPosition } from '@/lib/tax-loss-harvester';
import type { TradeRecord } from '@/lib/wash-sale-detector';
import type { FilingStatus } from '@/lib/tax-engine';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

const ALPACA_BASE = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const ALPACA_HEADERS = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
};

const CACHE_KEY = 'tax-harvest-candidates';

// ─── Alpaca Helpers ─────────────────────────────────────────────────────────

interface AlpacaRawPosition {
  symbol: string;
  qty: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  side: string;
  avg_entry_price: string;
}

interface AlpacaRawActivity {
  id: string;
  activity_type: string;
  symbol: string;
  side: string;
  qty: string;
  price: string;
  transaction_time: string;
}

async function fetchAlpacaPositions(): Promise<HarvestPosition[]> {
  try {
    const res = await fetch(`${ALPACA_BASE}/v2/positions`, {
      headers: ALPACA_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const raw: AlpacaRawPosition[] = await res.json();
    return raw.map(p => ({
      symbol: p.symbol,
      qty: Math.abs(parseFloat(p.qty)),
      marketValue: parseFloat(p.market_value),
      costBasis: parseFloat(p.cost_basis),
      unrealizedPL: parseFloat(p.unrealized_pl),
      unrealizedPLPercent: parseFloat(p.unrealized_plpc) * 100,
      currentPrice: parseFloat(p.current_price),
      side: parseFloat(p.qty) >= 0 ? 'long' as const : 'short' as const,
      avgEntryPrice: parseFloat(p.avg_entry_price),
    }));
  } catch {
    return [];
  }
}

async function fetchAlpacaTradeHistory(): Promise<TradeRecord[]> {
  try {
    // Get last 6 months of filled orders for wash sale context
    const since = new Date();
    since.setMonth(since.getMonth() - 6);
    const sinceStr = since.toISOString().split('T')[0];

    const res = await fetch(
      `${ALPACA_BASE}/v2/account/activities/FILL?after=${sinceStr}T00:00:00Z&direction=desc&page_size=500`,
      {
        headers: ALPACA_HEADERS,
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return [];
    const raw: AlpacaRawActivity[] = await res.json();

    return raw
      .filter(a => a.activity_type === 'FILL')
      .map(a => ({
        id: a.id,
        ticker: a.symbol,
        action: a.side === 'buy' ? 'buy' as const : 'sell' as const,
        quantity: parseFloat(a.qty),
        price: parseFloat(a.price),
        date: a.transaction_time.split('T')[0],
      }));
  } catch {
    return [];
  }
}

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  const { log, request_id } = loggerFor(request, { route: 'tax/harvest' });
  // Rate limit: 20/hour
  const rl = rateLimit('tax-harvest', 20, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded', remaining: 0 },
      { status: 429 },
    );
  }

  // Check cache (30 min TTL — positions don't change fast)
  const cached = getCached<ReturnType<typeof scanForHarvestCandidates>>(CACHE_KEY);
  if (cached) {
    return NextResponse.json({ success: true, data: cached, cached: true });
  }

  try {
    // Parse optional query params
    const url = new URL(request.url);
    const filingStatus = (url.searchParams.get('filing_status') || 'single') as FilingStatus;
    const marginalRate = parseFloat(url.searchParams.get('marginal_rate') || '0.24');
    const minLoss = parseFloat(url.searchParams.get('min_loss') || '100');

    // Fetch data in parallel
    const [positions, trades] = await Promise.all([
      fetchAlpacaPositions(),
      fetchAlpacaTradeHistory(),
    ]);

    if (positions.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          candidates: [],
          totalUnrealizedLosses: 0,
          totalPotentialSavings: 0,
          ytdRealizedGains: 0,
          netTaxPosition: 'No portfolio positions found. Connect your brokerage account to scan for harvest opportunities.',
          recommendation: 'No positions available to scan.',
          disclaimer: 'Tax estimates are for educational and planning purposes only. This is NOT tax advice. Consult a qualified tax professional (CPA or EA) for your specific situation.',
        },
        cached: false,
      });
    }

    const summary = scanForHarvestCandidates(positions, trades, {
      filingStatus,
      marginalRate,
      minLoss,
    });

    setCache(CACHE_KEY, summary, TTL.LONG); // 30 min
    return NextResponse.json({ success: true, data: summary, cached: false });
  } catch (err) {
    const eventId = captureRouteError(err, { request_id, route: 'tax/harvest' });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'tax/harvest scan failed');
    // p6-17: don't echo raw err.message
    return NextResponse.json({ success: false, error: 'Harvest scan failed', sentry_event_id: eventId }, { status: 500 });
  }
}
