import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  isAllowedRedirectUri,
  registerClient,
  countRecentClients,
  pruneStaleClients,
  MAX_NEW_CLIENTS_PER_24H,
} from '@/lib/oauth/clients';
import {
  decideRegistrationAdmission,
  isAnonymousAdmission,
  type AdmissionResult,
} from '@/lib/oauth/registration-policy';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { verifySessionJwt, SESSION_COOKIE_NAME } from '@/lib/session';
import { readBoundedJson, BodyTooLargeError, BODY_LIMIT } from '@/lib/bounded-body';

// RFC 7591 OAuth 2.0 Dynamic Client Registration.
//
// Admission (decided in src/lib/oauth/registration-policy.ts, first match wins):
//   1. gt-auth session cookie            — Wes registering from his browser
//   2. OAUTH_REGISTRATION_TOKEN bearer   — programmatic admin
//   3. OAUTH_OPEN_DCR=1                  — anonymous RFC 7591 registration for
//                                          Claude.app's custom connector / MCP
//                                          Inspector, which cannot send a bearer
//   4. token configured, nothing matched — denied
//   5. production                        — denied (fail closed, p6-1)
//   6. dev                               — allowed with a warning
//
// With OAUTH_OPEN_DCR unset the behaviour is exactly the pre-flag behaviour.
//
// Registration alone grants nothing; the consent screen is the security gate
// (/api/oauth/authorize requires Wes's session, /oauth/consent a human click).
// Table bloat is bounded three ways:
//   - 5 registrations / minute / IP (durable limiter, before auth),
//   - anonymous registration is refused once MAX_NEW_CLIENTS_PER_24H live
//     clients were created in the trailing 24h,
//   - pruneStaleClients() runs after every successful registration.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Grants every registered client may use. Clients carry no per-row list. */
const CLIENT_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;

async function authorizeRegistration(req: NextRequest): Promise<AdmissionResult> {
  let sessionValid = false;
  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (cookie?.value) {
    sessionValid = (await verifySessionJwt(cookie.value)) !== null;
  }

  const result = decideRegistrationAdmission({
    sessionValid,
    authorizationHeader: req.headers.get('authorization'),
    registrationToken: process.env.OAUTH_REGISTRATION_TOKEN,
    openDcr: process.env.OAUTH_OPEN_DCR,
    nodeEnv: process.env.NODE_ENV,
  });

  if (result.via === 'dev') {
    console.warn(
      '[oauth/register] no session / token / OAUTH_OPEN_DCR — allowing ' +
        'unauthenticated registration (dev only). Production fails closed here.',
    );
  } else if (!result.ok) {
    console.error(
      '[oauth/register] denied: no session cookie, no matching ' +
        'OAUTH_REGISTRATION_TOKEN bearer, and OAUTH_OPEN_DCR is not "1". ' +
        'Set OAUTH_OPEN_DCR=1 to allow Claude.app-style anonymous registration.',
    );
  }
  return result;
}

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
  // Rate-limit BEFORE auth so unauthenticated probe attempts still consume
  // their quota — slows down anyone testing the gate.
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('oauth-register', key, 5, 60);
  if (!allowed) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  const admission = await authorizeRegistration(req);
  if (!admission.ok) {
    return NextResponse.json(
      { error: 'unauthorized', error_description: 'Dynamic client registration is restricted on this server.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="oauth-register"' } },
    );
  }

  // Flood cap for callers that proved nothing about themselves. Session and
  // token registrants are exempt (that is Wes or his tooling). If the count
  // itself fails we refuse: an unbounded anonymous write path is the thing
  // this check exists to prevent.
  if (isAnonymousAdmission(admission.via)) {
    let recent: number;
    try {
      recent = await countRecentClients();
    } catch (err) {
      console.error('[oauth/register] recent-client count failed:', err instanceof Error ? err.message : String(err));
      return NextResponse.json(
        { error: 'temporarily_unavailable', error_description: 'Registration is temporarily unavailable.' },
        { status: 503, headers: { 'Access-Control-Allow-Origin': '*', 'Retry-After': '60' } },
      );
    }
    if (recent >= MAX_NEW_CLIENTS_PER_24H) {
      console.warn(`[oauth/register] anonymous registration refused: ${recent} clients in 24h (cap ${MAX_NEW_CLIENTS_PER_24H})`);
      return NextResponse.json(
        {
          error: 'too_many_requests',
          error_description: 'Client registration limit reached. Try again later.',
        },
        { status: 429, headers: { 'Access-Control-Allow-Origin': '*', 'Retry-After': '3600' } },
      );
    }
  }

  let body: RegisterBody;
  try {
    // p6-2: cap RFC 7591 client metadata at 8KB. Real Claude.app registration
    // bodies are ~500 bytes; anything bigger is either a probe or an attempt
    // to fill oauth_clients.metadata with megabytes of junk.
    body = await readBoundedJson<RegisterBody>(req, BODY_LIMIT.SMALL);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return NextResponse.json(
        { error: 'payload_too_large', error_description: `body exceeds ${err.limit} bytes` },
        { status: 413, headers: { 'Access-Control-Allow-Origin': '*' } },
      );
    }
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

  // p6-8 (Codex NEW issue #5): bound the pass-through metadata. Every
  // field is type-checked + length-capped before persistence so a
  // registration request can't push megabytes of junk into oauth_clients.
  const metadata: Record<string, unknown> = {};
  const META_FIELDS: { key: string; max: number; arrayMax?: number }[] = [
    { key: 'client_uri', max: 500 },
    { key: 'logo_uri', max: 500 },
    { key: 'contacts', max: 200, arrayMax: 5 },
    { key: 'software_id', max: 100 },
    { key: 'software_version', max: 50 },
  ];
  for (const f of META_FIELDS) {
    const v = (body as Record<string, unknown>)[f.key];
    if (v === undefined) continue;
    if (typeof v === 'string') {
      if (v.length > f.max) {
        return bad(`${f.key} exceeds ${f.max} chars`);
      }
      metadata[f.key] = v;
    } else if (f.arrayMax !== undefined && Array.isArray(v)) {
      if (v.length > f.arrayMax) {
        return bad(`${f.key} exceeds ${f.arrayMax} entries`);
      }
      const items: string[] = [];
      for (const item of v) {
        if (typeof item !== 'string') return bad(`${f.key} entries must be strings`);
        if (item.length > f.max) return bad(`${f.key} entry exceeds ${f.max} chars`);
        items.push(item);
      }
      metadata[f.key] = items;
    }
    // silently drop other types (object/number/bool) — RFC 7591 fields are scalars
  }

  try {
    const creds = await registerClient({
      client_name,
      redirect_uris,
      token_endpoint_auth_method: authMethod,
      scope,
      metadata: { ...metadata, registered_via: admission.via },
    });

    // Opportunistic housekeeping: drop long-revoked clients and stale e2e
    // leftovers. Best-effort — a failure here must never fail a registration
    // that already succeeded.
    try {
      const pruned = await pruneStaleClients();
      if (pruned.deleted > 0) {
        console.info(`[oauth/register] pruned ${pruned.deleted} stale client(s)`);
      }
    } catch (err) {
      console.warn('[oauth/register] prune skipped:', err instanceof Error ? err.message : String(err));
    }

    return NextResponse.json(
      {
        client_id: creds.client_id,
        ...(creds.client_secret ? { client_secret: creds.client_secret } : {}),
        client_name: creds.client_name,
        redirect_uris: creds.redirect_uris,
        token_endpoint_auth_method: creds.token_endpoint_auth_method,
        scope: creds.scope,
        grant_types: CLIENT_GRANT_TYPES,
        response_types: ['code'],
        // RFC 7591 §3.2.1 — issuance time
        client_id_issued_at: Math.floor(Date.now() / 1000),
        // No client_secret_expires_at; secrets don't expire (rotate by
        // re-registering) — RFC 7591 says 0 means "no expiry".
        ...(creds.client_secret ? { client_secret_expires_at: 0 } : {}),
      },
      { status: 201, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  } catch (err) {
    // The caller may be anonymous: never echo a database error to it.
    console.error('[oauth/register] registration failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: 'server_error', error_description: 'registration failed' },
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
