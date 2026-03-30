import { createClient } from '@supabase/supabase-js';

// Lazy — only create when actually used (avoids build-time crashes when env vars are missing)
let _anonClient: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (!_anonClient) {
    _anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _anonClient;
}

export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
