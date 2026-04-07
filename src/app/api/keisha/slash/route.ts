import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { executeToolCall } from '@/lib/keisha-tools';

// ═════════════════════════════════════════════════════════════════════════════
//  POST Handler — Slash Command Direct Tool Execution (no Claude invocation)
// ═════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('keisha-slash', 30, 60000);
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
