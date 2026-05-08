import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { executeToolCall } from '@/lib/keisha-tools';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

// ═════════════════════════════════════════════════════════════════════════════
//  POST Handler — Slash Command Direct Tool Execution (no Claude invocation)
// ═════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'keisha/slash' });

  // P0-6: durable session-keyed limiter (audit requires all keisha/* on durable).
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('keisha-slash', key, 30, 60);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { tool, input } = await req.json();

    if (!tool || typeof tool !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid tool name' }, { status: 400 });
    }

    const toolInput: Record<string, unknown> = input && typeof input === 'object' ? input : {};
    const { result, success } = await executeToolCall(tool, toolInput);

    return NextResponse.json({ result, success });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'keisha/slash' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'keisha slash failed');
    return NextResponse.json({ error: 'Slash command failed', sentry_event_id: eventId }, { status: 500 });
  }
}
