import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/debate/decision  body: { id, decision, linkedTradeId? }
export async function POST(req: NextRequest) {
  let body: { id?: string; decision?: 'took_trade' | 'passed' | 'modified' | 'deferred'; linkedTradeId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  if (!['took_trade', 'passed', 'modified', 'deferred'].includes(body.decision ?? '')) {
    return NextResponse.json({ error: 'Bad decision' }, { status: 400 });
  }
  const sb = createServiceClient();
  const { error } = await sb.from('trade_debates').update({
    wes_decision: body.decision,
    linked_trade_id: body.linkedTradeId ?? null,
  }).eq('id', body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ updated: true });
}
