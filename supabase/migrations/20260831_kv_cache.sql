-- Durable key-value cache for cross-instance state on Vercel serverless.
-- In-memory server-cache is per-lambda: a cron that regenerates the market
-- narrative writes into its own instance's RAM and the dashboard never sees
-- it. This table is the shared store; service-role only (RLS on, no policies).

create table if not exists kv_cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table kv_cache enable row level security;

-- Atomic lock: succeeds when the key is absent or its lease expired.
-- Returns true when this caller acquired the lease, null/false otherwise.
create or replace function kv_try_lock(lock_key text, ttl_ms bigint)
returns boolean
language sql
volatile
as $$
  insert into kv_cache (key, value, expires_at)
  values (lock_key, 'true'::jsonb, now() + make_interval(secs => ttl_ms / 1000.0))
  on conflict (key) do update
    set expires_at = excluded.expires_at,
        updated_at = now()
    where kv_cache.expires_at is null or kv_cache.expires_at < now()
  returning true;
$$;
