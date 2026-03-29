import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const APP_PASSWORD = process.env.APP_PASSWORD || 'glastonbury2026';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip API routes and static files
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/') || pathname.includes('.')) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const authCookie = request.cookies.get('gt-auth');
  if (authCookie?.value === APP_PASSWORD) {
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
