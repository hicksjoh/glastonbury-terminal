-- F17: tokenized public read-only dashboards
--
-- Each row is a single share link. The token is the URL-safe key Wes hands
-- out (to his accountant, CR3 partners, etc.); the row records what view
-- it grants access to and when it expires or was revoked. The /api/share
-- read endpoint is the only public consumer — every other API route still
-- requires the gt-auth JWT.

create table if not exists public.share_tokens (
  id          uuid         primary key default gen_random_uuid(),
  token       text         not null unique,
  view_type   text         not null check (view_type in ('net_worth', 'wealth_summary')),
  label       text,
  -- Snapshot the data at create-time so the shared view can serve a
  -- frozen copy without ever hitting live Alpaca/Supabase. Optional;
  -- when null the view computes live each time it is hit.
  snapshot    jsonb,
  created_at  timestamptz  not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  view_count  integer      not null default 0,
  last_viewed_at timestamptz
);

create index if not exists share_tokens_token_idx
  on public.share_tokens (token);

create index if not exists share_tokens_active_idx
  on public.share_tokens (created_at desc)
  where revoked_at is null;

alter table public.share_tokens enable row level security;

-- The /api/share/<token> read endpoint uses the service role to validate
-- the token and serve the snapshot. Anon/authenticated roles never touch
-- this table directly.
drop policy if exists "deny all to anon" on public.share_tokens;
create policy "deny all to anon"
  on public.share_tokens
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
