import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  listClients,
  revokeClient,
  unrevokeClient,
} from '@/lib/oauth/clients';
import { verifySessionJwt, SESSION_COOKIE_NAME } from '@/lib/session';
import { safeSecretEqual } from '@/lib/safe-compare';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';

// p2-1: OAuth client admin surface.
//
// GET  → list every registered client with revoked_at / last_used_at
// POST → { action: 'revoke' | 'unrevoke', client_id }
//
// Auth: same two-path admission as /api/oauth/register (session cookie OR
// Authorization: Bearer ${OAUTH_REGISTRATION_TOKEN}). Unlike /register,
// this route NEVER falls back to "open" — admin always requires real auth
// because it can disable production credentials.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authorizeAdmin(req: NextRequest): Promise<boolean> {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (cookie?.value) {
    const session = await verifySessionJwt(cookie.value);
    if (session) return true;
  }
  const expected = process.env.OAUTH_REGISTRATION_TOKEN;
  if (expected) {
    const header = req.headers.get('authorization') ?? '';
    if (header.startsWith('Bearer ') && safeSecretEqual(header.slice(7), expected)) {
      return true;
    }
  }
  return false;
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: 'unauthorized' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="oauth-admin"' } },
  );
}

export async function GET(req: NextRequest) {
  // 30/min — generous for admin browsing, caps any list-leak probing.
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('oauth-admin', key, 30, 60);
  if (!allowed) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });

  if (!(await authorizeAdmin(req))) return unauthorized();

  try {
    const clients = await listClients();
    return NextResponse.json({
      clients: clients.map(c => ({
        client_id: c.client_id,
        client_name: c.client_name,
        redirect_uris: c.redirect_uris,
        token_endpoint_auth_method: c.token_endpoint_auth_method,
        scope: c.scope,
        created_at: c.created_at,
        revoked_at: c.revoked_at,
        last_used_at: c.last_used_at,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'list failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

interface AdminBody {
  action?: unknown;
  client_id?: unknown;
}

export async function POST(req: NextRequest) {
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('oauth-admin', key, 30, 60);
  if (!allowed) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });

  if (!(await authorizeAdmin(req))) return unauthorized();

  let body: AdminBody;
  try {
    body = (await req.json()) as AdminBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (body.action !== 'revoke' && body.action !== 'unrevoke') {
    return NextResponse.json({ error: 'action must be "revoke" or "unrevoke"' }, { status: 400 });
  }
  if (typeof body.client_id !== 'string' || body.client_id.length === 0) {
    return NextResponse.json({ error: 'client_id required' }, { status: 400 });
  }

  try {
    const ok = body.action === 'revoke'
      ? await revokeClient(body.client_id)
      : await unrevokeClient(body.client_id);
    if (!ok) {
      return NextResponse.json({ error: 'client_not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, action: body.action, client_id: body.client_id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'admin action failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
