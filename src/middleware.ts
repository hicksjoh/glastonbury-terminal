import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// API routes that don't require gt-auth cookie authentication
const PUBLIC_API_ROUTES = [
  '/api/auth/login',
  '/api/health',
  '/api/briefing/scheduled',
  '/api/portfolio/snapshot',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files
  if (pathname.startsWith('/_next/') || pathname.includes('.')) {
    return NextResponse.next();
  }

  // Allow public API routes without auth (they handle their own auth if needed)
  if (PUBLIC_API_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  const APP_PASSWORD = process.env.APP_PASSWORD || 'glastonbury2026';
  const authCookie = request.cookies.get('gt-auth');

  // Check hashed token
  const isAuthenticated = authCookie?.value
    ? authCookie.value === await sha256(`gt:${APP_PASSWORD}`)
    : false;

  // Protected API routes: return 401 JSON instead of redirect
  if (pathname.startsWith('/api/')) {
    if (!isAuthenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Authenticated page requests
  if (isAuthenticated) {
    return NextResponse.next();
  }

  // Redirect to login if not on login page
  if (pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
