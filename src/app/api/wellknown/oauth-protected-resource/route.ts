import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  buildProtectedResourceMetadata,
  getIssuer,
} from '@/lib/oauth/metadata';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

// RFC 9728 OAuth 2.0 Protected Resource Metadata.
// Tells MCP clients that the protected resource is /api/mcp and points
// them at this same origin as the authorization server.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function GET_impl(req: NextRequest) {
  const issuer = getIssuer(req);
  const body = buildProtectedResourceMetadata(issuer);
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'public, max-age=300, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('wellknown/oauth-protected-resource', RATE.READ, GET_impl);
