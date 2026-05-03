import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { findClient, verifyClientSecret } from '@/lib/oauth/clients';
import { consumeCode } from '@/lib/oauth/codes';
import { verifyS256 } from '@/lib/oauth/pkce';
import { createAccessToken } from '@/lib/oauth/tokens';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';

// RFC 6749 §3.2 Token Endpoint, §4.1.3 Access Token Request.
//
// Accepts either application/x-www-form-urlencoded (the OAuth standard) or
// JSON (Claude.app and some other clients send JSON despite RFC 6749).
// Authentication: "none" (PKCE-only) or client_secret_post.
//
// Rate-limited so a stolen authorization code can't be brute-forced via
// PKCE verifier guessing. The PKCE verifier is 43-128 chars of entropy
// per RFC 7636, so even without the rate limit guessing is impossible —
// but defence in depth.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function tokenError(error: string, description: string, status = 400): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    {
      status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    },
  );
}

async function readParams(req: NextRequest): Promise<Record<string, string>> {
  const ctype = (req.headers.get('content-type') ?? '').toLowerCase();
  const out: Record<string, string> = {};
  if (ctype.includes('application/json')) {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === 'string') out[k] = v;
      }
    } catch {
      /* fall through */
    }
  } else {
    const form = await req.formData();
    form.forEach((v, k) => {
      if (typeof v === 'string') out[k] = v;
    });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('oauth-token', key, 30, 60);
  if (!allowed) {
    return tokenError('rate_limited', 'Too many token requests', 429);
  }

  const params = await readParams(req);

  if (params.grant_type !== 'authorization_code') {
    return tokenError('unsupported_grant_type', 'Only authorization_code is supported');
  }

  const { code, redirect_uri, code_verifier, client_id, client_secret } = params;

  if (!code) return tokenError('invalid_request', 'code required');
  if (!redirect_uri) return tokenError('invalid_request', 'redirect_uri required');
  if (!code_verifier) return tokenError('invalid_request', 'code_verifier required');
  if (!client_id) return tokenError('invalid_request', 'client_id required');

  const client = await findClient(client_id);
  if (!client) return tokenError('invalid_client', 'Unknown client_id', 401);

  // Authenticate the client per its registered method.
  if (client.token_endpoint_auth_method === 'client_secret_post') {
    if (!client_secret) return tokenError('invalid_client', 'client_secret required', 401);
    const ok = await verifyClientSecret(client, client_secret);
    if (!ok) return tokenError('invalid_client', 'client_secret mismatch', 401);
  }
  // For 'none' (PKCE public) we don't authenticate the client identity itself
  // — PKCE proves the requester is the same one that started the flow.

  // Atomically consume the code. Fails if not found / expired / already used.
  const row = await consumeCode(code);
  if (!row) {
    return tokenError('invalid_grant', 'code is invalid, expired, or already used');
  }

  // Bind: the same client must be the one that created the code.
  if (row.client_id !== client_id) {
    return tokenError('invalid_grant', 'code was issued to a different client');
  }
  // Bind: redirect_uri must match the one used at /authorize.
  if (row.redirect_uri !== redirect_uri) {
    return tokenError('invalid_grant', 'redirect_uri does not match the authorize step');
  }

  // PKCE verification.
  const pkceOk = await verifyS256(code_verifier, row.code_challenge);
  if (!pkceOk) {
    return tokenError('invalid_grant', 'PKCE verification failed');
  }

  // Mint the access token.
  const { token, expires_in } = await createAccessToken({
    sub: row.subject,
    client_id,
    scope: row.scope,
  });

  return NextResponse.json(
    {
      access_token: token,
      token_type: 'Bearer',
      expires_in,
      scope: row.scope,
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    },
  );
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
