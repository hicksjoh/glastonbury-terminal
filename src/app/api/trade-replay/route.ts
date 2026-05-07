import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServiceClient } from '@/lib/supabase';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { tagAnthropicCall } from '@/lib/anthropic-cost';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TradeReplay {
  tradeSummary: string;
  whatHappened: string;
  entryGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  exitGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  optimalExit: { price: number; time: string; pnl: number };
  moneyLeftOnTable: number;
  edgeAnalysis: string;
  lesson: string;
  patternMatch: string | null;
}

const VALID_GRADES = new Set(['A', 'B', 'C', 'D', 'F']);

function getBaseUrl(): string {
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
}

// ─── Route ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // P0-6: Claude trade replay, durable session-keyed.
  const { key } = await getRateLimitIdentity(request);
  const rl = await checkRateLimitDurable('trade-replay', key, 20, 60 * 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    const body = await request.json();
    const tradeId = String(body.tradeId || '').trim();
    if (!tradeId) {
      return NextResponse.json({ error: 'Missing tradeId' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Fetch the trade from journal
    const { data: trade, error: tradeErr } = await supabase
      .from('trade_journal')
      .select('*')
      .eq('id', tradeId)
      .single();

    if (tradeErr || !trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    // Check if replay already exists
    const { data: existingReplay } = await supabase
      .from('trade_replays')
      .select('replay_data')
      .eq('trade_id', tradeId)
      .limit(1)
      .single();

    if (existingReplay?.replay_data) {
      return NextResponse.json({ replay: existingReplay.replay_data, cached: true });
    }

    // Gather market context at entry time
    const baseUrl = getBaseUrl();
    let marketContext = '';
    try {
      const [regimeRes, gexRes] = await Promise.all([
        fetch(`${baseUrl}/api/regime`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${baseUrl}/api/gex?symbol=${trade.ticker}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      const parts: string[] = [];
      if (regimeRes?.regime) parts.push(`Market regime at trade time: ${regimeRes.regime} (VIX: ${regimeRes.vix || 'N/A'})`);
      if (gexRes?.regime) parts.push(`GEX regime: ${gexRes.regime} (net GEX: ${gexRes.netGEX || 0})`);
      marketContext = parts.join('\n');
    } catch {
      marketContext = 'Market context unavailable';
    }

    // Build prompt
    const pnl = Number(trade.pnl || 0);
    const entryPrice = Number(trade.entry_price || 0);
    const exitPrice = Number(trade.exit_price || entryPrice);
    const qty = Number(trade.quantity || 1);

    const prompt = `Analyze this closed trade with full market context. Generate a structured post-mortem.

TRADE DATA:
- Symbol: ${trade.ticker}
- Direction: ${trade.direction || 'long'}
- Entry: $${entryPrice.toFixed(2)} on ${trade.entry_date || 'N/A'}
- Exit: $${exitPrice.toFixed(2)} on ${trade.exit_date || 'N/A'}
- Quantity: ${qty}
- P&L: $${pnl.toFixed(2)} (${trade.pnl_percent || '0'}%)
- Strategy: ${trade.strategy || 'discretionary'}
- Entry Thesis: ${trade.entry_thesis || 'None recorded'}
- Exit Thesis: ${trade.exit_thesis || 'None recorded'}

MARKET CONTEXT:
${marketContext || 'Not available'}

Return analysis in this exact JSON format:
{
  "tradeSummary": "One-line description of the trade",
  "whatHappened": "2-3 sentences about market context during the trade",
  "entryGrade": "A|B|C|D|F",
  "exitGrade": "A|B|C|D|F",
  "optimalExit": { "price": 0, "time": "description of when", "pnl": 0 },
  "moneyLeftOnTable": 0,
  "edgeAnalysis": "What was the trader's edge (or lack thereof)?",
  "lesson": "One specific, actionable takeaway",
  "patternMatch": "pattern name or null"
}

Grade harshly but fairly. A = exceptional timing. B = good. C = average. D = poor. F = catastrophic.
Positive moneyLeftOnTable means they exited too early. Negative means they saved money by exiting before worse.`;

    const anthropic = new Anthropic();
    const replayModel = process.env.CLAUDE_MODEL_FALLBACK || 'claude-sonnet-4-6';
    const msg = await anthropic.messages.create({
      model: replayModel,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
    tagAnthropicCall(msg.usage, replayModel, { caller: 'trade-replay' });

    const textBlock = msg.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No AI response' }, { status: 500 });
    }

    let replay: TradeReplay;
    try {
      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : textBlock.text);

      replay = {
        tradeSummary: String(parsed.tradeSummary || ''),
        whatHappened: String(parsed.whatHappened || ''),
        entryGrade: VALID_GRADES.has(parsed.entryGrade) ? parsed.entryGrade : 'C',
        exitGrade: VALID_GRADES.has(parsed.exitGrade) ? parsed.exitGrade : 'C',
        optimalExit: {
          price: Number(parsed.optimalExit?.price || exitPrice),
          time: String(parsed.optimalExit?.time || ''),
          pnl: Number(parsed.optimalExit?.pnl || pnl),
        },
        moneyLeftOnTable: Number(parsed.moneyLeftOnTable || 0),
        edgeAnalysis: String(parsed.edgeAnalysis || ''),
        lesson: String(parsed.lesson || ''),
        patternMatch: parsed.patternMatch || null,
      };
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    // Store in Supabase
    const { error: insertErr } = await supabase
      .from('trade_replays')
      .insert({
        trade_id: tradeId,
        symbol: trade.ticker,
        side: trade.direction || 'long',
        entry_price: entryPrice,
        exit_price: exitPrice,
        pnl,
        entry_grade: replay.entryGrade,
        exit_grade: replay.exitGrade,
        optimal_exit_price: replay.optimalExit.price,
        optimal_pnl: replay.optimalExit.pnl,
        money_left_on_table: replay.moneyLeftOnTable,
        replay_data: replay,
      });

    if (insertErr) {
      console.error('[trade-replay] Supabase insert error:', insertErr.message);
      // Still return the replay even if save fails
    }

    return NextResponse.json({ replay, cached: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Replay generation failed';
    console.error('[trade-replay] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
