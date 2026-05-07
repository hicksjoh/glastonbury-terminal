import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { rateLimit } from '@/lib/rate-limit';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';
import type { FilingStatus } from '@/lib/tax-engine';

// ═══════════════════════════════════════════════════════════════════════════
//  Tax Profile CRUD — GET (read/create default) + PUT (update)
// ═══════════════════════════════════════════════════════════════════════════

interface TaxProfile {
  id: string;
  filing_status: FilingStatus;
  projected_ordinary_income: number;
  ytd_tax_paid: number;
  state: string | null;
  section_475_elected: boolean;
  created_at: string;
  updated_at: string;
}

const DEFAULT_PROFILE: Omit<TaxProfile, 'id' | 'created_at' | 'updated_at'> = {
  filing_status: 'single',
  projected_ordinary_income: 0,
  ytd_tax_paid: 0,
  state: null,
  section_475_elected: false,
};

// ── GET: Return tax profile (create default if none exists) ─────────────

export async function GET(): Promise<NextResponse> {
  const rl = rateLimit('tax-profile-get', 30, 60000);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded' },
      { status: 429 },
    );
  }

  try {
    const supabase = createServiceClient();

    // Fetch the single tax profile (single-user app)
    const { data, error } = await supabase
      .from('tax_profiles')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[tax/profile] GET error:', error.message);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    // Profile exists — return it
    if (data) {
      return NextResponse.json({ success: true, data: data as TaxProfile });
    }

    // No profile yet — create default
    const { data: newProfile, error: insertErr } = await supabase
      .from('tax_profiles')
      .insert({
        filing_status: DEFAULT_PROFILE.filing_status,
        projected_ordinary_income: DEFAULT_PROFILE.projected_ordinary_income,
        ytd_tax_paid: DEFAULT_PROFILE.ytd_tax_paid,
        state: DEFAULT_PROFILE.state,
        section_475_elected: DEFAULT_PROFILE.section_475_elected,
      })
      .select()
      .single();

    if (insertErr) {
      console.error('[tax/profile] INSERT error:', insertErr.message);
      // If insert fails (e.g., table not yet created), return in-memory default
      return NextResponse.json({
        success: true,
        data: {
          ...DEFAULT_PROFILE,
          id: 'default',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        persisted: false,
      });
    }

    return NextResponse.json({
      success: true,
      data: newProfile as TaxProfile,
      created: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch tax profile';
    console.error('[tax/profile] Error:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── PUT: Update tax profile fields ──────────────────────────────────────

const VALID_FILING_STATUSES = ['single', 'mfj', 'mfs', 'hoh'];

export async function PUT(request: Request): Promise<NextResponse> {
  const { log, request_id } = loggerFor(request, { route: 'tax/profile' });
  const rl = rateLimit('tax-profile-put', 15, 60000);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded' },
      { status: 429 },
    );
  }

  try {
    const body = await request.json();

    // ── Validate & sanitize input ─────────────────────────────────────
    const updates: Record<string, unknown> = {};

    if (body.filing_status !== undefined) {
      if (!VALID_FILING_STATUSES.includes(body.filing_status)) {
        return NextResponse.json(
          { success: false, error: `Invalid filing_status. Must be one of: ${VALID_FILING_STATUSES.join(', ')}` },
          { status: 400 },
        );
      }
      updates.filing_status = body.filing_status;
    }

    if (body.projected_ordinary_income !== undefined) {
      const val = parseFloat(body.projected_ordinary_income);
      if (isNaN(val) || val < 0) {
        return NextResponse.json(
          { success: false, error: 'projected_ordinary_income must be a non-negative number' },
          { status: 400 },
        );
      }
      updates.projected_ordinary_income = val;
    }

    if (body.ytd_tax_paid !== undefined) {
      const val = parseFloat(body.ytd_tax_paid);
      if (isNaN(val) || val < 0) {
        return NextResponse.json(
          { success: false, error: 'ytd_tax_paid must be a non-negative number' },
          { status: 400 },
        );
      }
      updates.ytd_tax_paid = val;
    }

    if (body.state !== undefined) {
      updates.state = typeof body.state === 'string' ? body.state.trim() || null : null;
    }

    if (body.section_475_elected !== undefined) {
      updates.section_475_elected = Boolean(body.section_475_elected);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update. Supported: filing_status, projected_ordinary_income, ytd_tax_paid, state, section_475_elected' },
        { status: 400 },
      );
    }

    // Always stamp updated_at
    updates.updated_at = new Date().toISOString();

    const supabase = createServiceClient();

    // Find the existing profile
    const { data: existing } = await supabase
      .from('tax_profiles')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (!existing) {
      // No profile exists — create one with the provided values merged into defaults
      const { data: created, error: createErr } = await supabase
        .from('tax_profiles')
        .insert({
          ...DEFAULT_PROFILE,
          ...updates,
        })
        .select()
        .single();

      if (createErr) {
        console.error('[tax/profile] Upsert error:', createErr.message);
        return NextResponse.json(
          { success: false, error: createErr.message },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        data: created as TaxProfile,
        created: true,
      });
    }

    // Update the existing profile
    const { data: updated, error: updateErr } = await supabase
      .from('tax_profiles')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single();

    if (updateErr) {
      const eventId = captureRouteError(updateErr, { request_id, route: 'tax/profile/put' });
      log.error({ err: updateErr.message, sentry_event_id: eventId }, 'tax-profile update failed');
      // Codex finding (#14): don't echo raw Supabase error message to client.
      return NextResponse.json(
        { success: false, error: 'Failed to update tax profile', sentry_event_id: eventId },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: updated as TaxProfile,
    });
  } catch (err) {
    const eventId = captureRouteError(err, { request_id, route: 'tax/profile/put' });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'tax-profile threw');
    // Generic message — full detail in Sentry, indexable by eventId.
    return NextResponse.json(
      { success: false, error: 'Failed to update tax profile', sentry_event_id: eventId },
      { status: 500 },
    );
  }
}
