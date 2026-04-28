import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { checkRateLimitDurable } from '@/lib/rate-limit-durable';
import { runResearchAgent, wordCount, type AgentEvent } from '@/lib/research-agent';
import { sendResendEmail } from '@/lib/resend-client';
import { indexDoc } from '@/lib/doc-indexer';
import { isEmbeddingConfigured } from '@/lib/embeddings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Vercel Pro max; hobby = 60s

const DEFAULT_BUDGET_SECONDS = Number(process.env.ANTHROPIC_MANAGED_AGENT_MAX_MINUTES ?? '5') * 60;
const DEFAULT_BUDGET_COST = Number(process.env.ANTHROPIC_MANAGED_AGENT_BUDGET_USD ?? '5');
const DEFAULT_BUDGET_TOKENS = 200_000;

const sseEncode = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

// POST /api/research/start — create memo row, run agent inline, stream progress via SSE
export async function POST(req: NextRequest) {
  // Durable rate limit: 4 per 5 min, enforced across all Vercel instances.
  const { allowed } = await checkRateLimitDurable('research-start', 'wes', 4, 300);
  if (!allowed) return new Response('Too many requests', { status: 429 });

  let body: { topic?: string; ticker?: string; prompt?: string; budgetSeconds?: number; budgetCostUsd?: number };
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  // ── Input validation (matches /api/crew/analyze + /api/debate/run) ────────
  // Caps prevent prompt-injection bill bombs: even at the per-run $5 cap, a
  // 100KB topic burnt ~$1.50 of input tokens before the agent could shut down.
  const TOPIC_MAX = 500;
  const PROMPT_MAX = 4000;
  const TICKER_RE = /^[A-Z.\-]{1,8}$/;

  const rawTicker = (body.ticker ?? '').trim().toUpperCase();
  if (rawTicker && !TICKER_RE.test(rawTicker)) {
    return new Response('Invalid ticker (must match /^[A-Z.\\-]{1,8}$/)', { status: 400 });
  }
  const ticker = rawTicker || null;

  const topic = (body.topic ?? '').trim().slice(0, TOPIC_MAX) || (ticker ? `${ticker} deep dive` : '');
  if ((body.topic ?? '').length > TOPIC_MAX) {
    return new Response(`topic exceeds ${TOPIC_MAX} chars`, { status: 400 });
  }
  const prompt = (body.prompt ?? '').trim();
  if (prompt.length > PROMPT_MAX) {
    return new Response(`prompt exceeds ${PROMPT_MAX} chars`, { status: 400 });
  }
  if (!topic && !prompt) return new Response('Missing topic or prompt', { status: 400 });

  const budgetSeconds = Math.min(DEFAULT_BUDGET_SECONDS, Math.max(60, body.budgetSeconds ?? DEFAULT_BUDGET_SECONDS));
  const budgetCostUsd = Math.min(DEFAULT_BUDGET_COST, Math.max(0.25, body.budgetCostUsd ?? DEFAULT_BUDGET_COST));

  const sb = createServiceClient();
  const { data: created, error: createErr } = await sb.from('deep_research_memos').insert({
    user_id: 'wes',
    ticker,
    topic: topic || `${ticker} deep dive`,
    prompt: prompt || `Deliver the full research memo on ${ticker}.`,
    status: 'running',
  }).select('id').single();

  if (createErr || !created) {
    return new Response(`DB error: ${createErr?.message ?? 'unknown'}`, { status: 500 });
  }
  const memoId = (created as unknown as { id: string }).id;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(sseEncode(obj))); } catch { /* closed */ }
      };
      const close = () => { if (closed) return; closed = true; try { controller.close(); } catch { /* noop */ } };

      // If the client disconnects we still want the agent to finish — don't cancel.
      // (We simply stop sending events over the closed SSE stream.)

      send({ type: 'memo_created', memoId, budgetSeconds, budgetCostUsd });

      try {
        const result = await runResearchAgent({
          topic: topic || `${ticker} deep dive`,
          ticker: ticker || undefined,
          prompt: prompt || `Deliver the full research memo on ${ticker}.`,
          budgetSeconds,
          budgetCostUsd,
          budgetOutputTokens: DEFAULT_BUDGET_TOKENS,
          onEvent: (e: AgentEvent) => send(e),
        });

        const wc = wordCount(result.memo_markdown);
        const finalStatus = (result.memo_markdown && wc >= 500 && result.truncated_reason !== 'error')
          ? 'completed' : 'failed';

        await sb.from('deep_research_memos').update({
          memo_markdown: result.memo_markdown,
          memo_word_count: wc,
          sources_cited: result.sources_cited,
          total_cost_usd: result.total_cost_usd,
          total_runtime_seconds: result.total_runtime_seconds,
          status: finalStatus,
          completed_at: new Date().toISOString(),
        }).eq('id', memoId);

        // Fire-and-forget email notification
        if (finalStatus === 'completed') {
          sendResendEmail({
            subject: `Deep Research — ${ticker ?? 'Memo'} — ${wc} words`,
            text: `Your research memo is ready.\n\nTopic: ${topic}\nTicker: ${ticker ?? 'n/a'}\nWords: ${wc}\nSources: ${result.sources_cited.length}\nCost: $${result.total_cost_usd.toFixed(4)}\nRuntime: ${result.total_runtime_seconds}s\n\nRead it: ${process.env.NEXT_PUBLIC_APP_URL ?? ''}/research/${memoId}`,
          }).catch(() => {});

          // Auto-index into doc_chunks for Phase 6 semantic search.
          if (isEmbeddingConfigured().ready) {
            indexDoc({
              doc_type: 'research',
              source_id: memoId,
              content: result.memo_markdown,
              ticker: ticker || null,
              source_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/research/${memoId}`,
              metadata: { topic, word_count: wc, source: 'deep_research_memo' },
            }).catch(() => {});
          }
        }

        send({
          type: 'complete',
          memoId,
          status: finalStatus,
          wordCount: wc,
          sourcesCount: result.sources_cited.length,
          totalCostUsd: Number(result.total_cost_usd.toFixed(6)),
          totalRuntimeSeconds: result.total_runtime_seconds,
          truncatedReason: result.truncated_reason,
        });
      } catch (err) {
        const message = (err as Error).message;
        await sb.from('deep_research_memos').update({
          status: 'failed',
          completed_at: new Date().toISOString(),
        }).eq('id', memoId);
        send({ type: 'error', message });
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
