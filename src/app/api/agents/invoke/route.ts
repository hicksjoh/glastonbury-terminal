import { NextRequest, NextResponse } from 'next/server';
import { classifyIntent, dispatch } from '@/lib/agents/orchestrator';
import { buildMeta } from '@/lib/api-meta';

export async function POST(req: NextRequest) {
  try {
    const { message, symbol, intent: forceIntent } = await req.json();

    if (!message && !forceIntent) {
      return NextResponse.json({
        error: 'message or intent required',
        _meta: buildMeta({ source: 'agents', live: false }),
      }, { status: 400 });
    }

    // Classify intent from message or use forced intent
    const { intent, symbol: extractedSymbol } = forceIntent
      ? { intent: forceIntent, symbol }
      : classifyIntent(message);

    const finalSymbol = symbol || extractedSymbol;

    // Dispatch agents
    const result = await dispatch(intent, finalSymbol);

    return NextResponse.json({
      intent,
      symbol: finalSymbol,
      agentsUsed: result.agentsUsed,
      totalLatencyMs: result.totalLatencyMs,
      results: result.results,
      _meta: buildMeta({ source: `orchestrator:${result.agentsUsed.length}agents`, live: true }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: msg,
      _meta: buildMeta({ source: 'agents', live: false, error: msg }),
    }, { status: 500 });
  }
}

// Also support GET for simple queries
export async function GET(req: NextRequest) {
  const message = req.nextUrl.searchParams.get('q') || req.nextUrl.searchParams.get('message') || '';
  const symbol = req.nextUrl.searchParams.get('symbol') || undefined;

  if (!message) {
    return NextResponse.json({
      error: 'q parameter required',
      _meta: buildMeta({ source: 'agents', live: false }),
    }, { status: 400 });
  }

  const { intent, symbol: extracted } = classifyIntent(message);
  const result = await dispatch(intent, symbol || extracted);

  return NextResponse.json({
    intent,
    symbol: symbol || extracted,
    agentsUsed: result.agentsUsed,
    totalLatencyMs: result.totalLatencyMs,
    results: result.results,
    _meta: buildMeta({ source: `orchestrator:${result.agentsUsed.length}agents`, live: true }),
  });
}
