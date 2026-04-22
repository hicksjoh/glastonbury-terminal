// F14 — Cross-agent shared memory.
//
// A tiny Supabase-backed key/value store agents write to when they learn
// something worth remembering across turns. `agent_name = 'shared'` is the
// convention for entries ANY agent may read. Per-agent namespaces keep
// private state (e.g., Keisha's conversation scratch) out of other agents'
// context windows.
//
// Call sites:
//   - Keisha sets `shared:user_mood`, Apollo reads it before responding
//   - Apollo sets `shared:active_thesis`, the debate agent reads it
//   - Any agent sets `shared:open_decisions` → cron surfaces in weekly report
//
// Design notes:
//   - Intentionally minimal API surface — 5 functions, no ORM, no caching
//     layer. If this gets chatty we add an in-memory read cache later.
//   - All writes are upserts on (agent_name, key). To append rather than
//     replace, the caller reads the current value, merges, and writes back.
//   - Never throws on missing env vars — returns null/empty. The terminal
//     must not break because Supabase is unreachable.

import { createServiceClient } from './supabase';

export type AgentName = 'keisha' | 'apollo' | 'shared' | string;

export interface AgentMemoryRecord<T = unknown> {
  id: string;
  agent_name: AgentName;
  key: string;
  value: T;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export interface SetMemoryOptions {
  /** Optional TTL in ms. If set, `expires_at` = now + ttlMs. */
  ttlMs?: number;
  /** Free-form metadata attached to the row (source, confidence, etc.). */
  metadata?: Record<string, unknown>;
}

function isConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Upsert a memory entry for (agent, key). Replaces the existing value entirely.
 * Returns the written record, or null if Supabase is not configured / write fails.
 */
export async function setMemory<T>(
  agent: AgentName,
  key: string,
  value: T,
  options: SetMemoryOptions = {},
): Promise<AgentMemoryRecord<T> | null> {
  if (!isConfigured()) return null;
  const supabase = createServiceClient();
  const expires_at =
    options.ttlMs != null ? new Date(Date.now() + options.ttlMs).toISOString() : null;

  const { data, error } = await supabase
    .from('agent_memory')
    .upsert(
      {
        agent_name: agent,
        key,
        value: value as unknown,
        metadata: options.metadata ?? {},
        expires_at,
      },
      { onConflict: 'agent_name,key' },
    )
    .select()
    .single();

  if (error) {
    console.error('[agent-memory] setMemory failed:', error.message);
    return null;
  }
  return data as AgentMemoryRecord<T>;
}

/**
 * Read the current value for (agent, key). Returns null when missing or expired.
 * Callers who want "wasn't found vs expired" can use getRecord() instead.
 */
export async function getMemory<T>(
  agent: AgentName,
  key: string,
): Promise<T | null> {
  const rec = await getRecord<T>(agent, key);
  return rec?.value ?? null;
}

/**
 * Read the full memory record (metadata, timestamps) for (agent, key).
 */
export async function getRecord<T>(
  agent: AgentName,
  key: string,
): Promise<AgentMemoryRecord<T> | null> {
  if (!isConfigured()) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('agent_memory')
    .select('*')
    .eq('agent_name', agent)
    .eq('key', key)
    .maybeSingle();

  if (error || !data) return null;
  const rec = data as AgentMemoryRecord<T>;
  if (rec.expires_at && new Date(rec.expires_at) < new Date()) return null;
  return rec;
}

/**
 * Enumerate memory entries for an agent, newest-first. Skips expired rows.
 * Use agent = 'shared' to see everything in the shared scope.
 */
export async function listMemory(
  agent: AgentName,
  limit = 50,
): Promise<AgentMemoryRecord[]> {
  if (!isConfigured()) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('agent_memory')
    .select('*')
    .eq('agent_name', agent)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  const now = Date.now();
  return (data as AgentMemoryRecord[]).filter(
    r => !r.expires_at || new Date(r.expires_at).getTime() > now,
  );
}

/**
 * Delete a memory entry. Idempotent — returns true even when nothing was there.
 */
export async function deleteMemory(
  agent: AgentName,
  key: string,
): Promise<boolean> {
  if (!isConfigured()) return false;
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('agent_memory')
    .delete()
    .eq('agent_name', agent)
    .eq('key', key);
  if (error) {
    console.error('[agent-memory] deleteMemory failed:', error.message);
    return false;
  }
  return true;
}

/**
 * Delete all rows whose `expires_at` has passed. Intended for a weekly
 * cron or manual cleanup; safe to call anytime.
 */
export async function cleanExpired(): Promise<{ deleted: number }> {
  if (!isConfigured()) return { deleted: 0 };
  const supabase = createServiceClient();
  const { error, count } = await supabase
    .from('agent_memory')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date().toISOString());
  if (error) {
    console.error('[agent-memory] cleanExpired failed:', error.message);
    return { deleted: 0 };
  }
  return { deleted: count ?? 0 };
}

/**
 * Builds a compact "shared context" string agents can inject into their
 * system prompt so they see what other agents have noted. Caps total length
 * so it can safely live inside the cached system prompt without blowing
 * the cache breakpoint.
 */
export async function buildSharedContextBlock(maxChars = 2_000): Promise<string> {
  const entries = await listMemory('shared', 30);
  if (entries.length === 0) return '';

  const lines: string[] = [];
  let total = 0;
  for (const entry of entries) {
    const valueStr =
      typeof entry.value === 'string'
        ? entry.value
        : JSON.stringify(entry.value);
    const line = `- ${entry.key}: ${valueStr.slice(0, 200)}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length;
  }
  if (lines.length === 0) return '';
  return `\n\nSHARED AGENT MEMORY (most recent first):\n${lines.join('\n')}`;
}
