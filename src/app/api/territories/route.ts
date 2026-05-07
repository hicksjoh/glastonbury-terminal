import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

export async function GET(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'territories' });
  try {
    const supabase = createServiceClient();
    const filter = req.nextUrl.searchParams.get('filter'); // seacoast, westcoast, operate, sell, hybrid
    const id = req.nextUrl.searchParams.get('id');

    if (id) {
      const { data, error } = await supabase
        .from('territories')
        .select('*')
        .eq('territory_id', id)
        .single();
      if (error) return NextResponse.json({ success: false, error: error.message }, { status: 404 });
      return NextResponse.json({ success: true, data });
    }

    let query = supabase.from('territories').select('*').order('territory_id');

    if (filter === 'seacoast' || filter === 'westcoast') {
      query = query.eq('ar_agreement', filter);
    } else if (filter === 'operate' || filter === 'sell' || filter === 'hybrid') {
      query = query.eq('strategy', filter);
    }

    const { data, error } = await query;
    if (error) throw error;

    const territories = data || [];
    const summary = {
      total: territories.length,
      by_agreement: {
        seacoast: territories.filter(t => t.ar_agreement === 'seacoast').length,
        westcoast: territories.filter(t => t.ar_agreement === 'westcoast').length,
      },
      by_strategy: {
        operate: territories.filter(t => t.strategy === 'operate').length,
        sell: territories.filter(t => t.strategy === 'sell').length,
        hybrid: territories.filter(t => t.strategy === 'hybrid').length,
      },
      by_status: {
        active: territories.filter(t => t.status === 'active').length,
        developing: territories.filter(t => t.status === 'developing').length,
        sold: territories.filter(t => t.status === 'sold').length,
      },
      total_fees_paid: territories.reduce((sum, t) => sum + Number(t.fees_paid || 0), 0),
      total_royalties: territories.reduce((sum, t) => sum + Number(t.royalties_earned || 0), 0),
    };

    return NextResponse.json({ success: true, data: { territories, summary } });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'territories/get' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'territories GET failed');
    return NextResponse.json({ success: false, error: 'Failed to fetch territories' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'territories' });
  try {
    const supabase = createServiceClient();
    const body = await req.json();
    const { territory_id, ...updates } = body;

    if (!territory_id) {
      return NextResponse.json({ success: false, error: 'territory_id required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('territories')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('territory_id', territory_id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'territories/put' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'territories PUT failed');
    return NextResponse.json({ success: false, error: 'Failed to update territory' }, { status: 500 });
  }
}
