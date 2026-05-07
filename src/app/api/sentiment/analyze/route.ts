import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { tagAnthropicCall } from '@/lib/anthropic-cost';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

export async function POST(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'sentiment/analyze' });

  // P0-6: Claude call, durable session-keyed limit.
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('sentiment-analyze', key, 10, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    // p6-13: read env per request (no module-load cache).
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }

    const { text } = await req.json();
    if (!text) {
      return NextResponse.json({ error: 'text field required' }, { status: 400 });
    }

    const model = process.env.CLAUDE_MODEL_FAST || 'claude-haiku-4-5-20251001';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Analyze the sentiment of this text. Score 1-10 (1=very bearish, 10=very bullish). Return JSON only: {"score": number, "summary": string, "flags": string[]}\n\nText: ${text}`,
        }],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) throw new Error(`Claude API ${res.status}`);

    const data = await res.json();
    // p6-13: tag spend on this raw-fetch Anthropic site (the SDK callers
    // are tagged via lib/anthropic-cost.ts in p6-3/p6-12; this one was
    // hidden from those sweeps because it uses raw fetch).
    if (data.usage) {
      tagAnthropicCall(data.usage, model, { caller: 'sentiment/analyze' });
    }

    const content = data.content?.[0]?.text || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      return NextResponse.json(JSON.parse(jsonMatch[0]));
    }

    return NextResponse.json({ score: 5, summary: content, flags: [] });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'sentiment/analyze' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'sentiment analyze failed');
    // Don't echo raw upstream message — generic public response with eventId.
    return NextResponse.json({ error: 'Sentiment analysis failed', sentry_event_id: eventId }, { status: 500 });
  }
}
