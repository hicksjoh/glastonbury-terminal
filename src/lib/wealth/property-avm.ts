// F4 — Real estate AVM via ATTOM.
//
// Returns a market-value estimate for a residential address using the
// ATTOM Property API. If ATTOM_API_KEY is not configured we fall back
// to whatever value is recorded in wealth_assets for the address so the
// route never returns 500 — Wes can still see his recorded number.
//
// ATTOM endpoint: /propertyapi/v1.0.0/property/expandedprofile
// Auth: `apikey` request header. Free dev tier supports ~1500 calls/day.

import { createServiceClient } from '@/lib/supabase';

const ATTOM_BASE = 'https://api.gateway.attomdata.com/propertyapi/v1.0.0';

export interface AvmResult {
  source: 'attom' | 'wealth_assets' | 'unconfigured';
  address: string;
  estimatedValue: number | null;
  high: number | null;
  low: number | null;
  confidence: number | null;
  asOf: string | null;
  notes: string;
}

interface AttomAvmResponse {
  property?: Array<{
    avm?: {
      amount?: { value?: number; high?: number; low?: number };
      eventDate?: string;
      confidence?: number;
    };
    address?: { line1?: string; line2?: string };
  }>;
}

/**
 * Pulls the wealth_assets fallback for the named asset (e.g., "Miami
 * Shores Property"). Used when ATTOM is unconfigured or returns no AVM.
 */
async function fetchRecordedValue(name: string): Promise<number | null> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('wealth_assets')
      .select('current_value')
      .eq('asset_class', 'real_estate')
      .ilike('name', `%${name}%`)
      .limit(1)
      .maybeSingle();
    if (data && typeof (data as { current_value: number }).current_value === 'number') {
      return Number((data as { current_value: number }).current_value);
    }
  } catch { /* fall through */ }
  return null;
}

export async function fetchPropertyAvm(
  address1: string,
  address2: string,
  fallbackAssetName?: string,
): Promise<AvmResult> {
  const apiKey = process.env.ATTOM_API_KEY;

  if (!apiKey) {
    const recorded = fallbackAssetName ? await fetchRecordedValue(fallbackAssetName) : null;
    return {
      source: 'unconfigured',
      address: `${address1}, ${address2}`,
      estimatedValue: recorded,
      high: null,
      low: null,
      confidence: null,
      asOf: null,
      notes: 'ATTOM_API_KEY not set — showing recorded wealth_assets value. Add the key in Vercel env to unlock live AVM.',
    };
  }

  try {
    const params = new URLSearchParams({ address1, address2 });
    const res = await fetch(`${ATTOM_BASE}/property/expandedprofile?${params}`, {
      headers: { apikey: apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const recorded = fallbackAssetName ? await fetchRecordedValue(fallbackAssetName) : null;
      return {
        source: 'wealth_assets',
        address: `${address1}, ${address2}`,
        estimatedValue: recorded,
        high: null,
        low: null,
        confidence: null,
        asOf: null,
        notes: `ATTOM returned ${res.status} — falling back to recorded value.`,
      };
    }
    const data = (await res.json()) as AttomAvmResponse;
    const property = data.property?.[0];
    const avm = property?.avm;
    return {
      source: 'attom',
      address: `${property?.address?.line1 ?? address1}, ${property?.address?.line2 ?? address2}`,
      estimatedValue: avm?.amount?.value ?? null,
      high: avm?.amount?.high ?? null,
      low: avm?.amount?.low ?? null,
      confidence: typeof avm?.confidence === 'number' ? avm.confidence : null,
      asOf: avm?.eventDate ?? null,
      notes: 'Live ATTOM AVM',
    };
  } catch (err) {
    const recorded = fallbackAssetName ? await fetchRecordedValue(fallbackAssetName) : null;
    return {
      source: 'wealth_assets',
      address: `${address1}, ${address2}`,
      estimatedValue: recorded,
      high: null,
      low: null,
      confidence: null,
      asOf: null,
      notes: `ATTOM call failed (${err instanceof Error ? err.message : 'unknown'}) — falling back to recorded value.`,
    };
  }
}
