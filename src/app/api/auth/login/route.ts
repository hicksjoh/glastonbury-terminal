import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { checkRateLimitDurable, getIpKey } from '@/lib/rate-limit-durable';
import {
  createSessionJwt,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '@/lib/session';

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(req: NextRequest) {
  // P0-6 (hardening/p0-codex-fixes): durable, two-bucket login limiter.
  //   - IP bucket: 5 attempts / 5 min per source IP — stops single-IP brute.
  //   - Global bucket: 60 attempts / 5 min across the whole app — caps
  //     distributed credential stuffing without locking out a legit retry.
  // Pre-fix: single in-memory `login` bucket per Vercel instance, which
  // an attacker could rotate around by hitting different warm workers.
  const ipKey = getIpKey(req);
  const ipLimit = await checkRateLimitDurable('login', ipKey, 5, 300);
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const globalLimit = await checkRateLimitDurable('login:global', 'global', 60, 300);
  if (!globalLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { password } = await req.json();
    const APP_PASSWORD = process.env.APP_PASSWORD;
    if (!APP_PASSWORD) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    if (typeof password === 'string' && safeCompare(password, APP_PASSWORD)) {
      // Issue a signed JWT session. Rotating SESSION_SECRET invalidates
      // every outstanding session immediately — the big upgrade over the
      // legacy SHA-256 cookie which was a permanent static key.
      const token = await createSessionJwt({ sub: 'wes' });
      const res = NextResponse.json({ success: true });
      res.cookies.set(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_MAX_AGE_SECONDS,
        path: '/',
      });
      return res;
    }

    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
