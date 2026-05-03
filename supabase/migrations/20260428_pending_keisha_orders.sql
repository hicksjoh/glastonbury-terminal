-- Server-side store for Keisha's pending dangerous-tool calls (place_order, etc.)
--
-- Why this exists:
--   Before this table, Keisha returned raw place_order params to the client and
--   the UI POST'd them straight back to /api/keisha/actions for execution. A
--   logged-in client could skip Keisha entirely and submit any order body. The
--   confirmation modal looked like a safety boundary but was client-trust.
--
-- How it's used:
--   1. When Keisha decides to call place_order, the agent persists the params
--      here and returns only an id to the UI.
--   2. The UI shows the confirmation modal sourced from the persisted record.
--   3. On confirm, the UI POSTs the id to /api/keisha/actions.
--   4. /api/keisha/actions atomically consumes the row (single UPDATE that only
--      succeeds if not yet consumed and not expired) and uses the STORED params
--      to submit the order — never the client-supplied params.
--
-- Hardening:
--   - 5-minute TTL prevents replay of stale confirmations.
--   - consumed_at is set in the same UPDATE that reads the row, so two clicks
--     can't double-submit.
--   - RLS enabled with no policies — only service role can read/write.

create table if not exists public.pending_keisha_orders (
  id uuid primary key default gen_random_uuid(),
  tool_name text not null,
  params jsonb not null,
  source_conversation_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz
);

create index if not exists pending_keisha_orders_active_idx
  on public.pending_keisha_orders (expires_at)
  where consumed_at is null;

alter table public.pending_keisha_orders enable row level security;

-- No policies. Anon and authenticated roles get no access; the service role
-- (used by /api/keisha/* server routes) bypasses RLS entirely.

comment on table public.pending_keisha_orders is
  'Server-side store for Keisha dangerous-tool confirmations (place_order, etc.). Single source of truth for what params the user actually approved.';
