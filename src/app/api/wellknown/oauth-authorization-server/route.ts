import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  buildAuthorizationServerMetadata,
  getIssuer,
} from '@/lib/oauth/metadata';

// RFC 8414 OAuth 2.0 Authorization Server Metadata.
// Internally rewritten from /.well-known/oauth-authorization-server (see
// next.config.js rewrites — App Router can't serve dotted folders).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  const issuer = getIssuer(req);
  const body = buildAuthorizationServerMetadata(issuer);
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'public, max-age=300, must-revalidate',
      // CORS — Claude.app fetches this from the browser when discovering
      // the auth server. * is fine because the response contains zero
      // user-specific data; it's the same for everyone.
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
