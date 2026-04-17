import { NextResponse } from 'next/server';
import { runCoachReview, persistCoachReview } from '@/lib/coach-engine';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// On-demand "Run now" for the UI.
export async function POST() {
  const { allowed } = rateLimit('coach-run', 3, 300_000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  try {
    const result = await runCoachReview();
    const { weekOf, id } = await persistCoachReview('wes', result);
    return NextResponse.json({ week_of: weekOf, id, ...result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
