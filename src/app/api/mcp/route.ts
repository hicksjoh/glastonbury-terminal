import { NextRequest, NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildTerminalMcpServer } from '@/lib/mcp/server';
import { verifyAccessToken } from '@/lib/oauth/tokens';
import { buildWwwAuthenticate, getIssuer } from '@/lib/oauth/metadata';

// F1 — MCP streamable-HTTP transport.
//
// Auth modes accepted (any one is sufficient):
//   1. `Authorization: Bearer <MCP_AUTH_TOKEN>` — static shared secret used
//      by Claude Code CLI / scripts via `--header`. Preserved from the
//      original F1 build.
//   2. `Authorization: Bearer <oauth-access-token>` — OAuth 2.0 access
//      token issued by /api/oauth/token. Used by Claude.app's web custom
//      connector flow which only supports OAuth dynamic client registration.
//   3. `x-api-key: <MCP_AUTH_TOKEN>` — alternate header for static-token
//      clients that can't set Authorization (legacy support).
//
// On 401 we send a WWW-Authenticate header pointing to RFC 9728 Protected
// Resource Metadata so MCP clients can auto-discover the OAuth flow.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface AuthResult {
  ok: boolean;
  /** When true, the request was authorized via OAuth and this is the JWT subject. */
  oauthSubject?: string;
  /** OAuth client_id when auth came from OAuth. */
  oauthClientId?: string;
}

async function authorize(req: NextRequest): Promise<AuthResult> {
  const header = req.headers.get('authorization') ?? '';
  const expected = process.env.MCP_AUTH_TOKEN;

  // Mode 1: static MCP_AUTH_TOKEN bearer
  if (expected && header === `Bearer ${expected}`) return { ok: true };

  // Mode 3: x-api-key
  if (expected && req.headers.get('x-api-key') === expected) return { ok: true };

  // Mode 2: OAuth Bearer JWT
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (m) {
    const tok = m[1].trim();
    // The OAuth token is a JWT; the static token is whatever Wes set in
    // the env. They will never collide because verifyAccessToken requires
    // a valid HS256 signature with aud='terminal-mcp', and the static
    // token is just an opaque string the server compares directly above.
    const payload = await verifyAccessToken(tok);
    if (payload) {
      return {
        ok: true,
        oauthSubject: payload.sub,
        oauthClientId: payload.client_id,
      };
    }
  }

  return { ok: false };
}

function unauthorized(req: NextRequest, error?: string): Response {
  const issuer = getIssuer(req);
  const headers = new Headers({
    'Content-Type': 'application/json',
    'WWW-Authenticate': buildWwwAuthenticate(issuer, error),
  });
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers,
  });
}

async function handle(req: NextRequest): Promise<Response> {
  const auth = await authorize(req);
  if (!auth.ok) {
    return unauthorized(req, 'invalid_token');
  }

  const server = buildTerminalMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    // Convert NextRequest to a standard fetch Request so the transport can
    // consume it. NextRequest is already Request-compatible for header +
    // method + body reads, so we can pass through.
    const response = await transport.handleRequest(req as unknown as Request);
    return response;
  } finally {
    // The transport owns the server after connect(); closing the transport
    // is the graceful shutdown path. In stateless serverless we could let
    // GC handle it, but being explicit avoids leaks in long-lived tests.
    transport.close().catch(() => {});
  }
}

// Some MCP clients (Claude.app's connector probe) GET the URL to see if it's
// reachable before kicking off the auth dance. Always answer — 401 with
// WWW-Authenticate is the correct OAuth-aware response and triggers the
// discovery flow.
export const GET = handle;
export const POST = handle;
export const DELETE = handle;

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, MCP-Protocol-Version',
    },
  });
}
