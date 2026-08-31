import { NextResponse } from 'next/server';
import { getAccount } from '@/lib/alpaca';

// Live-data endpoint — never let Next static-optimize this at build time
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const account = await getAccount();
    return NextResponse.json(account);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
