import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAllowedRedirectUri, registerClient } from '@/lib/oauth/clients';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';

// RFC 7591 OAuth 2.0 Dynamic Client Registration.
//
// Anyone on the internet can register a client (this is by design — RFC 7591
// is intentionally open so any OAuth-aware app can self-register). The real
// access gate is the consent screen, which requires Wes's gt-auth cookie.
// A registered-but-never-consented client gets nothing.
//
// Rate-limited modestly so this can't be used to fill the table.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RegisterBody {
  client_name?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
  scope?: unknown;
  // Pass-through OAuth metadata we accept but don't use for policy.
  client_uri?: unknown;
  logo_uri?: unknown;
  contacts?: unknown;
  software_id?: unknown;
  software_version?: unknown;
}

function bad(detail: string, status = 400) {
  return NextResponse.json({ error: 'invalid_client_metadata', error_description: detail }, { status });
}

export async function POST(req: NextRequest) {
  // 5 registrations per IP per minute. Keeps a bot from filling the table
  // while leaving plenty of headroom for one human walking through Claude.app.
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('oauth-register', key, 5, 60);
  if (!allowed) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return bad('Body must be JSON');
  }

  const client_name = typeof body.client_name === 'string' && body.client_name.trim().length > 0
    ? body.client_name.trim()
    : null;
  if (!client_name) return bad('client_name required');
  if (client_name.length > 200) return bad('client_name too long');

  const redirect_uris_raw = body.redirect_uris;
  if (!Array.isArray(redirect_uris_raw) || redirect_uris_raw.length === 0) {
    return bad('redirect_uris must be a non-empty array');
  }
  if (redirect_uris_raw.length > 8) return bad('too many redirect_uris');
  const redirect_uris: string[] = [];
  for (const uri of redirect_uris_raw) {
    if (typeof uri !== 'string') return bad('redirect_uris must be strings');
    if (!isAllowedRedirectUri(uri)) {
      return bad(`redirect_uri rejected: ${uri} (must be https:// or loopback http://)`);
    }
    redirect_uris.push(uri);
  }

  let authMethod: 'none' | 'client_secret_post' = 'none';
  if (body.token_endpoint_auth_method !== undefined) {
    if (
      body.token_endpoint_auth_method !== 'none' &&
      body.token_endpoint_auth_method !== 'client_secret_post'
    ) {
      return bad('token_endpoint_auth_method must be "none" or "client_secret_post"');
    }
    authMethod = body.token_endpoint_auth_method;
  }

  // Scope is fixed for v1 — we only have 'mcp'.
  const scope = 'mcp';

  // Stash the rest of the registration metadata verbatim for audit.
  const metadata: Record<string, unknown> = {};
  for (const k of ['client_uri', 'logo_uri', 'contacts', 'software_id', 'software_version']) {
    const v = (body as Record<string, unknown>)[k];
    if (v !== undefined) metadata[k] = v;
  }

  try {
    const creds = await registerClient({
      client_name,
      redirect_uris,
      token_endpoint_auth_method: authMethod,
      scope,
      metadata,
    });
    return NextResponse.json(
      {
        client_id: creds.client_id,
        ...(creds.client_secret ? { client_secret: creds.client_secret } : {}),
        client_name: creds.client_name,
        redirect_uris: creds.redirect_uris,
        token_endpoint_auth_method: creds.token_endpoint_auth_method,
        scope: creds.scope,
        // RFC 7591 §3.2.1 — issuance time
        client_id_issued_at: Math.floor(Date.now() / 1000),
        // No client_secret_expires_at; secrets don't expire (rotate by
        // re-registering) — RFC 7591 says 0 means "no expiry".
        ...(creds.client_secret ? { client_secret_expires_at: 0 } : {}),
      },
      { status: 201, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'registration failed';
    return NextResponse.json(
      { error: 'server_error', error_description: msg },
      { status: 500 },
    );
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
