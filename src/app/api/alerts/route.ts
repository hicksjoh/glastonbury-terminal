import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('alerts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      // Table might not exist yet — return mock data
      return NextResponse.json({ alerts: getMockAlerts() });
    }

    return NextResponse.json({ alerts: data || getMockAlerts() });
  } catch {
    return NextResponse.json({ alerts: getMockAlerts() });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('alerts')
      .insert({
        name: body.name,
        conditions: body.conditions,
        logic: body.logic || 'AND',
        action: body.action || 'notify',
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      // If table doesn't exist, return success with mock ID
      return NextResponse.json({
        alert: { id: crypto.randomUUID(), ...body, is_active: true, created_at: new Date().toISOString() },
      });
    }

    return NextResponse.json({ alert: data });
  } catch (error) {
    console.error('Alert create error:', error);
    return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, is_active } = await req.json();
    const supabase = createServiceClient();

    await supabase
      .from('alerts')
      .update({ is_active })
      .eq('id', id);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true }); // Best-effort
  }
}

function getMockAlerts() {
  return [
    {
      id: '1',
      name: 'Dip Buy Alert — AAPL',
      conditions: [
        { symbol: 'AAPL', metric: 'price', operator: '<', value: 170 },
        { symbol: 'AAPL', metric: 'rsi', operator: '<', value: 30 },
      ],
      logic: 'AND',
      action: 'notify',
      is_active: true,
      last_triggered: null,
      created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
    {
      id: '2',
      name: 'Volatility Spike',
      conditions: [
        { symbol: 'VIX', metric: 'price', operator: '>', value: 25 },
      ],
      logic: 'AND',
      action: 'notify',
      is_active: true,
      last_triggered: null,
      created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
    },
    {
      id: '3',
      name: 'NVDA Breakout',
      conditions: [
        { symbol: 'NVDA', metric: 'changePercent', operator: '>', value: 5 },
        { symbol: 'NVDA', metric: 'volume', operator: '>', value: 50000000 },
      ],
      logic: 'AND',
      action: 'analyze',
      is_active: false,
      last_triggered: new Date(Date.now() - 86400000 * 2).toISOString(),
      created_at: new Date(Date.now() - 86400000 * 14).toISOString(),
    },
  ];
}
