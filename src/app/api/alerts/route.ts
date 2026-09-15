import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

// Live-data endpoint — never let Next static-optimize this at build time
export const dynamic = 'force-dynamic';

async function GET_impl() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('alerts')
      .select('*')
      .order('created_at', { ascending: false });

    // A database failure used to return three hardcoded demo alerts (AAPL
    // $170, VIX 25, NVDA +5%) with no badge, so an outage looked exactly like
    // a working alert list. Report the outage instead — an alert the user
    // believes is armed but which does not exist is worse than no list.
    if (error) {
      return NextResponse.json(
        { alerts: [], unavailable: true, error: 'Alert store unavailable' },
        { status: 503 },
      );
    }

    // Rows created before the conditions column was required can have null here
    const alerts = (data || []).map((a: Record<string, unknown>) => ({ ...a, conditions: a.conditions ?? [] }));
    return NextResponse.json({ alerts, unavailable: false });
  } catch {
    return NextResponse.json(
      { alerts: [], unavailable: true, error: 'Alert store unavailable' },
      { status: 503 },
    );
  }
}

async function POST_impl(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('alerts')
      .insert({
        name: body.name,
        conditions: body.conditions,
        logic: body.logic || 'AND',
        action: body.action || 'notify',
        is_active: true,
      })
      .select()
      .single();

    // This used to mint a client-side UUID and hand back an `is_active: true`
    // alert whenever the insert failed — the UI showed an armed alert that had
    // never been persisted and could never fire.
    if (error) {
      console.error('Alert create failed:', error);
      return NextResponse.json(
        { error: 'Failed to save alert', details: error.message },
        { status: 503 },
      );
    }

    return NextResponse.json({ alert: data }, { status: 201 });
  } catch (error) {
    console.error('Alert create error:', error);
    return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 });
  }
}

async function PATCH_impl(req: NextRequest) {
  try {
    const { id, is_active } = await req.json();
    const supabase = createServiceClient();

    // The result's `error` was previously discarded and the catch returned
    // `{ success: true }` regardless, so disabling a live alert could appear to
    // work while the row stayed active and kept firing.
    const { data: updated, error } = await supabase
      .from('alerts')
      .update({ is_active })
      .eq('id', id)
      .select('id');

    if (error) {
      console.error('Alert toggle failed:', error);
      return NextResponse.json(
        { error: 'Failed to update alert', details: error.message },
        { status: 503 },
      );
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Alert toggle threw:', err);
    return NextResponse.json({ error: 'Failed to update alert' }, { status: 503 });
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('alerts', RATE.WRITE, GET_impl);
export const POST = withRateLimit('alerts', RATE.WRITE, POST_impl);
export const PATCH = withRateLimit('alerts', RATE.WRITE, PATCH_impl);
