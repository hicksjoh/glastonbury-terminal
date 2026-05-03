import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionJwt, SESSION_COOKIE_NAME } from '@/lib/session';

// API routes that don't require gt-auth cookie authentication.
// NOTE: briefing/scheduled, portfolio/snapshot, and the four /api/cron/*
// routes below all handle their own CRON_SECRET auth at the route level.
//
// P0-3 (hardening/p0-codex-fixes):
//   - /api/healthz is the new public liveness probe — emits only
//     { status, timestamp } and is safe for Vercel uptime monitors.
//   - /api/health is no longer public. The rich diagnostics (env validity,
//     rate-limit state, circuit state) sit behind the session-cookie gate
//     so the dashboard's Connections widget keeps working but unauthenticated
//     callers can't fingerprint the backend.
//   - /api/push/subscribe is no longer public — see P0-5.
const PUBLIC_API_ROUTES = [
  '/api/auth/login',
  '/api/healthz',
  '/api/briefing/scheduled',
  '/api/briefing/morning-push',
  '/api/cron/weekly-report',
  '/api/cron/storm-watch',
  '/api/cron/tax-harvest',
  '/api/cron/coach-review',
  '/api/cron/prediction-snapshot',
  '/api/portfolio/snapshot',
  '/api/img',
  '/api/mcp',  // MCP server; gates on MCP_AUTH_TOKEN bearer or OAuth JWT internally (F1)
  '/api/share/',  // F17 tokenized read-only dashboards — token IS the auth
  '/share/',  // F17 share-page UI — public read-only
  '/monitoring',  // Sentry tunnel route (see next.config.js tunnelRoute)
  // OAuth 2.0 / RFC 7591 dynamic client registration + token endpoint
  // (see /api/oauth/*). These MUST be public — Claude.app et al. hit them
  // before they have a session.
  '/api/oauth/register',
  '/api/oauth/token',
  // /api/oauth/authorize is technically auth-protected but the route
  // handler does its own session check + redirects to /login?next=...
  // when unauthenticated. We list it here so the middleware doesn't
  // intercept with a 401 JSON response (which would break the browser-
  // navigation flow from Claude.app's connector popup).
  '/api/oauth/authorize',
  // RFC 8414 + 9728 metadata endpoints. Both the .well-known path (what
  // clients hit) and the /api/wellknown rewrite target are listed because
  // Next.js middleware runs against the original URL before rewrites.
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/api/wellknown/',
];

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

  if (PUBLIC_API_ROUTES.some(route => pathname.startsWith(route))) {
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
    // tool execution + any other internal callers.
    const internalKey = request.headers.get('x-internal-key');
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (expectedKey && internalKey === expectedKey) {
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
