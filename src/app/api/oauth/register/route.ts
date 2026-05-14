import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAllowedRedirectUri, registerClient } from '@/lib/oauth/clients';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { safeSecretEqual } from '@/lib/safe-compare';
import { verifySessionJwt, SESSION_COOKIE_NAME } from '@/lib/session';
import { readBoundedJson, BodyTooLargeError, BODY_LIMIT } from '@/lib/bounded-body';

// RFC 7591 OAuth 2.0 Dynamic Client Registration.
//
// Admission policy (highest match wins):
//   1. gt-auth session cookie — Wes manually registering from his browser
//      (used by curl-style admin onboarding).
//   2. OAUTH_REGISTRATION_TOKEN bearer — programmatic admin registration
//      (used by CI / scripts).
//   3. OAUTH_OPEN_DCR=1 env var — standards-compatible anonymous DCR for
//      remote MCP clients (Claude.app's Custom Connector flow, MCP Inspector,
//      etc. which cannot attach a bearer header during RFC 7591 DCR).
//   4. NODE_ENV !== 'production' — dev fallthrough so local Claude.app
//      testing works without setup.
//   5. Otherwise: deny.
//
// History:
//   - Pre-p1-5: anonymous registration was always allowed; the consent
//     screen was the only gate.
//   - p1-5 added the session/token gates above as defense-in-depth.
//   - p6-1 (Codex hardening) flipped prod to fail-closed when the token
//     gate was unset. That was the right call as a guard against accidental
//     open DCR, BUT it also blocks Claude.app's Custom Connector flow,
//     which uses standard RFC 7591 anonymous DCR and has no way to attach
//     a bearer header during registration.
//   - p7-1 (this commit) adds the explicit OAUTH_OPEN_DCR=1 opt-in so open
//     DCR is an intentional product mode, not the silent default.
//
// Even with OAUTH_OPEN_DCR=1, registration alone grants no access:
//   - 5-per-minute-per-IP rate limit gates table bloat.
//   - Redirect URI validation (HTTPS-only except loopback) gates phishing.
//   - 8KB body cap + per-field metadata caps gate junk-payload DOS.
//   - /api/oauth/authorize requires a valid Wes session before consent.
//   - /oauth/consent is a human-in-the-loop click before any code issues.
//   - Token endpoint enforces PKCE + redirect_uri exact match + single-use code.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AdmissionResult {
  ok: boolean;
  via: 'session' | 'token' | 'open-dcr' | 'dev' | 'denied';
}

async function authorizeRegistration(req: NextRequest): Promise<AdmissionResult> {
  // Path 1: authenticated session cookie
  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (cookie?.value) {
    const session = await verifySessionJwt(cookie.value);
    if (session) return { ok: true, via: 'session' };
  }

  // Path 2: registration token (Authorization: Bearer ...)
  const expected = process.env.OAUTH_REGISTRATION_TOKEN;
  if (expected) {
    const header = req.headers.get('authorization') ?? '';
    if (header.startsWith('Bearer ') && safeSecretEqual(header.slice(7), expected)) {
      return { ok: true, via: 'token' };
    }
    // Token gate is configured but mismatched — fall through to the
    // OAUTH_OPEN_DCR check below so both gates can coexist (token for
    // admin scripts, open DCR for Claude.app's anonymous registration).
  }

  // Path 3: explicit open-DCR opt-in (RFC 7591 standards-compatible).
  if (process.env.OAUTH_OPEN_DCR === '1') {
    return { ok: true, via: 'open-dcr' };
  }

  // Path 4: dev fallthrough — never in production.
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[oauth/register] No session / token / OAUTH_OPEN_DCR — allowing ' +
        'unauthenticated registration (dev only). Production fails-closed here.',
    );
    return { ok: true, via: 'dev' };
  }

  console.error(
    '[oauth/register] denied: no session cookie, no matching ' +
      'OAUTH_REGISTRATION_TOKEN bearer, and OAUTH_OPEN_DCR is not set to "1". ' +
      'Set OAUTH_OPEN_DCR=1 to allow Claude.app-style anonymous DCR.',
  );
  return { ok: false, via: 'denied' };
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
