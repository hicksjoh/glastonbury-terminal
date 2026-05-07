/**
 * Phase 10 — Behavioral Coach.
 *
 * Weekly review of Wes's last 7 days of Alpaca trades + journal entries.
 * Claude Opus acts as his trading psychology coach — flags revenge trades,
 * FOMO chases, size creep, Friday YOLOs, overtrading, and suggests ONE
 * concrete rule for the next week.
 */

import { anthropic, CLAUDE_MODEL_PRIMARY, CLAUDE_MODEL_FALLBACK } from '@/lib/claude';
import { tagAnthropicCall } from '@/lib/anthropic-cost';
import { createServiceClient } from '@/lib/supabase';

const COACH_SYSTEM = `You are Wes Hicks' trading psychology coach. Be kind but firm — direct, data-driven, warm. African American slang welcome when it fits.

Your job: review the last week's trades + journal. Identify patterns. Flag behaviors that destroy capital. Suggest ONE concrete rule for next week — measurable, specific, non-negotiable.

Common patterns to look for (flag each you see):
- REVENGE_TRADE: entering a new position within an hour of a loss on the same ticker or direction.
- FOMO_CHASE: buying a ticker after it has already moved >3% on the day.
- SIZE_CREEP: position size in $ or % gradually increasing over the week without a matching increase in edge or conviction.
- FRIDAY_YOLO: late-Friday speculative bets, especially in options, expiring same-day or within 48h.
- OVERTRADING: trade count elevated with a low win rate (<40%) or diminishing avg-P&L.
- DISPOSITION_EFFECT: holding losers too long / cutting winners too early (avg loss duration > avg win duration significantly).
- SCALING_DOWN_ON_WINS: cutting size after a winner instead of pressing edge.

Return ONLY a JSON object (no markdown fences) matching this shape:
{
  "review_markdown": string,              // 300-500 word coaching review. Direct. Warm. Cite actual trades by ticker.
  "patterns_detected": [
    { "type": string, "evidence": string, "severity": "low"|"medium"|"high" }
  ],
  "primary_rule_for_next_week": string,   // ONE sentence. Specific. Measurable.
  "summary_stats": {
    "trade_count": number,
    "win_count": number,
    "loss_count": number,
    "pnl_usd": number,
    "largest_winner_ticker": string | null,
    "largest_loser_ticker": string | null
  }
}`;

export type CoachReviewResult = {
  review_markdown: string;
  patterns_detected: { type: string; evidence: string; severity: 'low' | 'medium' | 'high' }[];
  primary_rule_for_next_week: string;
  trade_count: number;
  pnl_usd: number;
  model_used: string;
};

type AlpacaActivity = {
  activity_type: string;
  transaction_time: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: string;
  price: string;
};

type JournalEntry = {
  id: string;
  ticker: string | null;
  direction: string | null;
  strategy: string | null;
  entry_date: string | null;
  exit_date: string | null;
  entry_price: number | null;
  exit_price: number | null;
  pnl: number | null;
  notes: string | null;
  created_at: string;
};

async function fetchAlpacaActivities(daysBack: number): Promise<AlpacaActivity[]> {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET || process.env.ALPACA_SECRET_KEY;
  const base = process.env.ALPACA_TRADING_URL || process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  if (!key || !secret) return [];
  const after = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  try {
    const res = await fetch(`${base}/v2/account/activities?direction=desc&activity_types=FILL&after=${encodeURIComponent(after)}&page_size=200`, {
      headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body) ? body as AlpacaActivity[] : [];
  } catch { return []; }
}

async function fetchJournalEntries(daysBack: number): Promise<JournalEntry[]> {
  const sb = createServiceClient();
  const after = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from('trade_journal')
    .select('id, ticker, direction, strategy, entry_date, exit_date, entry_price, exit_price, pnl, notes, created_at')
    .gte('created_at', after)
    .order('created_at', { ascending: false });
  return (data as unknown as JournalEntry[]) ?? [];
}

function pickModel(fallback = false): string {
  return fallback ? CLAUDE_MODEL_FALLBACK : CLAUDE_MODEL_PRIMARY;
}

export async function runCoachReview(args?: { daysBack?: number }): Promise<CoachReviewResult> {
  const days = args?.daysBack ?? 7;
  const [activities, journal] = await Promise.all([
    fetchAlpacaActivities(days),
    fetchJournalEntries(days),
  ]);

  const userPrompt = `Last ${days} days of activity.

ALPACA FILLS (${activities.length}):
${JSON.stringify(activities.slice(0, 100), null, 2)}

JOURNAL ENTRIES (${journal.length}):
${JSON.stringify(journal.slice(0, 40).map(j => ({
    ticker: j.ticker, direction: j.direction, strategy: j.strategy,
    entry_date: j.entry_date, exit_date: j.exit_date,
    entry_price: j.entry_price, exit_price: j.exit_price,
    pnl: j.pnl,
    notes: j.notes?.slice(0, 300),
  })), null, 2)}

Write the coaching review now.`;

  const call = (model: string) => anthropic.messages.create({
    model,
    max_tokens: 2500,
    system: COACH_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });

  let modelUsed = pickModel();
  let msg: Awaited<ReturnType<typeof anthropic.messages.create>>;
  try {
    msg = await call(modelUsed);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 429 || status === 529 || status === 503) {
      modelUsed = pickModel(true);
      msg = await call(modelUsed);
    } else throw err;
  }
  tagAnthropicCall(msg.usage, modelUsed, { caller: 'coach-engine' });

  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const m = cleaned.match(/\{[\s\S]*\}/);
  const jsonStr = m ? m[0] : cleaned;
  type ParsedReview = {
    review_markdown?: string;
    patterns_detected?: Array<{ type?: string; evidence?: string; severity?: string }>;
    primary_rule_for_next_week?: string;
    summary_stats?: { trade_count?: number; pnl_usd?: number };
  };
  let parsed: ParsedReview = {};
  try { parsed = JSON.parse(jsonStr) as ParsedReview; } catch { /* noop */ }

  return {
    review_markdown: String(parsed.review_markdown ?? text).slice(0, 10_000),
    patterns_detected: Array.isArray(parsed.patterns_detected)
      ? parsed.patterns_detected.slice(0, 10).map(p => ({
          type: String(p?.type ?? ''),
          evidence: String(p?.evidence ?? ''),
          severity: (['low', 'medium', 'high'].includes(String(p?.severity)) ? p?.severity : 'medium') as 'low'|'medium'|'high',
        }))
      : [],
    primary_rule_for_next_week: String(parsed.primary_rule_for_next_week ?? '').slice(0, 400),
    trade_count: Number(parsed.summary_stats?.trade_count) || activities.length,
    pnl_usd: Number(parsed.summary_stats?.pnl_usd) || 0,
    model_used: modelUsed,
  };
}

export async function persistCoachReview(userId: string, result: CoachReviewResult): Promise<{ weekOf: string; id: string | null }> {
  const sb = createServiceClient();
  // Monday of current week
  const d = new Date();
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + diff);
  const weekOf = d.toISOString().slice(0, 10);

  // Idempotent per (user, week) — upsert via delete + insert (table has UNIQUE constraint)
  await sb.from('coach_reviews').delete().eq('user_id', userId).eq('week_of', weekOf);

  const { data, error } = await sb.from('coach_reviews').insert({
    user_id: userId,
    week_of: weekOf,
    review_markdown: result.review_markdown,
    patterns_detected: result.patterns_detected,
    primary_rule_for_next_week: result.primary_rule_for_next_week,
    trade_count: result.trade_count,
    pnl_usd: result.pnl_usd,
  }).select('id').single();
  if (error) return { weekOf, id: null };
  return { weekOf, id: (data as unknown as { id: string } | null)?.id ?? null };
}
