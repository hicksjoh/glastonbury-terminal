import { NextResponse } from 'next/server';
import { getPositions } from '@/lib/alpaca';

// Live-data endpoint — never let Next static-optimize this at build time
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const positions = await getPositions();
    return NextResponse.json(positions);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
