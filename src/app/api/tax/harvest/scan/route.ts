import { NextResponse } from 'next/server';
import { runTaxHarvestScan, persistSuggestions } from '@/lib/tax-harvest-engine';
import { checkRateLimitDurable } from '@/lib/rate-limit-durable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/tax/harvest/scan — on-demand scan (UI button).
export async function POST() {
  // P0-6: tax-harvest scan ⇒ Claude tax engine, durable global cap 4/5min.
  const { allowed } = await checkRateLimitDurable('tax-harvest-scan', 'global', 4, 300);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const suggestions = await runTaxHarvestScan();
    const { inserted, week_of } = await persistSuggestions('wes', suggestions);
    return NextResponse.json({ suggestions_found: suggestions.length, inserted, week_of });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
