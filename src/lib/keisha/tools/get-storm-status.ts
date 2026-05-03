import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { createServiceClient } from '@/lib/supabase';

const inputSchema = z.object({});

export const getStormStatus: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_storm_status',
  description: 'Get the current CR3 Storm Watch — active NOAA NHC alerts within 48 hours, threat levels per Seacoast FL territory, and the recommended long/short hurricane basket. Use when Wes asks about storms, hurricanes, weather risk, or Florida franchise exposure.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_storm_status',
    description: 'Get the current CR3 Storm Watch — active NOAA NHC alerts within 48 hours, threat levels per Seacoast FL territory, and the recommended long/short hurricane basket. Use when Wes asks about storms, hurricanes, weather risk, or Florida franchise exposure.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  }),
  async execute(_input) {
    const sb = createServiceClient();
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const [{ data: alerts }, { data: territories }] = await Promise.all([
      sb.from('storm_alerts').select('storm_id, storm_name, category, threat_level, impacted_territory_ids, impacted_zips, recommended_long_basket, recommended_short_basket, suggested_sizing_notes, created_at')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(10),
      sb.from('cr3_territories').select('territory_id, county, zip_codes').eq('ar_type', 'Seacoast FL'),
    ]);
    const alertsArr = (alerts as unknown as Array<{ threat_level: string; impacted_territory_ids: string[] }>) ?? [];
    const active = alertsArr.filter(a => a.threat_level !== 'clear');
    return {
      result: {
        active_alert_count: active.length,
        highest_threat: active.length ? active.reduce((acc, a) => ({ clear: 0, watch: 1, warning: 2, direct_hit: 3 } as Record<string, number>)[a.threat_level] > ({ clear: 0, watch: 1, warning: 2, direct_hit: 3 } as Record<string, number>)[acc.threat_level] ? a : acc).threat_level : 'clear',
        alerts: alertsArr.slice(0, 5),
        territory_count: (territories as unknown as unknown[])?.length ?? 0,
        link: '/territories',
      },
      success: true,
    };
  },
};
