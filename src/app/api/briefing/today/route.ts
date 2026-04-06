import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const revalidate = 60; // cache for 60 seconds

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Get today's date in UTC (briefings generated in morning)
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

    const { data, error } = await supabase
      .from('briefings')
      .select('id, content, market_data_json, portfolio_data_json, created_at')
      .gte('created_at', startOfDay)
      .lt('created_at', endOfDay)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return NextResponse.json({ briefing: null, cached: false });
    }

    return NextResponse.json({
      briefing: data.content,
      cached: true,
      id: data.id,
      created_at: data.created_at,
      market_data: data.market_data_json,
      portfolio_data: data.portfolio_data_json,
    });
  } catch {
    return NextResponse.json({ briefing: null, cached: false });
  }
}
