import { NextRequest } from 'next/server';
import { anthropic, CLAUDE_MODEL_PRIMARY, CLAUDE_MODEL_FALLBACK } from '@/lib/claude';
import { createServiceClient } from '@/lib/supabase';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEISHA_EARNINGS_CHAT_SYSTEM = `You are Keisha — Wes' senior trading analyst live on an earnings call. You ground every answer in the transcript you are given. If the answer isn't in the transcript, say so plainly. Direct, number-dense, warm. Quote the specific line when asked about something specific.`;

const sseEncode = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

// POST /api/earnings/live/session/[id]/chat — SSE answer grounded in transcript
export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const { allowed } = rateLimit('earnings-chat', 30, 60_000);
  if (!allowed) return new Response('Too many requests', { status: 429 });

  const sessionId = ctx.params.id;

  let body: { question?: string; history?: { role: 'user' | 'assistant'; content: string }[] };
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const question = (body.question ?? '').trim();
  if (!question) return new Response('Empty question', { status: 400 });

  // Pull ticker + latest transcript chunks
  const sb = createServiceClient();
  const [sessRes, chunksRes] = await Promise.all([
    sb.from('earnings_sessions').select('ticker, quarter, call_date').eq('id', sessionId).single(),
    sb.from('earnings_transcript_chunks')
      .select('seq, speaker, chunk_text, sentiment_score, sentiment_tags')
      .eq('session_id', sessionId)
      .order('seq', { ascending: true })
      .limit(800),
  ]);
  if (sessRes.error || !sessRes.data) return new Response('Session not found', { status: 404 });
  const session = sessRes.data as unknown as { ticker: string; quarter: string | null; call_date: string };
  const chunks = (chunksRes.data as unknown as { seq: number; speaker: string | null; chunk_text: string; sentiment_score: number | null; sentiment_tags: string[] | null }[]) ?? [];

  // Build transcript context. Trim if too long.
  let transcriptBlob = chunks
    .map(c => `${c.speaker ?? ''}: ${c.chunk_text}`.trim())
    .join('\n');
  const MAX = 60_000;
  if (transcriptBlob.length > MAX) {
    transcriptBlob = transcriptBlob.slice(-MAX); // keep the tail (most recent)
  }

  const contextPrompt = `Ticker: ${session.ticker}
${session.quarter ? `Quarter: ${session.quarter}` : ''}
Call date: ${session.call_date}
Transcript so far (${chunks.length} paragraphs):

${transcriptBlob}

Question: ${question}

Answer using only what's in the transcript above. Quote specific lines where appropriate. If the question isn't answerable from the transcript, say so.`;

  const messages = [
    ...(body.history ?? []).slice(-6),
    { role: 'user' as const, content: contextPrompt },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (o: unknown) => { if (closed) return; try { controller.enqueue(encoder.encode(sseEncode(o))); } catch { /* closed */ } };
      const close = () => { if (closed) return; closed = true; try { controller.close(); } catch { /* already closed */ } };
      req.signal.addEventListener('abort', close, { once: true });

      try {
        const callStream = (model: string) => anthropic.messages.stream({
          model,
          max_tokens: 1200,
          system: KEISHA_EARNINGS_CHAT_SYSTEM,
          messages,
        });
        let modelUsed = CLAUDE_MODEL_PRIMARY;
        let s: ReturnType<typeof anthropic.messages.stream>;
        try {
          s = callStream(modelUsed);
        } catch (err) {
          const status = (err as { status?: number })?.status;
          if (status === 429 || status === 529 || status === 503) {
            modelUsed = CLAUDE_MODEL_FALLBACK;
            s = callStream(modelUsed);
          } else { throw err; }
        }
        send({ type: 'meta', model: modelUsed, transcript_chars: transcriptBlob.length });
        s.on('text', (delta: string) => send({ type: 'token', delta }));
        await s.finalMessage();
        send({ type: 'done' });
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
