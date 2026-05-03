// OAuth issuer URL helpers.
//
// The "issuer" / "resource" identifier in RFC 9728 + RFC 8414 is the public
// HTTPS origin of the terminal. We resolve it from the request the same way
// other parts of the app do — never hard-code a domain so preview deploys
// (terminal-git-*.vercel.app) Just Work and so a future move off Vercel
// requires zero code changes.
//
// Optional override: NEXT_PUBLIC_TERMINAL_ORIGIN can pin the issuer to the
// canonical domain even when running behind multiple hostnames. Useful when
// Claude.app remembers the issuer across sessions: if the connector was
// registered under terminal.johnwesleyhicks.com, the metadata should always
// echo that exact origin even when a request happens to come in via a
// preview URL.

import type { NextRequest } from 'next/server';

const STATIC_OVERRIDE = process.env.NEXT_PUBLIC_TERMINAL_ORIGIN;

export function getIssuer(req: NextRequest | Request): string {
  if (STATIC_OVERRIDE) return STATIC_OVERRIDE.replace(/\/$/, '');
  // Vercel always sets x-forwarded-host; fall back to host header in dev.
  const headers = (req as Request).headers;
  const host =
    headers.get('x-forwarded-host') ??
    headers.get('host') ??
    new URL((req as Request).url).host;
  const proto =
    headers.get('x-forwarded-proto') ??
    new URL((req as Request).url).protocol.replace(':', '') ??
    'https';
  return `${proto}://${host}`;
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  service_documentation?: string;
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported: string[];
  resource_documentation?: string;
}

export function buildAuthorizationServerMetadata(
  issuer: string,
): AuthorizationServerMetadata {
  return {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    scopes_supported: ['mcp'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    // 'none' = public clients (PKCE only); 'client_secret_post' = confidential.
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  };
}

export function buildProtectedResourceMetadata(
  issuer: string,
): ProtectedResourceMetadata {
  return {
    // The resource we're guarding is /api/mcp specifically.
    resource: `${issuer}/api/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  };
}

/**
 * Build the WWW-Authenticate header value to send on 401 from /api/mcp so
 * MCP clients (Claude.app, MCP Inspector, etc.) can discover the auth
 * server via RFC 9728 Protected Resource Metadata.
 */
export function buildWwwAuthenticate(issuer: string, error?: string): string {
  const params: string[] = [
    `realm="terminal-mcp"`,
    `resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
  ];
  if (error) params.push(`error="${error}"`);
  return `Bearer ${params.join(', ')}`;
}
