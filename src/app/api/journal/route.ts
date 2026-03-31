import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const strategy = req.nextUrl.searchParams.get('strategy');
    const ticker = req.nextUrl.searchParams.get('ticker');
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50');

    let query = supabase.from('trade_journal').select('*').order('entry_date', { ascending: false }).limit(limit);
    if (strategy) query = query.eq('strategy', strategy);
    if (ticker) query = query.eq('ticker', ticker);

    const { data, error } = await query;
    if (error) throw error;

    const trades = data || [];
    const wins = trades.filter(t => t.pnl && t.pnl > 0);
    const losses = trades.filter(t => t.pnl && t.pnl < 0);

    return NextResponse.json({
      success: true,
      data: {
        trades,
        stats: {
          total_trades: trades.length,
          win_rate: trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) : '0',
          avg_pnl: trades.length > 0 ? trades.reduce((sum, t) => sum + Number(t.pnl || 0), 0) / trades.length : 0,
          best_trade: trades.reduce((best, t) => Number(t.pnl || 0) > Number(best?.pnl || 0) ? t : best, trades[0]),
          worst_trade: trades.reduce((worst, t) => Number(t.pnl || 0) < Number(worst?.pnl || 0) ? t : worst, trades[0]),
          total_pnl: trades.reduce((sum, t) => sum + Number(t.pnl || 0), 0),
          keisha_override_count: trades.filter(t => t.keisha_agreed === false).length,
        },
      },
    });
  } catch (error) {
    console.error('Journal API error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch journal' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await req.json();

    const { data, error } = await supabase.from('trade_journal').insert(body).select().single();
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Journal create error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create journal entry' }, { status: 500 });
  }
}
