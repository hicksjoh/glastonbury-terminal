-- F7: AI Fed hawkish/dovish sentiment scores
--
-- One row per Fed press release we have scored. Scoring is expensive
-- (Claude call) so every row is cached permanently and we only score
-- new items on demand.

create table if not exists public.fed_sentiment_scores (
  id             uuid         primary key default gen_random_uuid(),
  url            text         not null unique,
  title          text         not null,
  published_at   timestamptz  not null,
  -- -1.00 very dovish · 0.00 neutral · +1.00 very hawkish
  score          numeric(4,3) not null check (score between -1 and 1),
  confidence     numeric(4,3) not null default 0 check (confidence between 0 and 1),
  key_phrases    jsonb        not null default '[]'::jsonb,
  reasoning      text         not null,
  -- Snapshot of the source text so re-scoring with a better model is possible
  source_excerpt text         not null,
  model_used     text         not null,
  scored_at      timestamptz  not null default now()
);

create index if not exists fed_sentiment_published_idx
  on public.fed_sentiment_scores (published_at desc);

alter table public.fed_sentiment_scores enable row level security;

drop policy if exists "deny all to anon" on public.fed_sentiment_scores;
create policy "deny all to anon"
  on public.fed_sentiment_scores
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
