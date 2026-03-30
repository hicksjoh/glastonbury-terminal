import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip API routes and static files
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/') || pathname.includes('.')) {
    return NextResponse.next();
  }

  const APP_PASSWORD = process.env.APP_PASSWORD || 'glastonbury2026';
  const authCookie = request.cookies.get('gt-auth');

  if (authCookie?.value) {
    // Check hashed token
    const expectedHash = await sha256(`gt:${APP_PASSWORD}`);
    if (authCookie.value === expectedHash) {
      return NextResponse.next();
    }
    // Also accept legacy plaintext cookie for existing sessions
    if (authCookie.value === APP_PASSWORD) {
      return NextResponse.next();
    }
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
