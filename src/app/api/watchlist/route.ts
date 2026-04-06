import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

interface WatchlistRow {
  symbol: string;
  notes: string | null;
  buy_target: number | null;
  sell_target: number | null;
}

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_API_KEY || '';

export async function GET(req: NextRequest) {
  try {
    const symbols = req.nextUrl.searchParams.get('symbols') || '';
    if (!symbols || !FMP_KEY) {
      return NextResponse.json({ quotes: [], targets: {} });
    }

    const symbolList = symbols.split(',').filter(Boolean);

    // Fetch quotes from FMP
    const results = await Promise.all(
      symbolList.map(async (sym) => {
        try {
          const res = await fetch(`${FMP_BASE}/quote?symbol=${encodeURIComponent(sym.trim())}&apikey=${FMP_KEY}`);
          if (!res.ok) return null;
          const data = await res.json();
          if (!Array.isArray(data) || data.length === 0) return null;
          const q = data[0] as Record<string, unknown>;
          return {
            symbol: q.symbol,
            name: q.name,
            price: q.price,
            change: q.change,
            changePercent: q.changePercentage,
            volume: q.volume,
            dayHigh: q.dayHigh,
            dayLow: q.dayLow,
            yearHigh: q.yearHigh,
            yearLow: q.yearLow,
            pe: q.pe ?? null,
            marketCap: q.marketCap,
          };
        } catch {
          return null;
        }
      })
    );

    // Fetch notes & targets from Supabase
    let targets: Record<string, { notes: string | null; buyTarget: number | null; sellTarget: number | null }> = {};
    try {
      const supabase = getSupabase();
      const { data: rows } = await supabase
        .from('watchlist')
        .select('symbol, notes, buy_target, sell_target')
        .in('symbol', symbolList) as { data: WatchlistRow[] | null };
      if (rows) {
        for (const row of rows) {
          targets[row.symbol] = {
            notes: row.notes ?? null,
            buyTarget: row.buy_target ? Number(row.buy_target) : null,
            sellTarget: row.sell_target ? Number(row.sell_target) : null,
          };
        }
      }
    } catch {
      // Supabase unavailable — return quotes without targets
    }

    return NextResponse.json({ quotes: results.filter(Boolean), targets });
  } catch (error) {
    console.error('Watchlist error:', error);
    return NextResponse.json({ quotes: [], targets: {} });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { symbol, notes, buyTarget, sellTarget } = body;

    if (!symbol) {
      return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
    }

    const supabase = getSupabase();

    // Upsert: insert if missing, update if exists
    const updateData: Record<string, unknown> = {
      symbol: symbol.toUpperCase(),
      updated_at: new Date().toISOString(),
    };
    if (notes !== undefined) updateData.notes = notes;
    if (buyTarget !== undefined) updateData.buy_target = buyTarget;
    if (sellTarget !== undefined) updateData.sell_target = sellTarget;

    const { data, error } = await supabase
      .from('watchlist')
      .upsert(updateData as never, { onConflict: 'symbol' })
      .select()
      .single() as { data: WatchlistRow | null; error: { message: string } | null };

    if (error) {
      console.error('Watchlist PATCH error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      symbol: data?.symbol,
      notes: data?.notes,
      buyTarget: data?.buy_target ? Number(data.buy_target) : null,
      sellTarget: data?.sell_target ? Number(data.sell_target) : null,
    });
  } catch (error) {
    console.error('Watchlist PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
