import { NextResponse } from 'next/server';
import { fetchLatestSnapshots } from '@/lib/prediction-markets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshots = await fetchLatestSnapshots();
  return NextResponse.json({ snapshots });
}
