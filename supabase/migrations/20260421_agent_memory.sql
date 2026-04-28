-- F14: Cross-agent shared memory
--
-- Every agent in the terminal (Keisha, Apollo, future Empire/Franchise/Fed
-- scorers) writes and reads small structured facts via this table. Primary
-- goal: one agent's observation ("Wes flagged stress about CR3 AR cash flow")
-- becomes context for the next agent's response, so they operate as a
-- coordinated team rather than isolated one-off chats.

create table if not exists public.agent_memory (
  id          uuid         primary key default gen_random_uuid(),
  agent_name  text         not null,
  key         text         not null,
  value       jsonb        not null,
  metadata    jsonb        not null default '{}'::jsonb,
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now(),
  expires_at  timestamptz,

  constraint agent_memory_key_not_empty check (length(key) > 0),
  constraint agent_memory_agent_not_empty check (length(agent_name) > 0)
);

-- One upsert surface per (agent, key). Use `agent_name = 'shared'` for memory
-- any agent can read/write (e.g., user mood, active focus, open decisions).
create unique index if not exists agent_memory_agent_key_uniq
  on public.agent_memory (agent_name, key);

-- Fast lookup by agent (used by listMemory + context-builder loops).
create index if not exists agent_memory_agent_idx
  on public.agent_memory (agent_name, updated_at desc);

-- Fast pruning of expired rows for the weekly clean cron.
create index if not exists agent_memory_expires_idx
  on public.agent_memory (expires_at)
  where expires_at is not null;

-- Touch updated_at automatically on every update so callers do not have to.
create or replace function public.agent_memory_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agent_memory_touch_updated_at on public.agent_memory;

create trigger agent_memory_touch_updated_at
before update on public.agent_memory
for each row
execute function public.agent_memory_touch_updated_at();

-- RLS: service role only. Terminal is single-user and middleware already
-- gates every /api/ path with a JWT, so anon/authenticated roles should not
-- touch this table. The service_role key bypasses RLS as usual.
alter table public.agent_memory enable row level security;

drop policy if exists "deny all to anon" on public.agent_memory;
create policy "deny all to anon"
  on public.agent_memory
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
