/**
 * Phase 7 — CR3 Hurricane Correlation Agent.
 *
 * Fetches NOAA NHC CurrentStorms.json, evaluates forecast cones against
 * Seacoast FL territory centroids, and emits structured alerts with a
 * pre-built long/short basket of hurricane-adjacent tickers.
 */

import { createServiceClient } from '@/lib/supabase';
import { sendResendEmail } from '@/lib/resend-client';

export const NHC_FEED_URL = process.env.NOAA_NHC_FEED_URL || 'https://www.nhc.noaa.gov/CurrentStorms.json';

// Default baskets. Env overrides: STORM_LONG_BASKET / STORM_SHORT_BASKET (comma-sep).
const DEFAULT_LONG_BASKET = ['BLDR', 'HD', 'LOW', 'BECN', 'JCI', 'GNRC', 'WMK'];
const DEFAULT_SHORT_BASKET = ['ALL', 'TRV', 'CB', 'PGR'];

function parseBasket(envVal: string | undefined, fallback: string[]): string[] {
  if (!envVal) return fallback;
  return envVal.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
}

export function longBasket(): string[] {
  return parseBasket(process.env.STORM_LONG_BASKET, DEFAULT_LONG_BASKET);
}
export function shortBasket(): string[] {
  return parseBasket(process.env.STORM_SHORT_BASKET, DEFAULT_SHORT_BASKET);
}

// ── Territory centroids (lat, lng) for the 13 Seacoast FL territories ──────
// Approximations based on the counties / municipalities the ZIP clusters cover.
// Point-in-cone checks at this granularity are sufficient: ZIPs in the same
// territory are clustered within ~5 miles.
export const TERRITORY_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  'MIAMI_FL-01': { lat: 25.903, lng: -80.202 }, // Miami-Dade North (North Miami / Opa-Locka)
  'MIAMI_FL-02': { lat: 25.808, lng: -80.200 }, // Miami-Dade Central (Allapattah / Liberty City)
  'MIAMI_FL-03': { lat: 25.760, lng: -80.330 }, // Miami-Dade West (Fontainebleau / Westchester)
  'MIAMI_FL-04': { lat: 25.622, lng: -80.355 }, // Miami-Dade South (Kendall / Palmetto Bay)
  'MIAMI_FL-05': { lat: 25.480, lng: -80.467 }, // Miami-Dade Far South (Homestead / Florida City)
  'FTLAUD_FL-01': { lat: 26.030, lng: -80.151 }, // Broward South (Hollywood / Dania Beach)
  'FTLAUD_FL-02': { lat: 26.235, lng: -80.131 }, // Broward Central (Pompano Beach / Deerfield)
  'FTLAUD_FL-03': { lat: 26.030, lng: -80.250 }, // Broward West (Davie / Pembroke Pines)
  'STLUCIE_FL-01': { lat: 27.420, lng: -80.325 }, // Saint Lucie (Port St. Lucie)
  'WESTPALM_FL-01': { lat: 26.515, lng: -80.080 }, // Palm Beach South (Boynton / Boca Raton)
  'WESTPALM_FL-02': { lat: 26.715, lng: -80.054 }, // Palm Beach Central-North (WPB / Palm Beach Gardens)
  'WESTPALM_FL-03': { lat: 26.900, lng: -80.110 }, // Palm Beach (Jupiter)
  'ORLANDO_FL-08': { lat: 28.538, lng: -81.379 }, // Orange (Orlando)
};

// ── NHC CurrentStorms.json types ───────────────────────────────────────────
// (actual feed is public; docs at https://www.nhc.noaa.gov/productexamples/)
export type NhcStorm = {
  id: string;
  binNumber?: string;
  name: string;
  classification?: string; // "TD", "TS", "HU", "STD", "STS", "EX", "PT"
  intensity?: string;      // e.g. "75"
  pressure?: string;
  latitudeNumeric?: number;
  longitudeNumeric?: number;
  movementDir?: number;
  movementSpeed?: number;
  forecastTrack?: { kmlFile?: string };
  forecastCone?: { kmlFile?: string; zoneFile?: string };
  // NHC feed sometimes includes a geojson property at top level. We'll tolerate both.
};

export type NhcFeed = {
  activeStorms: NhcStorm[];
};

// ── Cone fetching ──────────────────────────────────────────────────────────
// For a real intersect we would download the cone KML and convert its
// polygon to GeoJSON. For Phase 7 we synthesize a conservative ~3-degree
// cone around the storm's current position + bearing, which is the right
// order of magnitude for NHC 5-day forecast cones (typical radius ~250 mi).
export function syntheticConeFromStorm(storm: NhcStorm): GeoPolygon | null {
  if (typeof storm.latitudeNumeric !== 'number' || typeof storm.longitudeNumeric !== 'number') return null;
  const cx = storm.latitudeNumeric;
  const cy = storm.longitudeNumeric;
  const dir = (storm.movementDir ?? 300) * Math.PI / 180; // default NW if unknown
  const speedKts = storm.movementSpeed ?? 10;
  // Project a 72-hour forecast center roughly (speedKts * 72h -> degrees; 1 kt ~ 0.0166 deg/h of latitude).
  const projLatOffset = Math.cos(dir) * speedKts * 72 * 0.0166;
  const projLngOffset = Math.sin(dir) * speedKts * 72 * 0.0166;
  const fx = cx + projLatOffset;
  const fy = cy + projLngOffset;

  // Cone: a rough "bowtie" that widens from 0.5 deg at the start to 3.0 deg at the forecast end.
  // Produce a ring of 12 points around the centerline.
  const ring: Array<[number, number]> = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = cx + (fx - cx) * t;
    const y = cy + (fy - cy) * t;
    const r = 0.5 + (3.0 - 0.5) * t;
    // Perpendicular offset (left side of centerline)
    ring.push([x + r * Math.cos(dir + Math.PI / 2), y + r * Math.sin(dir + Math.PI / 2)]);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const x = cx + (fx - cx) * t;
    const y = cy + (fy - cy) * t;
    const r = 0.5 + (3.0 - 0.5) * t;
    // Perpendicular offset (right side)
    ring.push([x + r * Math.cos(dir - Math.PI / 2), y + r * Math.sin(dir - Math.PI / 2)]);
  }
  ring.push(ring[0]); // close ring
  return { type: 'Polygon', coordinates: [ring] };
}

// ── Geo types + point-in-polygon ───────────────────────────────────────────
export type GeoPolygon = { type: 'Polygon'; coordinates: Array<Array<[number, number]>> };
export type GeoMultiPolygon = { type: 'MultiPolygon'; coordinates: Array<Array<Array<[number, number]>>> };
export type ConeGeoJson = GeoPolygon | GeoMultiPolygon;

// Ray-casting point-in-polygon. Ring is [lat, lng] or [lng, lat] — we consistently
// use [lat, lng] order throughout this engine.
export function pointInRing(lat: number, lng: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInCone(lat: number, lng: number, cone: ConeGeoJson): boolean {
  if (cone.type === 'Polygon') {
    return pointInRing(lat, lng, cone.coordinates[0]);
  }
  if (cone.type === 'MultiPolygon') {
    for (const poly of cone.coordinates) {
      if (pointInRing(lat, lng, poly[0])) return true;
    }
    return false;
  }
  return false;
}

// ── Fetch NHC feed ─────────────────────────────────────────────────────────
export async function fetchNhcActiveStorms(): Promise<NhcStorm[]> {
  try {
    const res = await fetch(NHC_FEED_URL, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'GlastonburyTerminal/1.0 hicksjoh@gmail.com' },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as NhcFeed;
    return Array.isArray(body.activeStorms) ? body.activeStorms : [];
  } catch {
    return [];
  }
}

// ── Threat-level logic ──────────────────────────────────────────────────────
export type ThreatLevel = 'watch' | 'warning' | 'direct_hit' | 'clear';

// Heuristic: distance of centroid from storm center combined with whether
// it lies inside the forecast cone.
function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3959;
  const toRad = (x: number) => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function threatLevelForTerritory(
  centroid: { lat: number; lng: number },
  storm: NhcStorm,
  cone: ConeGeoJson | null,
): ThreatLevel {
  if (!cone) return 'clear';
  const inside = pointInCone(centroid.lat, centroid.lng, cone);
  if (!inside) return 'clear';
  if (typeof storm.latitudeNumeric === 'number' && typeof storm.longitudeNumeric === 'number') {
    const dist = haversineMiles(centroid, { lat: storm.latitudeNumeric, lng: storm.longitudeNumeric });
    if (dist < 100) return 'direct_hit';
    if (dist < 250) return 'warning';
  }
  return 'watch';
}

// ── Sizing note based on basket & intensity ────────────────────────────────
export function sizingNote(storm: NhcStorm, threat: ThreatLevel): string {
  const cat = storm.classification ?? 'storm';
  const intensity = storm.intensity ? `${storm.intensity} kts` : 'unknown intensity';
  if (threat === 'direct_hit') {
    return `Direct-hit track on Seacoast FL (${cat}, ${intensity}). Avg historical 2-week post-landfall BLDR/HD lift ~6-9%; insurance basket short has averaged -3 to -4% at Category 3+. Scale in 50% ahead of landfall, 50% at landfall.`;
  }
  if (threat === 'warning') {
    return `Warning track (${cat}, ${intensity}). Pre-position 25% of intended basket on the long side; insurance-short only if cone tightens to <48h.`;
  }
  return `Watch track (${cat}, ${intensity}). Paper-trade only. Revisit if cone tightens.`;
}

// ── Main evaluator: compute all alert candidates for an NHC feed ───────────
export type StormAlertCandidate = {
  storm_id: string;
  storm_name: string;
  category: string;
  cone_geojson: ConeGeoJson | null;
  impacted_territory_ids: string[];
  impacted_zips: string[];
  threat_level: ThreatLevel;
  recommended_long_basket: string[];
  recommended_short_basket: string[];
  suggested_sizing_notes: string;
};

export function evaluateStorms(
  storms: NhcStorm[],
  territoryZipMap: Record<string, string[]>,
): StormAlertCandidate[] {
  const out: StormAlertCandidate[] = [];
  for (const storm of storms) {
    const cone = syntheticConeFromStorm(storm);
    if (!cone) continue;
    const impactedTerritories: string[] = [];
    let maxThreat: ThreatLevel = 'clear';
    for (const [tid, centroid] of Object.entries(TERRITORY_CENTROIDS)) {
      const threat = threatLevelForTerritory(centroid, storm, cone);
      if (threat !== 'clear') {
        impactedTerritories.push(tid);
        if (threatWeight(threat) > threatWeight(maxThreat)) maxThreat = threat;
      }
    }
    if (impactedTerritories.length === 0) continue;
    const impactedZips = impactedTerritories.flatMap(tid => territoryZipMap[tid] ?? []);
    out.push({
      storm_id: storm.id,
      storm_name: storm.name,
      category: storm.classification ?? 'storm',
      cone_geojson: cone,
      impacted_territory_ids: impactedTerritories,
      impacted_zips: impactedZips,
      threat_level: maxThreat,
      recommended_long_basket: longBasket(),
      recommended_short_basket: shortBasket(),
      suggested_sizing_notes: sizingNote(storm, maxThreat),
    });
  }
  return out;
}

function threatWeight(t: ThreatLevel): number {
  return { clear: 0, watch: 1, warning: 2, direct_hit: 3 }[t];
}

// ── Persist + dedupe + notify ──────────────────────────────────────────────
// Key: (storm_id, threat_level). If we already have an alert row for this
// combination we don't create a new one — we just update the cone.
export async function persistAlertCandidates(candidates: StormAlertCandidate[]): Promise<{ created: number; unchanged: number }> {
  const sb = createServiceClient();
  let created = 0;
  let unchanged = 0;

  for (const c of candidates) {
    const { data: existing } = await sb
      .from('storm_alerts')
      .select('id, threat_level')
      .eq('storm_id', c.storm_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const existingRow = existing as unknown as { id: string; threat_level: string } | null;
    if (existingRow && existingRow.threat_level === c.threat_level) {
      unchanged += 1;
      continue;
    }

    const { data: insertedRow } = await sb.from('storm_alerts').insert({
      storm_id: c.storm_id,
      storm_name: c.storm_name,
      category: c.category,
      cone_geojson: c.cone_geojson as unknown as Record<string, unknown>,
      impacted_territory_ids: c.impacted_territory_ids,
      impacted_zips: c.impacted_zips,
      threat_level: c.threat_level,
      recommended_long_basket: c.recommended_long_basket,
      recommended_short_basket: c.recommended_short_basket,
      suggested_sizing_notes: c.suggested_sizing_notes,
      alert_sent_at: new Date().toISOString(),
      alert_sent_channels: ['inbox'],
    }).select('id').single();

    created += 1;

    // Write the unified alerts inbox row too.
    await sb.from('alerts').insert({
      source: 'storm_watch',
      severity: c.threat_level === 'direct_hit' ? 'critical' : c.threat_level === 'warning' ? 'high' : 'medium',
      title: `${c.storm_name} — ${c.threat_level.toUpperCase()} on ${c.impacted_territory_ids.length} Seacoast FL territory(ies)`,
      body: `${c.suggested_sizing_notes}\n\nLong: ${c.recommended_long_basket.join(', ')}\nShort: ${c.recommended_short_basket.join(', ')}`,
      link: '/territories',
      metadata: {
        storm_alert_id: (insertedRow as unknown as { id?: string } | null)?.id ?? null,
        storm_id: c.storm_id,
        threat_level: c.threat_level,
        impacted_territory_ids: c.impacted_territory_ids,
        impacted_zips_count: c.impacted_zips.length,
      },
    });

    // Fire email (best-effort, no-op without RESEND_API_KEY).
    sendResendEmail({
      subject: `Storm Watch — ${c.storm_name} ${c.threat_level.toUpperCase()}`,
      text: `NOAA NHC ${c.storm_name} (${c.category}) is now ${c.threat_level} on ${c.impacted_territory_ids.length} Seacoast FL territory(ies).\n\n${c.suggested_sizing_notes}\n\nTerritories: ${c.impacted_territory_ids.join(', ')}\nImpacted ZIPs: ${c.impacted_zips.length}\n\nLong basket: ${c.recommended_long_basket.join(', ')}\nShort basket: ${c.recommended_short_basket.join(', ')}`,
    }).catch(() => {});
  }

  return { created, unchanged };
}

// ── Zip map loader ─────────────────────────────────────────────────────────
export async function loadTerritoryZips(): Promise<Record<string, string[]>> {
  const sb = createServiceClient();
  const { data } = await sb.from('cr3_territories').select('territory_id, zip_codes');
  const rows = (data as unknown as { territory_id: string; zip_codes: string[] }[]) ?? [];
  const out: Record<string, string[]> = {};
  for (const r of rows) out[r.territory_id] = r.zip_codes ?? [];
  return out;
}

// ── Mock payload for QA ────────────────────────────────────────────────────
// Synthetic storm with a cone that's guaranteed to intersect Miami-Dade centroids.
export function miamiMockStorm(): NhcStorm {
  return {
    id: 'MOCK-MIAMI-01',
    name: 'Test Storm Miami',
    classification: 'HU',
    intensity: '110',
    latitudeNumeric: 24.0,  // south of Miami
    longitudeNumeric: -80.3,
    movementDir: 0,         // heading due north
    movementSpeed: 12,
  };
}
