import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { checkRateLimitDurable, getIpKey } from '@/lib/rate-limit-durable';
import {
  createSessionJwt,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '@/lib/session';
import { loggerFor } from '@/lib/request-id';
import { readBoundedJson, BodyTooLargeError, BODY_LIMIT } from '@/lib/bounded-body';

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'auth/login' });

  // P0-6 (hardening/p0-codex-fixes): durable, two-bucket login limiter.
  //   - IP bucket: 5 attempts / 5 min per source IP — stops single-IP brute.
  //   - Global bucket: 60 attempts / 5 min across the whole app — caps
  //     distributed credential stuffing without locking out a legit retry.
  const ipKey = getIpKey(req);
  const ipLimit = await checkRateLimitDurable('login', ipKey, 5, 300);
  if (!ipLimit.allowed) {
    log.warn({ ip_key: ipKey, bucket: 'ip' }, 'login rate limit hit');
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'x-request-id': request_id } });
  }
  const globalLimit = await checkRateLimitDurable('login:global', 'global', 60, 300);
  if (!globalLimit.allowed) {
    log.warn({ bucket: 'global' }, 'login rate limit hit');
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'x-request-id': request_id } });
  }

  try {
    // p6-2: cap body at 1KB. The legitimate payload is { password: <string> },
    // realistically < 200 bytes. Anything bigger is either a probe or an
    // attempt to OOM the function on an unauth public route.
    const body = await readBoundedJson<{ password?: unknown }>(req, BODY_LIMIT.TINY);
    const { password } = body;
    const APP_PASSWORD = process.env.APP_PASSWORD;
    if (!APP_PASSWORD) {
      log.error('APP_PASSWORD missing — server misconfigured');
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500, headers: { 'x-request-id': request_id } });
    }

    if (typeof password === 'string' && safeCompare(password, APP_PASSWORD)) {
      // Issue a signed JWT session. Rotating SESSION_SECRET invalidates
      // every outstanding session immediately — the big upgrade over the
      // legacy SHA-256 cookie which was a permanent static key.
      const token = await createSessionJwt({ sub: 'wes' });
      const res = NextResponse.json({ success: true }, { headers: { 'x-request-id': request_id } });
      res.cookies.set(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_MAX_AGE_SECONDS,
        path: '/',
      });
      log.info({ ip_key: ipKey, outcome: 'success' }, 'login successful');
      return res;
    }

    log.warn({ ip_key: ipKey, outcome: 'invalid_password' }, 'login failed');
    return NextResponse.json({ error: 'Invalid password' }, { status: 401, headers: { 'x-request-id': request_id } });
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      log.warn({ ip_key: ipKey, limit: err.limit, outcome: 'body_too_large' }, 'login body too large');
      return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: { 'x-request-id': request_id } });
    }
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'login request body invalid');
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: { 'x-request-id': request_id } });
  }
}
