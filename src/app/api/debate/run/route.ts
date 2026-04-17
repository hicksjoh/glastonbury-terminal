import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { rateLimit } from '@/lib/rate-limit';
import { runDebate, type ProposedTrade, type DebateEvent } from '@/lib/debate-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const sseEncode = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

// POST /api/debate/run  body: { ticker, proposedTrade? }
// Streams the full debate via SSE. Persists to trade_debates on completion.
export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('debate-run', 6, 300_000);
  if (!allowed) return new Response('Too many requests', { status: 429 });

  let body: { ticker?: string; proposedTrade?: ProposedTrade };
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const ticker = (body.ticker ?? '').trim().toUpperCase();
  if (!/^[A-Z.\-]{1,8}$/.test(ticker)) return new Response('Invalid ticker', { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (o: unknown) => { if (closed) return; try { controller.enqueue(encoder.encode(sseEncode(o))); } catch { /* noop */ } };
      const close = () => { if (closed) return; closed = true; try { controller.close(); } catch { /* noop */ } };

      try {
        const result = await runDebate({
          ticker,
          proposedTrade: body.proposedTrade ?? null,
          onEvent: (e: DebateEvent) => send(e),
        });

        // Persist
        const sb = createServiceClient();
        const { data: inserted } = await sb.from('trade_debates').insert({
          user_id: 'wes',
          ticker,
          proposed_trade: body.proposedTrade ?? {},
          bull_rounds: result.bullRounds.map(r => ({ round: r.round, text: r.text, model: r.model })),
          bear_rounds: result.bearRounds.map(r => ({ round: r.round, text: r.text, model: r.model })),
          moderator_verdict: result.moderator.verdict,
          moderator_confidence: result.moderator.confidence,
          key_tension_points: result.moderator.key_tension_points,
        }).select('id').single();

        send({
          type: 'complete',
          debateId: (inserted as unknown as { id?: string } | null)?.id ?? null,
          totalCostUsd: Number(result.totalCostUsd.toFixed(6)),
          totalLatencyMs: result.totalLatencyMs,
          model: result.moderator.model,
        });
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
