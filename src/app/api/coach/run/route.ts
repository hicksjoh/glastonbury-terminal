import { NextResponse } from 'next/server';
import { runCoachReview, persistCoachReview } from '@/lib/coach-engine';
import { checkRateLimitDurable } from '@/lib/rate-limit-durable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// On-demand "Run now" for the UI.
export async function POST() {
  // P0-6: Claude-burning route, 3 / 5 min durable.
  const { allowed } = await checkRateLimitDurable('coach-run', 'global', 3, 300);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  try {
    const result = await runCoachReview();
    const { weekOf, id } = await persistCoachReview('wes', result);
    return NextResponse.json({ week_of: weekOf, id, ...result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
