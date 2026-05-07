import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionJwt, SESSION_COOKIE_NAME } from '@/lib/session';
import { safeSecretEqual } from '@/lib/safe-compare';

// Public route allowlist.
//
// P0-3 (hardening/p0-codex-fixes) tightened the static-asset regex so that
// dotted dynamic routes (e.g. /stock/BRK.B) no longer bypassed auth. P1
// (this commit) tightens the API allowlist similarly: each entry is now
// either `exact` (single endpoint) or `prefix` (whole subtree). The legacy
// `pathname.startsWith(route)` matched `/api/mcp` against any future sibling
// like `/api/mcp-debug` — over-broad in a 137-route app, even if no such
// route exists today. This rule structure makes intent explicit.
//
// History:
//   - briefing/scheduled, portfolio/snapshot, and /api/cron/* routes self-
//     authenticate via cronIsAuthorized() at the route handler level.
//   - /api/healthz is the public liveness probe (P0-3); /api/health is
//     behind auth for richer diagnostics.
//   - /api/push/subscribe was moved off this list in P0-5 (it now does
//     its own session check inside the handler).
type PublicRouteRule = { path: string; match: 'exact' | 'prefix' };

const PUBLIC_ROUTES: PublicRouteRule[] = [
  // Single endpoints — exact match.
  { path: '/api/auth/login', match: 'exact' },
  { path: '/api/healthz', match: 'exact' },
  { path: '/api/briefing/scheduled', match: 'exact' },
  { path: '/api/briefing/morning-push', match: 'exact' },
  { path: '/api/cron/weekly-report', match: 'exact' },
  { path: '/api/cron/storm-watch', match: 'exact' },
  { path: '/api/cron/tax-harvest', match: 'exact' },
  { path: '/api/cron/coach-review', match: 'exact' },
  { path: '/api/cron/prediction-snapshot', match: 'exact' },
  { path: '/api/cron/slo-roundup', match: 'exact' },
  { path: '/api/portfolio/snapshot', match: 'exact' },
  { path: '/api/img', match: 'exact' },
  // MCP server endpoint; gates on MCP_AUTH_TOKEN bearer or OAuth JWT internally (F1).
  { path: '/api/mcp', match: 'exact' },
  // OAuth 2.0 / RFC 7591 — Claude.app et al. hit these before they have a session.
  { path: '/api/oauth/register', match: 'exact' },
  { path: '/api/oauth/token', match: 'exact' },
  // /api/oauth/authorize does its own session check + redirects to /login?next=...
  // when unauthenticated. We allow-list it here so the middleware doesn't intercept
  // with a 401 JSON response (which would break the browser-navigation flow from
  // Claude.app's connector popup).
  { path: '/api/oauth/authorize', match: 'exact' },
  // RFC 8414 + 9728 metadata endpoints. Both the .well-known path (what clients hit)
  // and the /api/wellknown rewrite target are allow-listed because Next.js middleware
  // runs against the original URL before rewrites.
  { path: '/.well-known/oauth-authorization-server', match: 'exact' },
  { path: '/.well-known/oauth-protected-resource', match: 'exact' },

  // Subtree allowlists — prefix match. Trailing slash kept in `path` for clarity
  // and to prevent accidentally matching `/api/sharex` against `/api/share/`.
  { path: '/api/share/', match: 'prefix' },  // F17 tokenized read-only dashboards
  { path: '/share/', match: 'prefix' },       // F17 share-page UI
  { path: '/api/wellknown/', match: 'prefix' }, // /api/wellknown/oauth-*
  // Sentry tunnel route — Sentry SDK appends an event ID path segment
  // (e.g. /monitoring/<envelope-id>). Must allow the whole subtree.
  { path: '/monitoring', match: 'prefix' },
];

function isPublicRoute(pathname: string): boolean {
  for (const rule of PUBLIC_ROUTES) {
    if (rule.match === 'exact' ? pathname === rule.path : pathname.startsWith(rule.path)) {
      return true;
    }
  }
  return false;
}

// Static assets ONLY. Tightened twice on 2026-04-28 (Codex review):
//   Round 1: replaced `pathname.includes('.')` (which let dotted symbols
//            like /stock/BRK.B bypass auth) with /\.(ico|png|...)$/i.
//   Round 2: that regex still matched any pathname ending in those
//            extensions — including dynamic routes like /api/stock/AAPL.json
//            and /stock/AAPL.json — which would have skipped middleware.
// The current regex is anchored to a single root-level segment with no
// embedded slashes, exactly the shape Next.js serves out of /public
// (e.g. /favicon.ico, /robots.txt, /icon-192.png, /manifest.json,
// /site.webmanifest, /sw.js, /offline.html). Anything with a slash after
// the first segment goes through auth even if the URL "looks static."
// /_next/* bundles are still bypassed via the prefix check below.
const STATIC_ASSET_RE = /^\/[^/]+\.(ico|png|jpg|jpeg|gif|svg|webp|avif|css|js|map|json|xml|txt|html|woff2?|ttf|otf|eot|webmanifest)$/i;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/_next/') || STATIC_ASSET_RE.test(pathname)) {
    return NextResponse.next();
  }

  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Fail-closed: if APP_PASSWORD is missing we cannot authenticate anyone.
  // Redirect pages to /login and return 500 for API calls.
  if (!process.env.APP_PASSWORD) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Verify the JWT session cookie. A null payload means: no cookie, expired,
  // tampered, wrong secret, or legacy SHA-256 cookie from the pre-S1 era —
  // all of which force a re-login.
  const authCookie = request.cookies.get(SESSION_COOKIE_NAME);
  const session = await verifySessionJwt(authCookie?.value);
  const isAuthenticated = session !== null;

  // Protected API routes: return 401 JSON instead of redirect
  if (pathname.startsWith('/api/')) {
    // Server-to-server bypass: still supports INTERNAL_API_KEY for Keisha
    // tool execution + any other internal callers. Constant-time compare so
    // a leaked-key probe can't be inferred from response timing.
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (expectedKey && safeSecretEqual(request.headers.get('x-internal-key'), expectedKey)) {
      return NextResponse.next();
    }
    if (!isAuthenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (isAuthenticated) return NextResponse.next();
  if (pathname !== '/login') {
    // Preserve the original URL as ?next= so the login page can return
    // the user where they started — important for OAuth consent flows
    // where the user lands on /oauth/consent?... before being bounced
    // here. /login itself sanitizes `next` to same-origin paths.
    const loginUrl = new URL('/login', request.url);
    const original = pathname + request.nextUrl.search;
    if (original !== '/' && original !== '/login') {
      loginUrl.searchParams.set('next', original);
    }
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
