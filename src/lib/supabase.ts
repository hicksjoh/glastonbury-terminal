import { createClient } from '@supabase/supabase-js';

// supabase-js issues its queries through the global fetch, and in the App
// Router Next replaces global fetch with a caching one. A plain `.select()` is
// a GET, so Next happily stores the PostgREST response in its Data Cache and
// replays it — the route re-runs, the database is never consulted, and the
// handler makes decisions on a stale row.
//
// That is not theoretical: /api/share/[token] kept serving a share token whose
// revoked_at had already been set, because the row it validated against came
// out of the Data Cache. `export const dynamic = 'force-dynamic'` does NOT
// cover this; it governs route rendering, not the fetches made inside it.
//
// Every read in this app is live financial or auth state, so no Supabase
// response may ever be cached.
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store' });

// Lazy — only create when actually used (avoids build-time crashes when env vars are missing)
let _anonClient: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (!_anonClient) {
    _anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { fetch: noStoreFetch } },
    );
  }
  return _anonClient;
}

export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: noStoreFetch } },
  );
}
