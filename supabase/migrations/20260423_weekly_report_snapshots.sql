-- F13: weekly Sunday report snapshots
--
-- Stores the wealth snapshot we sent on a given Sunday so the next
-- Sunday's report can compute week-over-week NW delta. Tiny table —
-- one row per Sunday cron run.

create table if not exists public.weekly_report_snapshots (
  id           uuid         primary key default gen_random_uuid(),
  payload      jsonb        not null,
  captured_at  timestamptz  not null default now()
);

create index if not exists weekly_report_snapshots_captured_at_idx
  on public.weekly_report_snapshots (captured_at desc);

alter table public.weekly_report_snapshots enable row level security;

drop policy if exists "deny all to anon" on public.weekly_report_snapshots;
create policy "deny all to anon"
  on public.weekly_report_snapshots
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
