import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user') ?? 'wes';
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('coach_reviews')
    .select('*')
    .eq('user_id', userId)
    .order('week_of', { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message, reviews: [] }, { status: 500 });
  return NextResponse.json({ reviews: data ?? [] });
}
