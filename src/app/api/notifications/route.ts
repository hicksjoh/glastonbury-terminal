import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

// Live-data endpoint — never let Next static-optimize this at build time
export const dynamic = 'force-dynamic';

async function GET_impl() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('Notifications API error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch notifications' }, { status: 500 });
  }
}

async function PATCH_impl(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await req.json();

    if (body.all) {
      await supabase.from('notifications').update({ read: true }).eq('read', false);
    } else if (body.id) {
      await supabase.from('notifications').update({ read: body.read }).eq('id', body.id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Notification update error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update notifications' }, { status: 500 });
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('notifications', RATE.WRITE, GET_impl);
export const PATCH = withRateLimit('notifications', RATE.WRITE, PATCH_impl);
