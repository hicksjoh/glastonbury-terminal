// F9 — Trade & shipping alt-data via FRED (free).
//
// Original F9 scope was satellite/AIS. Commercial satellite parking-lot
// data (Orbital Insight, RS Metrics) is paid, and MarineTraffic AIS free
// tier is rate-limited to the point of uselessness. Pivoting to FRED's
// trade and shipping-economics series, which are free, daily/monthly
// refreshed, and carry genuine recession/demand signal.
//
// All calls use the existing FRED_API_KEY from .env.local (already
// configured and rate-limited via src/lib/api-client.ts).

const FRED_BASE = 'https://api.stlouisfed.org/fred';

export interface FredObservation {
  date: string;
  value: number | null;
}

export interface FredSeries {
  seriesId: string;
  label: string;
  units: string;
  observations: FredObservation[];
  latest: FredObservation | null;
  /** % change versus the observation one position prior in the returned list. */
  changePct: number | null;
}

const SERIES_CATALOG: Array<{ id: string; label: string; units: string }> = [
  { id: 'RAILFRTINTERMODAL', label: 'Rail freight — intermodal (containers/trailers)', units: 'units' },
  { id: 'TRUCKD11', label: 'Truck tonnage index', units: 'index 2015=100' },
  { id: 'DCOILWTICO', label: 'WTI crude oil spot (shipping fuel proxy)', units: 'USD / bbl' },
  { id: 'IMPGS', label: 'US imports of goods & services', units: 'USD billions' },
  { id: 'EXPGS', label: 'US exports of goods & services', units: 'USD billions' },
  { id: 'IPMAN', label: 'Industrial production — manufacturing', units: 'index 2017=100' },
];

async function fetchFredSeries(
  seriesId: string,
  limit: number,
): Promise<FredObservation[]> {
  const key = process.env.FRED_API_KEY;
  if (!key) return [];
  const url =
    `${FRED_BASE}/series/observations?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${key}&file_type=json&limit=${limit}&sort_order=desc`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const data = await res.json();
    const raw = (data?.observations ?? []) as Array<{ date: string; value: string }>;
    return raw.map(o => ({
      date: o.date,
      value: o.value === '.' ? null : Number(o.value),
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch all configured trade/shipping series in parallel and return them
 * with latest + period-over-period % change annotations.
 */
export async function fetchTradeIndicators(obsPerSeries = 12): Promise<FredSeries[]> {
  const results = await Promise.all(
    SERIES_CATALOG.map(async (cfg) => {
      const obs = await fetchFredSeries(cfg.id, obsPerSeries);
      const latest = obs[0] ?? null;
      const prior = obs[1] ?? null;
      let changePct: number | null = null;
      if (latest?.value != null && prior?.value != null && prior.value !== 0) {
        changePct = ((latest.value - prior.value) / prior.value) * 100;
        changePct = Math.round(changePct * 100) / 100;
      }
      return {
        seriesId: cfg.id,
        label: cfg.label,
        units: cfg.units,
        observations: obs,
        latest,
        changePct,
      } as FredSeries;
    }),
  );
  return results;
}
