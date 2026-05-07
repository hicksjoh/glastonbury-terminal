import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

export async function GET(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'journal' });
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
    const eventId = captureRouteError(error, { request_id, route: 'journal/get' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'journal GET failed');
    return NextResponse.json({ success: false, error: 'Failed to fetch journal' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'journal' });
  try {
    const supabase = createServiceClient();
    const body = await req.json();

    // Validate required fields and sanitize input
    const { ticker, entry_date, direction, entry_price, strategy, notes, pnl, exit_price, exit_date, keisha_agreed, keisha_signal } = body;
    if (!ticker || typeof ticker !== 'string' || ticker.length > 10) {
      return NextResponse.json({ success: false, error: 'Invalid or missing ticker' }, { status: 400 });
    }
    if (!entry_date || typeof entry_date !== 'string') {
      return NextResponse.json({ success: false, error: 'Invalid or missing entry_date' }, { status: 400 });
    }
    if (!direction || !['long', 'short'].includes(direction)) {
      return NextResponse.json({ success: false, error: 'direction must be "long" or "short"' }, { status: 400 });
    }

    const sanitizedEntry = {
      ticker: ticker.toUpperCase().trim(),
      entry_date,
      direction,
      entry_price: entry_price ? Number(entry_price) : null,
      exit_price: exit_price ? Number(exit_price) : null,
      exit_date: exit_date || null,
      pnl: pnl ? Number(pnl) : null,
      strategy: strategy ? String(strategy).slice(0, 100) : null,
      notes: notes ? String(notes).slice(0, 5000) : null,
      keisha_agreed: typeof keisha_agreed === 'boolean' ? keisha_agreed : null,
      keisha_signal: keisha_signal ? String(keisha_signal).slice(0, 500) : null,
    };

    const { data, error } = await supabase.from('trade_journal').insert(sanitizedEntry).select().single();
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'journal/post' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'journal POST failed');
    return NextResponse.json({ success: false, error: 'Failed to create journal entry' }, { status: 500 });
  }
}
