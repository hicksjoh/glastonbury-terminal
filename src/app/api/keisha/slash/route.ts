import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { executeToolCall } from '@/lib/keisha-tools';

// ═════════════════════════════════════════════════════════════════════════════
//  POST Handler — Slash Command Direct Tool Execution (no Claude invocation)
// ═════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
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
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Slash command API error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
