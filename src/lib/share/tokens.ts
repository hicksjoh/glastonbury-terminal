// F17 — Tokenized public read-only dashboards.
//
// Tokens are URL-safe random IDs (32 hex chars) that map to a single view
// type with optional expiry + frozen snapshot. The auth model: anyone with
// the token can hit /api/share/<token>, nothing else. The token itself
// cannot be used as gt-auth.

import { randomBytes, timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase';

export type ShareViewType = 'net_worth' | 'wealth_summary';

export interface ShareToken {
  id: string;
  token: string;
  viewType: ShareViewType;
  label: string | null;
  snapshot: unknown;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
}

interface ShareTokenRow {
  id: string;
  token: string;
  view_type: ShareViewType;
  label: string | null;
  snapshot: unknown;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
}

function rowToToken(row: ShareTokenRow): ShareToken {
  return {
    id: row.id,
    token: row.token,
    viewType: row.view_type,
    label: row.label,
    snapshot: row.snapshot,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    viewCount: row.view_count,
    lastViewedAt: row.last_viewed_at,
  };
}

export function generateTokenString(): string {
  return randomBytes(16).toString('hex');
}

/** Constant-time compare so token brute-force isn't faster on a near-miss. */
export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface CreateShareInput {
  viewType: ShareViewType;
  label?: string;
  /** Hours until the token expires. Default 168 (7 days). */
  ttlHours?: number;
  /** Optional frozen snapshot; if null the view re-computes on each fetch. */
  snapshot?: unknown;
}

export async function createShareToken(input: CreateShareInput): Promise<ShareToken | null> {
  const token = generateTokenString();
  const supabase = createServiceClient();
  const ttlHours = input.ttlHours ?? 168;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('share_tokens')
    .insert({
      token,
      view_type: input.viewType,
      label: input.label ?? null,
      snapshot: input.snapshot ?? null,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error || !data) return null;
  return rowToToken(data as unknown as ShareTokenRow);
}

/**
 * Fetch + validate. Returns null if the token doesn't exist, was revoked,
 * or has expired. Increments view_count + last_viewed_at on each hit so
 * Wes can see whether his shared link is being used.
 */
export async function consumeShareToken(token: string): Promise<ShareToken | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const supabase = createServiceClient();

  const { data: row, error } = await supabase
    .from('share_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (error || !row) return null;

  const t = rowToToken(row as unknown as ShareTokenRow);
  if (t.revokedAt) return null;
  if (t.expiresAt && new Date(t.expiresAt) < new Date()) return null;

  // Best-effort view-count update; failure here is non-fatal.
  try {
    await supabase
      .from('share_tokens')
      .update({
        view_count: t.viewCount + 1,
        last_viewed_at: new Date().toISOString(),
      })
      .eq('id', t.id);
  } catch { /* ignore */ }

  return t;
}

export async function revokeShareToken(token: string): Promise<boolean> {
  if (!/^[a-f0-9]{32}$/.test(token)) return false;
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('share_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token', token);
  return !error;
}

export async function listActiveShareTokens(limit = 20): Promise<ShareToken[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('share_tokens')
    .select('*')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data as unknown as ShareTokenRow[] | null) ?? []).map(rowToToken);
}
