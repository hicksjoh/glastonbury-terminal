import { NextRequest, NextResponse } from 'next/server';
import { getAccount, getPositions } from '@/lib/alpaca';
import { createServiceClient } from '@/lib/supabase';

// ─── Auth check (same pattern as briefing/scheduled) ──────
function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  if (authHeader === `Bearer ${cronSecret}`) return true;
  if (req.headers.get('x-api-key') === cronSecret) return true;
  return false;
}

// ─── POST: Take a snapshot of current portfolio state ─────
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    // Fetch Alpaca + wealth data in parallel
    const [account, positions, { data: wealthAssets }] = await Promise.all([
      getAccount().catch(() => null),
      getPositions().catch(() => []),
      supabase.from('wealth_assets').select('*'),
    ]);

    const equity = account ? parseFloat(account.equity) : 0;
    const cash = account ? parseFloat(account.cash) : 0;
    const lastEquity = account ? parseFloat(account.last_equity) : 0;
    const pnl = equity - lastEquity;

    const positionsArray = Array.isArray(positions) ? positions : [];
    const positionData = positionsArray.map((p: Record<string, string>) => ({
      symbol: p.symbol,
      qty: parseFloat(p.qty),
      market_value: parseFloat(p.market_value),
      cost_basis: parseFloat(p.cost_basis),
      unrealized_pl: parseFloat(p.unrealized_pl),
      current_price: parseFloat(p.current_price),
    }));

    // Calculate wealth components from wealth_assets table
    const assets = wealthAssets || [];
    const assetsByClass: Record<string, number> = {};
    for (const asset of assets) {
      assetsByClass[asset.asset_class] = (assetsByClass[asset.asset_class] || 0) + Number(asset.current_value);
    }

    const cr3Value = assetsByClass['franchise'] || 0;
    const rsuValue = assetsByClass['rsu'] || 0;
    const propertyValue = assetsByClass['real_estate'] || 0;
    const cashReserves = assetsByClass['cash'] || 0;
    const netWorth = equity + cr3Value + rsuValue + propertyValue + cashReserves;

    const today = new Date().toISOString().split('T')[0];

    // Upsert (one snapshot per day)
    const { data, error } = await supabase
      .from('portfolio_snapshots')
      .upsert(
        {
          date: today,
          total_equity: equity,
          equity,
          cash,
          net_worth: netWorth,
          pnl,
          cr3_value: cr3Value,
          rsu_value: rsuValue,
          property_value: propertyValue,
          positions_json: positionData,
        },
        { onConflict: 'date' }
      )
      .select()
      .single();

    if (error) {
      console.error('Supabase snapshot insert error:', error);
      return NextResponse.json({ error: 'Failed to save snapshot', details: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      snapshot: {
        id: data.id,
        date: data.date,
        equity,
        cash,
        net_worth: netWorth,
        pnl,
        cr3_value: cr3Value,
        rsu_value: rsuValue,
        property_value: propertyValue,
        positions_count: positionData.length,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Portfolio snapshot error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─── GET: Retrieve historical snapshots for charting ──────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const limit = parseInt(searchParams.get('limit') || '90');

    const supabase = createServiceClient();

    let query = supabase
      .from('portfolio_snapshots')
      .select('id, date, total_equity, equity, cash, net_worth, pnl, cr3_value, rsu_value, property_value, created_at')
      .order('date', { ascending: true });

    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    query = query.limit(limit);

    const { data, error } = await query;

    if (error) {
      console.error('Supabase snapshot fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch snapshots', details: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      snapshots: data || [],
      count: data?.length || 0,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
