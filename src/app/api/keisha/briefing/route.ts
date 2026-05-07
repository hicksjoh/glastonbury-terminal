import { NextRequest } from 'next/server';
import { getQuote, getQuotes } from '@/lib/fmp-client';
import {
  anthropic,
  CLAUDE_MODEL_PRIMARY,
  CLAUDE_MODEL_FALLBACK,
} from '@/lib/claude';
import { createServiceClient } from '@/lib/supabase';
import { checkRateLimitDurable } from '@/lib/rate-limit-durable';
import { computeAnthropicCostUsd, tagAnthropicCall } from '@/lib/anthropic-cost';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_FRESHNESS_MINUTES = 5;

const KEISHA_BRIEFING_SYSTEM_PROMPT = `You are Keisha, Wes Hicks' senior trading analyst and COO. Be direct, data-driven, warm. Use African American slang naturally when appropriate. Always cite numbers. Give information, not financial advice.`;

// p6-3: cost calc delegates to the canonical pricing table in
// src/lib/anthropic-cost.ts. The previous local PRICE_PER_M table at this
// site drifted from anthropic-cost.ts (Opus audit finding). Single source
// of truth now — when Anthropic updates pricing, only one file changes.
function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  return computeAnthropicCostUsd(
    { input_tokens: tokensIn, output_tokens: tokensOut },
    model,
  );
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
  // /stable/quote batch form is paid on the current tier; use the fan-out
  // helper in fmp-client. Finnhub remains as the fallback for completeness.
  const fmp = await getQuotes(symbols);
  if (fmp.length > 0) {
    return fmp.map(q => ({ symbol: q.symbol, price: q.price, change_pct: q.changePercentage }));
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
  // FMP /stable stock-news is paid-tier on the current plan — skip straight
  // to Finnhub's free news feed which is already wired as the fallback below.
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
  const fortyEightHrAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const [
    account, positions, watchlist, vixQuoteFmp, marketPulse, topNews, journal, territoriesRes,
    // Phase 7-12 signals
    stormAlertsRes, coachReviewRes, harvestRes, recentCrewRes, latestResearchRes, latestEarningsMemoRes, predictionRes,
  ] = await Promise.all([
    fetchAlpacaJSON<AlpacaAccount>('/v2/account'),
    fetchAlpacaJSON<AlpacaPosition[]>('/v2/positions'),
    supabase.from('watchlist').select('symbol, company_name, current_price, notes').limit(15),
    getQuote('^VIX').then(q => q ? [{ symbol: q.symbol, price: q.price, changesPercentage: q.changePercentage, name: q.name }] : null),
    fetchQuotes(['SPY', 'QQQ', 'DIA', 'IWM']),
    fetchTopNews(),
    supabase.from('trade_journal').select('ticker, direction, strategy, entry_date, exit_date, pnl, notes').order('created_at', { ascending: false }).limit(5),
    supabase.from('cr3_territories').select('territory_id, region, county').eq('ar_type', 'Seacoast FL'),

    // P7: active storm alerts in last 48h
    supabase.from('storm_alerts').select('storm_id, storm_name, threat_level, impacted_territory_ids, created_at')
      .gte('created_at', fortyEightHrAgo).order('created_at', { ascending: false }).limit(5),
    // P10: latest coach review
    supabase.from('coach_reviews').select('week_of, primary_rule_for_next_week, patterns_detected, pnl_usd, trade_count')
      .eq('user_id', userId).order('week_of', { ascending: false }).limit(1),
    // P8: this week's tax harvest summary
    supabase.from('tax_harvest_suggestions').select('week_of, unrealized_loss, estimated_tax_savings_usd, status')
      .eq('user_id', userId).eq('status', 'suggested').order('week_of', { ascending: false }).limit(20),
    // P3: recent Trading Crew verdicts
    supabase.from('crew_runs').select('ticker, judge_verdict, judge_confidence, created_at')
      .eq('user_id', userId).eq('status', 'completed').order('created_at', { ascending: false }).limit(3),
    // P5: latest deep-research memo topic
    supabase.from('deep_research_memos').select('ticker, topic, memo_word_count, created_at')
      .eq('user_id', userId).eq('status', 'completed').order('created_at', { ascending: false }).limit(1),
    // P4: most recent earnings memo
    supabase.from('earnings_memos').select('session_id, guidance_delta, created_at')
      .order('created_at', { ascending: false }).limit(1),
    // P11: top prediction-market shifts by |delta_24h|
    supabase.from('prediction_market_snapshots').select('source, market_ticker, market_name, yes_price, delta_24h, snapshot_at')
      .order('snapshot_at', { ascending: false }).limit(40),
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

    // ── Phase 7-12 signals — surfaces the full agentic stack in the briefing
    storm_watch: (() => {
      const alerts = (stormAlertsRes?.data as unknown as Array<{ storm_id: string; storm_name: string; threat_level: string; impacted_territory_ids: string[] }>) ?? [];
      const active = alerts.filter(a => a.threat_level !== 'clear');
      return {
        active_count: active.length,
        highest_threat: active[0]?.threat_level ?? 'clear',
        storms: active.slice(0, 3).map(a => ({ name: a.storm_name, threat: a.threat_level, territories: a.impacted_territory_ids.length })),
      };
    })(),
    coach_rule: (() => {
      const row = (coachReviewRes?.data as unknown as Array<{ week_of: string; primary_rule_for_next_week: string; pnl_usd: number | null; trade_count: number | null }>)?.[0];
      return row ? { week_of: row.week_of, rule: row.primary_rule_for_next_week, last_week_pnl: row.pnl_usd, last_week_trades: row.trade_count } : null;
    })(),
    tax_harvest: (() => {
      const rows = (harvestRes?.data as unknown as Array<{ week_of: string; unrealized_loss: number | null; estimated_tax_savings_usd: number | null }>) ?? [];
      const latestWeek = rows[0]?.week_of ?? null;
      const thisWeek = rows.filter(r => r.week_of === latestWeek);
      return thisWeek.length === 0 ? null : {
        week_of: latestWeek,
        pending_suggestions: thisWeek.length,
        total_unrealized_loss: thisWeek.reduce((s, r) => s + Math.abs(Number(r.unrealized_loss) || 0), 0),
        total_estimated_savings: thisWeek.reduce((s, r) => s + (Number(r.estimated_tax_savings_usd) || 0), 0),
      };
    })(),
    recent_crew_runs: ((recentCrewRes?.data as unknown as Array<{ ticker: string; judge_verdict: string; judge_confidence: number | null; created_at: string }>) ?? []).map(r => ({
      ticker: r.ticker, verdict: r.judge_verdict, confidence: r.judge_confidence, created_at: r.created_at,
    })),
    latest_research_memo: (() => {
      const row = (latestResearchRes?.data as unknown as Array<{ ticker: string | null; topic: string; memo_word_count: number | null; created_at: string }>)?.[0];
      return row ? { ticker: row.ticker, topic: row.topic, word_count: row.memo_word_count, created_at: row.created_at } : null;
    })(),
    latest_earnings_guidance: (() => {
      const row = (latestEarningsMemoRes?.data as unknown as Array<{ session_id: string; guidance_delta: string; created_at: string }>)?.[0];
      return row ? { session_id: row.session_id, guidance: row.guidance_delta, created_at: row.created_at } : null;
    })(),
    prediction_markets: (() => {
      const rows = (predictionRes?.data as unknown as Array<{ source: string; market_ticker: string; market_name: string; yes_price: number | null; delta_24h: number | null; snapshot_at: string }>) ?? [];
      // Dedupe to latest per ticker, then sort by |delta_24h|
      const seen = new Set<string>();
      const latest = rows.filter(r => { if (seen.has(r.market_ticker)) return false; seen.add(r.market_ticker); return true; });
      const withDelta = latest.filter(r => r.delta_24h != null);
      withDelta.sort((a, b) => Math.abs(Number(b.delta_24h)) - Math.abs(Number(a.delta_24h)));
      return withDelta.slice(0, 5).map(r => ({
        source: r.source,
        name: r.market_name.slice(0, 80),
        yes_pct: r.yes_price != null ? Math.round(r.yes_price * 100) : null,
        delta_24h_pp: r.delta_24h != null ? Math.round(r.delta_24h * 100) : null,
      }));
    })(),
  };
}

function buildUserPrompt(ctx: Awaited<ReturnType<typeof buildContext>>): string {
  return `Generate a concise morning briefing for Wes, principal of The Glastonbury Group.

LIVE CONTEXT (JSON):
${JSON.stringify(ctx, null, 2)}

BRIEFING FORMAT (keep each section tight; cite the exact numbers above):
1. Lead — the single most important thing to know right now (1 sentence). Escalate to storm_watch if highest_threat is warning or direct_hit.
2. Portfolio Status — overnight P&L, equity, top positions.
3. Market Pulse — SPY/QQQ/DIA/IWM moves + VIX level.
4. Agentic Stack Status — in 2-3 sentences, surface any of these that are active:
   • storm_watch.active_count > 0 → name the storm + threat level + impacted territory count
   • tax_harvest.pending_suggestions > 0 → total estimated savings ($) and direct Wes to /tax/harvest/weekly
   • coach_rule.rule present → quote this week's rule verbatim as a reminder
   • recent_crew_runs with BULL/BEAR verdicts → name the ticker + verdict
   • latest_research_memo → topic + word_count
   • prediction_markets with |delta_24h_pp| ≥ 5 → name the market + shift
5. News Edge — 1-2 headlines from top_news that matter for Wes's book.
6. Watchlist Signal — one name from the watchlist worth watching today.
7. CR3 Foundation Check — progress against the $580K 2026 foundation goal. Note if storm_watch flags any Florida territory.
8. Three Plays — three concrete, specific moves for today.
9. Close — one line of energy.

Keep total under 350 words. No filler. When directing Wes to a page, use the real path (/tax/harvest/weekly, /journal/coach, /crew, /research, /territories, /macro, /earnings/live).`;
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
  const userId = req.nextUrl.searchParams.get('user') || 'wes';

  // Durable rate limit: 10 per minute, cross-instance. Pre-cache check is
  // cheap, but the post-cache Opus call is expensive — we want this enforced
  // even when Vercel scales horizontally.
  const { allowed } = await checkRateLimitDurable('keisha-briefing', userId, 10, 60);
  if (!allowed) {
    return new Response('Too many requests', { status: 429 });
  }
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === 'true';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(sseEncode(obj)));
      const safeClose = () => { try { controller.close(); } catch { /* already closed */ } };

      // Lease tracking — released in finally so even crashes don't deadlock.
      let leaseId: string | null = null;
      const sb = createServiceClient();

      const replayFromCache = async (): Promise<boolean> => {
        const cached = await maybeServeCache(userId);
        if (!cached) return false;
        send({ type: 'meta', cached: true, model: cached.model, briefingId: cached.id, createdAt: cached.createdAt });
        const chunkSize = 80;
        for (let i = 0; i < cached.text.length; i += chunkSize) {
          send({ type: 'token', text: cached.text.slice(i, i + chunkSize) });
        }
        send({ type: 'done', cached: true, briefingId: cached.id });
        safeClose();
        return true;
      };

      try {
        // ── Cache check ───────────────────────────────────────────────
        if (!forceRefresh && await replayFromCache()) return;

        // ── Briefing-lease lock (Fix 2): RPC returns TABLE(lease_id uuid).
        // Empty array means another request holds the (un-expired) lease, so
        // this request waits, then replays the cache once the leader writes.
        const { data: leaseRows } = await sb.rpc('try_acquire_briefing_lease', {
          p_user_id: userId,
          p_ttl_seconds: 90,
        });
        const rows = (leaseRows as unknown as Array<{ lease_id: string }> | null) ?? [];
        leaseId = rows[0]?.lease_id ?? null;

        if (!leaseId) {
          // Someone else is generating right now. Poll the cache for up to 30s.
          send({ type: 'meta', cached: false, waiting: true });
          const deadline = Date.now() + 30_000;
          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 1000));
            if (await replayFromCache()) return;
          }
          send({ type: 'error', message: 'Another briefing is already generating — try again in a moment.' });
          safeClose();
          return;
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

        // p6-3: emit Anthropic cost telemetry on the highest-traffic stream
        // call site. Without this, the Sentry "Anthropic budget burn" alert
        // never sees keisha briefings — the most likely runaway-loop path.
        tagAnthropicCall(
          { input_tokens: tokensIn, output_tokens: tokensOut },
          modelUsed,
          { caller: 'keisha/briefing', latency_ms: latencyMs },
        );

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
        // Always release the briefing lease so we don't block the next
        // legitimate request even on errors / abort / SDK exceptions.
        if (leaseId) {
          try { await sb.rpc('release_briefing_lease', { p_user_id: userId, p_lease_id: leaseId }); }
          catch { /* best-effort */ }
        }
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
