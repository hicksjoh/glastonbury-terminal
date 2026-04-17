import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/storm/status — returns most recent storm_alert rows + territory threat map
export async function GET() {
  const sb = createServiceClient();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [alertsRes, territoriesRes] = await Promise.all([
    sb.from('storm_alerts')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20),
    sb.from('cr3_territories')
      .select('territory_id, region, county, zip_codes')
      .eq('ar_type', 'Seacoast FL'),
  ]);

  const alerts = (alertsRes.data as unknown as Array<{
    id: string;
    storm_id: string;
    storm_name: string;
    category: string | null;
    threat_level: 'watch' | 'warning' | 'direct_hit' | 'clear';
    impacted_territory_ids: string[];
    impacted_zips: string[];
    recommended_long_basket: string[];
    recommended_short_basket: string[];
    suggested_sizing_notes: string | null;
    created_at: string;
  }>) ?? [];

  // Per-territory highest threat over all recent alerts.
  const territoryThreat: Record<string, 'clear' | 'watch' | 'warning' | 'direct_hit'> = {};
  const weight = { clear: 0, watch: 1, warning: 2, direct_hit: 3 } as const;
  for (const a of alerts) {
    // Only consider alerts from the last 48h as "active" for heatmap display
    const ageMs = Date.now() - new Date(a.created_at).getTime();
    if (ageMs > 48 * 60 * 60 * 1000) continue;
    for (const tid of a.impacted_territory_ids) {
      const cur = territoryThreat[tid] ?? 'clear';
      if (weight[a.threat_level] > weight[cur]) territoryThreat[tid] = a.threat_level;
    }
  }

  return NextResponse.json({
    alerts,
    territoryThreat,
    territories: territoriesRes.data ?? [],
  });
}
