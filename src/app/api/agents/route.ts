import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const agent = req.nextUrl.searchParams.get('agent');
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '20');

    let query = supabase.from('agent_actions').select('*').order('created_at', { ascending: false }).limit(limit);
    if (agent) query = query.eq('agent', agent);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('Agents API error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch agent actions' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await req.json();

    const { data, error } = await supabase.from('agent_actions').insert(body).select().single();
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Agent action create error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create agent action' }, { status: 500 });
  }
}
