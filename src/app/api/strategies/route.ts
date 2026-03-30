import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('strategies')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Map DB columns to frontend Strategy shape
    const strategies = (data || []).map((s: Record<string, unknown>) => ({
      id: s.id as string,
      name: s.name as string,
      type: s.type as string,
      status: s.status as string,
      params: (s.params || {}) as Record<string, unknown>,
      performance: {
        totalReturn: (s.total_return as number) || 0,
        totalReturnPct: (s.total_return_pct as number) || 0,
        tradesExecuted: (s.trades_executed as number) || 0,
        lastRun: s.last_run as string | undefined,
      },
      createdAt: s.created_at as string,
      updatedAt: s.updated_at as string,
    }));

    return NextResponse.json(strategies);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
