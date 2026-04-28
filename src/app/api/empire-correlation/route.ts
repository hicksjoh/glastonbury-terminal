import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { loadWealthSnapshot } from '@/lib/hedge/rsu-analyzer';
import { getCached, setCache } from '@/lib/server-cache';

// F3 — Empire ⇄ Markets correlation view.
//
// Aggregates Wes's CR3 franchise footprint, market regime, active storm
// alerts, and net-worth snapshot into one payload so the dashboard can
// render the relationship between the operating business and the public
// markets at a glance.
//
// Until cr3_revenue is migrated this route surfaces *exposure* metrics
// (territory count by region/AR, storm-impacted count) rather than
// quarterly P&L. When revenue lands, plug in a `recentRevenue` block.

const CACHE_TTL_MS = 10 * 60 * 1000;

interface TerritoryRow {
  id: string;
  territory_id: string | null;
  region: string | null;
  county: string | null;
  ar_type: string | null;
}

interface RegimeRow {
  regime: string;
  confidence: number;
  vix: number | null;
  momentum_factor: number | null;
  detected_at: string;
}

interface StormAlertRow {
  storm_id: string;
  storm_name: string;
  threat_level: string;
  impacted_territory_ids: string[] | null;
  created_at: string;
}

export async function GET() {
  const cacheKey = 'empire-correlation:v1';
  const cached = getCached<unknown>(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const supabase = createServiceClient();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [territoriesRes, regimeRes, regimeHistRes, stormAlertsRes, wealth] = await Promise.all([
      supabase
        .from('cr3_territories')
        .select('id, territory_id, region, county, ar_type'),
      supabase
        .from('market_regime')
        .select('regime, confidence, vix, momentum_factor, detected_at')
        .order('detected_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('market_regime')
        .select('regime, confidence, vix, momentum_factor, detected_at')
        .order('detected_at', { ascending: false })
        .limit(20),
      supabase
        .from('storm_alerts')
        .select('storm_id, storm_name, threat_level, impacted_territory_ids, created_at')
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false }),
      loadWealthSnapshot(),
    ]);

    const territories = (territoriesRes.data as TerritoryRow[] | null) ?? [];
    const currentRegime = (regimeRes.data as RegimeRow | null) ?? null;
    const regimeHistory = (regimeHistRes.data as RegimeRow[] | null) ?? [];
    const stormAlerts = (stormAlertsRes.data as StormAlertRow[] | null) ?? [];

    // ─── Territory rollup ───────────────────────────────────────────
    const byRegion: Record<string, number> = {};
    const byArType: Record<string, number> = {};
    for (const t of territories) {
      if (t.region) byRegion[t.region] = (byRegion[t.region] ?? 0) + 1;
      if (t.ar_type) byArType[t.ar_type] = (byArType[t.ar_type] ?? 0) + 1;
    }

    // ─── Storm exposure ─────────────────────────────────────────────
    const impactedSet = new Set<string>();
    for (const a of stormAlerts) {
      for (const id of a.impacted_territory_ids ?? []) impactedSet.add(id);
    }
    const stormExposurePct =
      territories.length > 0 ? (impactedSet.size / territories.length) * 100 : 0;

    // ─── Empire-vs-public correlation hint ──────────────────────────
    // Roofing/exteriors franchise demand has historic counter-cyclical and
    // weather-driven components. We surface the qualitative observation
    // alongside the live numbers so Keisha (or the dashboard) can cite it
    // without re-reasoning every time.
    let correlationNote = '';
    if (currentRegime && currentRegime.vix !== null) {
      if (currentRegime.vix >= 25) {
        correlationNote = 'Elevated VIX historically pulls discretionary remodel forward (insurance-claim work), but financing-sensitive jobs slow. Net effect on CR3 mid-cycle: mixed-positive.';
      } else if (currentRegime.vix < 15) {
        correlationNote = 'Low-vol regime → consumer confidence high, jobs pipeline expands, financing-sensitive remodels accelerate.';
      } else {
        correlationNote = 'Mid-vol regime → typical seasonal demand pattern; storm exposure dominates short-term variance.';
      }
    }

    const payload = {
      territoryFootprint: {
        total: territories.length,
        byRegion,
        byArType,
      },
      regime: {
        current: currentRegime,
        recent: regimeHistory,
      },
      stormExposure: {
        activeAlerts: stormAlerts.length,
        impactedTerritories: impactedSet.size,
        impactedTerritoryIds: Array.from(impactedSet),
        exposurePct: Math.round(stormExposurePct * 10) / 10,
        recentAlerts: stormAlerts.slice(0, 5).map(a => ({
          stormId: a.storm_id,
          stormName: a.storm_name,
          threatLevel: a.threat_level,
          impactedCount: a.impacted_territory_ids?.length ?? 0,
          at: a.created_at,
        })),
      },
      wealth,
      correlationNote,
      generatedAt: new Date().toISOString(),
    };

    setCache(cacheKey, payload, CACHE_TTL_MS);
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}
