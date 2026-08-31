-- Atomic capped prepend for kv_cache jsonb arrays. The client-error beacon
-- appends crash records from concurrent lambdas; a read-modify-write in app
-- code loses entries when two crashes land at once. This does the prepend +
-- trim in one statement.

create or replace function kv_append_capped(entry_key text, entry jsonb, cap int)
returns void
language sql
volatile
as $$
  insert into kv_cache (key, value, expires_at)
  values (entry_key, jsonb_build_array(entry), null)
  on conflict (key) do update
    set value = (
      select coalesce(jsonb_agg(t.e order by t.ord), '[]'::jsonb)
      from (
        select e, ord
        from jsonb_array_elements(jsonb_build_array(entry) || case when jsonb_typeof(kv_cache.value) = 'array' then kv_cache.value else '[]'::jsonb end)
          with ordinality as els(e, ord)
        order by ord
        limit cap
      ) t
    ),
    updated_at = now();
$$;
