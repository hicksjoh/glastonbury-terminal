// Server-side store for Keisha's pending dangerous-tool calls.
//
// Backed by `public.pending_keisha_orders`. See the migration for design
// notes. Only callable from server routes — needs the service-role Supabase
// client because RLS blocks anon/authenticated access.

import type { SupabaseClient } from '@supabase/supabase-js';

export const PENDING_ORDER_TTL_SECONDS = 300;

export interface PendingOrderHandle {
  id: string;
  expiresAt: string;
}

export async function createPendingOrder(
  supabase: SupabaseClient,
  args: {
    toolName: string;
    params: Record<string, unknown>;
    conversationId?: string | null;
    ttlSeconds?: number;
  },
): Promise<PendingOrderHandle> {
  const ttl = args.ttlSeconds ?? PENDING_ORDER_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const { data, error } = await supabase
    .from('pending_keisha_orders')
    .insert({
      tool_name: args.toolName,
      params: args.params,
      expires_at: expiresAt,
      source_conversation_id: args.conversationId ?? null,
    })
    .select('id, expires_at')
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to persist pending order: ${error?.message ?? 'unknown'}`,
    );
  }
  return { id: data.id as string, expiresAt: data.expires_at as string };
}

export interface ConsumedPendingOrder {
  toolName: string;
  params: Record<string, unknown>;
}

/**
 * Atomically consume a pending order. The UPDATE is conditional on
 * (consumed_at IS NULL AND expires_at > now()), so concurrent clicks or
 * replay attempts return the "not found / expired / already used" error.
 *
 * Throws on any of: id missing, already consumed, expired, or DB error.
 */
export async function consumePendingOrder(
  supabase: SupabaseClient,
  id: string,
): Promise<ConsumedPendingOrder> {
  if (!id || typeof id !== 'string') {
    throw new Error('Pending order id missing');
  }
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('pending_keisha_orders')
    .update({ consumed_at: now })
    .eq('id', id)
    .is('consumed_at', null)
    .gt('expires_at', now)
    .select('tool_name, params')
    .single();

  if (error || !data) {
    throw new Error('Pending order not found, expired, or already used');
  }
  return {
    toolName: data.tool_name as string,
    params: (data.params ?? {}) as Record<string, unknown>,
  };
}
