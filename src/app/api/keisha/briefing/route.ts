import { NextRequest } from 'next/server';
import {
  anthropic,
  CLAUDE_MODEL_PRIMARY,
  CLAUDE_MODEL_FALLBACK,
} from '@/lib/claude';
import { createServiceClient } from '@/lib/supabase';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_FRESHNESS_MINUTES = 5;

const KEISHA_BRIEFING_SYSTEM_PROMPT = `You are Keisha, Wes Hicks' senior trading analyst and COO. Be direct, data-driven, warm. Use African American slang naturally when appropriate. Always cite numbers. Give information, not financial advice.`;

type Usd = { input: number; output: number };
const PRICE_PER_M: Record<string, Usd> = {
  'claude-opus-4-7': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
};

function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICE_PER_M[model] ?? { input: 3.0, output: 15.0 };
  return (tokensIn / 1_000_000) * p.input + (tokensOut / 1_000_000) * p.output;
}

function sseEncode(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function fetchAlpacaJSON<T>(path: string): Promise<T | null> {
  const base = process.env.ALPACA_TRADING_URL || process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  const secret = process.env.ALPACA_API_SECRET || process.env.ALPACA_SECRET_KEY || '';
  const key = process.env.ALPACA_API_KEY || '';
  if (!key || !secret) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchFmpJSON<T>(path: string): Promise<T | null> {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`https://financialmodelingprep.com${path}${sep}apikey=${key}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    // FMP returns {"Error Message": "..."} with HTTP 200 when rate-limited
    if (body && typeof body === 'object' && !Array.isArray(body) && 'Error Message' in body) {
      return null;
    }
    return body as T;
  } catch {
    return null;
  }
}

async function fetchFinnhubJSON<T>(path: string): Promise<T | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`https://finnhub.io${path}${sep}token=${key}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type AlpacaAccount = { equity?: string; cash?: string; buying_power?: string; last_equity?: string };
type AlpacaPosition = { symbol: string; qty: string; market_value: string; unrealized_pl: string; unrealized_plpc: string; current_price?: string };
type FmpQuote = { symbol: string; price: number; changesPercentage: number; name?: string };
type FmpNews = { title: string; site?: string; publishedDate?: string; symbol?: string };
type FinnhubQuote = { c: number; d: number; dp: number; h: number; l: number; o: number; pc: number; t: number };
type FinnhubNews = { category: string; datetime: number; headline: string; id: number; image: string; related: string; source: string; summary: string; url: string };

async function fetchQuotes(symbols: string[]): Promise<{ symbol: string; price: number; change_pct: number }[] | null> {
  // Prefer FMP (one request, multiple symbols). Fall back to Finnhub (one request per symbol).
  const fmp = await fetchFmpJSON<FmpQuote[]>(`/api/v3/quote/${symbols.join(',')}`);
  if (Array.isArray(fmp) && fmp.length > 0) {
    return fmp.map(q => ({ symbol: q.symbol, price: q.price, change_pct: q.changesPercentage }));
  }
  const quotes = await Promise.all(
    symbols.map(async sym => {
      const q = await fetchFinnhubJSON<FinnhubQuote>(`/api/v1/quote?symbol=${encodeURIComponent(sym)}`);
      return q && typeof q.c === 'number' ? { symbol: sym, price: q.c, change_pct: q.dp } : null;
    }),
  );
  const filtered = quotes.filter((q): q is { symbol: string; price: number; change_pct: number } => q !== null);
  return filtered.length > 0 ? filtered : null;
}

async function fetchTopNews(): Promise<{ title: string; site?: string; published?: string; symbol?: string }[]> {
  const fmp = await fetchFmpJSON<FmpNews[]>('/api/v3/stock_news?limit=8');
  if (Array.isArray(fmp) && fmp.length > 0) {
    return fmp.slice(0, 8).map(n => ({ title: n.title, site: n.site, published: n.publishedDate, symbol: n.symbol }));
  }
  const fh = await fetchFinnhubJSON<FinnhubNews[]>('/api/v1/news?category=general');
  if (Array.isArray(fh) && fh.length > 0) {
    return fh.slice(0, 8).map(n => ({
      title: n.headline,
      site: n.source,
      published: new Date(n.datetime * 1000).toISOString(),
      symbol: n.related,
    }));
  }
  return [];
}

async function buildContext(userId: string) {
  const supabase = createServiceClient();

  const [account, positions, watchlist, vixQuoteFmp, marketPulse, topNews, journal, territoriesRes] = await Promise.all([
    fetchAlpacaJSON<AlpacaAccount>('/v2/account'),
    fetchAlpacaJSON<AlpacaPosition[]>('/v2/positions'),
    supabase.from('watchlist').select('symbol, company_name, current_price, notes').limit(15),
    // VIX: FMP first (^VIX); fall back to Finnhub (^VIX ticker works there too)
    fetchFmpJSON<FmpQuote[]>('/api/v3/quote/%5EVIX'),
    fetchQuotes(['SPY', 'QQQ', 'DIA', 'IWM']),
    fetchTopNews(),
    supabase.from('trade_journal').select('ticker, direction, strategy, entry_date, exit_date, pnl, notes').order('created_at', { ascending: false }).limit(5),
    supabase.from('cr3_territories').select('territory_id, region, county').eq('ar_type', 'Seacoast FL'),
  ]);

  // VIX fallback to Finnhub if FMP was rate-limited
  let vix: { price: number; change_pct: number } | null = vixQuoteFmp?.[0]
    ? { price: vixQuoteFmp[0].price, change_pct: vixQuoteFmp[0].changesPercentage }
    : null;
  if (!vix) {
    const fh = await fetchFinnhubJSON<FinnhubQuote>('/api/v1/quote?symbol=%5EVIX');
    if (fh && typeof fh.c === 'number') vix = { price: fh.c, change_pct: fh.dp };
  }

  const dayPl = account?.equity && account?.last_equity
    ? Number(account.equity) - Number(account.last_equity)
    : null;

  const topPositions = Array.isArray(positions)
    ? [...positions]
        .sort((a, b) => Math.abs(Number(b.market_value)) - Math.abs(Number(a.market_value)))
        .slice(0, 6)
    : [];

  const territoryCount = territoriesRes?.data?.length ?? 0;

  return {
    userId,
    generatedAt: new Date().toISOString(),
    portfolio: account ? {
      equity: Number(account.equity ?? 0),
      cash: Number(account.cash ?? 0),
      buying_power: Number(account.buying_power ?? 0),
      day_pl: dayPl,
      position_count: Array.isArray(positions) ? positions.length : 0,
    } : null,
    top_positions: topPositions.map(p => ({
      symbol: p.symbol,
      qty: Number(p.qty),
      market_value: Number(p.market_value),
      unrealized_pl: Number(p.unrealized_pl),
      unrealized_plpc: Number(p.unrealized_plpc) * 100,
    })),
    watchlist: (watchlist?.data ?? []).map((w: { symbol: string; company_name?: string | null; notes?: string | null }) => ({
      symbol: w.symbol,
      company: w.company_name,
      notes: w.notes,
    })),
    vix,
    market_pulse: marketPulse ?? [],
    top_news: topNews,
    recent_journal: (journal?.data ?? []).map((j: { ticker: string; direction: string; strategy: string | null; entry_date: string; exit_date: string | null; pnl: number | null; notes: string | null }) => ({
      ticker: j.ticker,
      direction: j.direction,
      strategy: j.strategy,
      entry_date: j.entry_date,
      exit_date: j.exit_date,
      pnl: j.pnl,
      notes: j.notes?.slice(0, 200),
    })),
    cr3: {
      total_territories: territoryCount,
      goal_2026_usd: 580_000,
      goal_cumulative_2032_usd: 50_000_000,
    },
  };
}

function buildUserPrompt(ctx: Awaited<ReturnType<typeof buildContext>>): string {
  return `Generate a concise morning briefing for Wes, principal of The Glastonbury Group.

LIVE CONTEXT (JSON):
${JSON.stringify(ctx, null, 2)}

BRIEFING FORMAT (keep each section tight; cite the exact numbers above):
1. Lead — the single most important thing to know right now (1 sentence).
2. Portfolio Status — overnight P&L, equity, top positions.
3. Market Pulse — SPY/QQQ/DIA/IWM moves + VIX level and what it means.
4. News Edge — 1-2 headlines from top_news that actually matter for Wes's book.
5. Watchlist Signal — pull one name from the watchlist worth watching today.
6. CR3 Foundation Check — progress against the $580K 2026 foundation goal.
7. Three Plays — three concrete, specific moves for today.
8. Close — one line of energy to start the day.

Keep total under 300 words. No filler.`;
}

async function maybeServeCache(userId: string): Promise<{ text: string; id: string; model: string; createdAt: string } | null> {
  try {
    const supabase = createServiceClient();
    const cutoff = new Date(Date.now() - CACHE_FRESHNESS_MINUTES * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('keisha_briefings')
      .select('id, briefing_text, model, created_at')
      .eq('user_id', userId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as unknown as { id: string; briefing_text: string; model: string; created_at: string };
    return { id: row.id, text: row.briefing_text, model: row.model, createdAt: row.created_at };
  } catch {
    return null;
  }
}

async function persistBriefing(args: {
  userId: string;
  text: string;
  context: unknown;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('keisha_briefings')
      .insert({
        user_id: args.userId,
        briefing_text: args.text,
        context_json: args.context,
        model: args.model,
        token_input: args.tokensIn,
        token_output: args.tokensOut,
        cost_usd: estimateCostUsd(args.model, args.tokensIn, args.tokensOut),
        latency_ms: args.latencyMs,
      })
      .select('id')
      .single();
    if (error) return null;
    return (data as unknown as { id: string })?.id ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { allowed } = rateLimit('keisha-briefing', 10, 60_000);
  if (!allowed) {
    return new Response('Too many requests', { status: 429 });
  }

  const userId = req.nextUrl.searchParams.get('user') || 'wes';
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === 'true';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(sseEncode(obj)));
      const safeClose = () => { try { controller.close(); } catch { /* already closed */ } };

      try {
        // ── Cache check ───────────────────────────────────────────────
        if (!forceRefresh) {
          const cached = await maybeServeCache(userId);
          if (cached) {
            send({ type: 'meta', cached: true, model: cached.model, briefingId: cached.id, createdAt: cached.createdAt });
            // Chunk the cached text so the UI still streams
            const chunkSize = 80;
            for (let i = 0; i < cached.text.length; i += chunkSize) {
              send({ type: 'token', text: cached.text.slice(i, i + chunkSize) });
            }
            send({ type: 'done', cached: true, briefingId: cached.id });
            safeClose();
            return;
          }
        }

        // ── Build context + prompt ────────────────────────────────────
        const t0 = Date.now();
        const ctx = await buildContext(userId);
        const userPrompt = buildUserPrompt(ctx);

        send({ type: 'meta', cached: false });

        // ── Stream Claude with fallback on 429/529 ────────────────────
        const callStream = async (model: string) =>
          anthropic.messages.stream({
            model,
            max_tokens: 1200,
            system: KEISHA_BRIEFING_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
          });

        let modelUsed = CLAUDE_MODEL_PRIMARY;
        let sdkStream: ReturnType<typeof anthropic.messages.stream>;
        try {
          sdkStream = await callStream(CLAUDE_MODEL_PRIMARY);
        } catch (err) {
          const status = (err as { status?: number })?.status;
          if (status === 429 || status === 529 || status === 503) {
            modelUsed = CLAUDE_MODEL_FALLBACK;
            sdkStream = await callStream(CLAUDE_MODEL_FALLBACK);
          } else {
            throw err;
          }
        }

        send({ type: 'model', model: modelUsed });

        let accumulated = '';
        sdkStream.on('text', (delta: string) => {
          accumulated += delta;
          send({ type: 'token', text: delta });
        });

        const finalMessage = await sdkStream.finalMessage();
        const tokensIn = finalMessage.usage?.input_tokens ?? 0;
        const tokensOut = finalMessage.usage?.output_tokens ?? 0;
        const latencyMs = Date.now() - t0;

        const briefingId = await persistBriefing({
          userId,
          text: accumulated,
          context: ctx,
          model: modelUsed,
          tokensIn,
          tokensOut,
          latencyMs,
        });

        send({
          type: 'done',
          cached: false,
          briefingId,
          model: modelUsed,
          tokensIn,
          tokensOut,
          latencyMs,
          costUsd: estimateCostUsd(modelUsed, tokensIn, tokensOut),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        send({ type: 'error', message });
      } finally {
        safeClose();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
