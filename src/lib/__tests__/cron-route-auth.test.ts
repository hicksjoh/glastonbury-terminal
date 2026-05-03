import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { cronIsAuthorized, type CronAuthOptions } from '../cron-auth';

/**
 * S2 — cronIsAuthorized() must fail CLOSED when CRON_SECRET env is
 * empty/unset. Codex round-2 caught that the original guard was
 * structured as `if (cronSecret) { ...check... }` — meaning a missing
 * CRON_SECRET silently dropped the entire auth block and let
 * unauthenticated requests through. Now the helper returns false for
 * ALL inputs when CRON_SECRET is missing.
 *
 * Also confirms that the JWT-cookie path actually verifies the token —
 * the pre-fix code accepted any `gt-auth=...` cookie regardless of
 * whether it was a real signed JWT.
 */

interface MockReqOpts {
  authorization?: string;
  xApiKey?: string;
  xInternalKey?: string;
  cookies?: Record<string, string>;
  searchParams?: Record<string, string>;
}

/**
 * Mint a request shape thin enough for the auth helpers to inspect
 * without spinning up the full Next runtime.
 */
function mockReq(opts: MockReqOpts = {}): NextRequest {
  const headers = new Map<string, string>();
  if (opts.authorization !== undefined) headers.set('authorization', opts.authorization);
  if (opts.xApiKey !== undefined) headers.set('x-api-key', opts.xApiKey);
  if (opts.xInternalKey !== undefined) headers.set('x-internal-key', opts.xInternalKey);
  const cookieMap = new Map<string, { value: string }>();
  for (const [k, v] of Object.entries(opts.cookies ?? {})) cookieMap.set(k, { value: v });

  const params = new URLSearchParams(opts.searchParams ?? {});
  return {
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    cookies: { get: (k: string) => cookieMap.get(k) ?? undefined },
    nextUrl: { searchParams: params },
  } as unknown as NextRequest;
}

const ROUTES: Array<[string, CronAuthOptions]> = [
  ['/api/cron/storm-watch', { routeName: '/api/cron/storm-watch' }],
  ['/api/cron/tax-harvest', { routeName: '/api/cron/tax-harvest', allowInternalKey: true }],
  ['/api/cron/coach-review', { routeName: '/api/cron/coach-review', allowInternalKey: true }],
  ['/api/cron/prediction-snapshot', { routeName: '/api/cron/prediction-snapshot' }],
];

describe('S2 cronIsAuthorized — fail closed when CRON_SECRET is missing', () => {
  const originalCronSecret = process.env.CRON_SECRET;
  const originalSessionSecret = process.env.SESSION_SECRET;
  const originalNodeEnv = (process.env as Record<string, string | undefined>).NODE_ENV;
  const originalInternal = process.env.INTERNAL_API_KEY;

  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-that-is-at-least-thirty-two-characters-long-indeed';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    delete process.env.INTERNAL_API_KEY;
  });

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
    if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSessionSecret;
    if (originalInternal === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = originalInternal;
    if (originalNodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  for (const [name, opts] of ROUTES) {
    describe(name, () => {
      it('returns false for ALL inputs when CRON_SECRET is unset', async () => {
        delete process.env.CRON_SECRET;
        expect(await cronIsAuthorized(mockReq(), opts)).toBe(false);
        expect(await cronIsAuthorized(mockReq({ authorization: 'Bearer ' }), opts)).toBe(false);
        expect(await cronIsAuthorized(mockReq({ authorization: 'Bearer anything' }), opts)).toBe(false);
        expect(await cronIsAuthorized(mockReq({ xApiKey: 'anything' }), opts)).toBe(false);
        expect(await cronIsAuthorized(mockReq({ cookies: { 'gt-auth': 'anything' } }), opts)).toBe(false);
      });

      it('returns false for ALL inputs when CRON_SECRET is empty string', async () => {
        process.env.CRON_SECRET = '';
        expect(await cronIsAuthorized(mockReq(), opts)).toBe(false);
        expect(await cronIsAuthorized(mockReq({ authorization: 'Bearer ' }), opts)).toBe(false);
        expect(await cronIsAuthorized(mockReq({ authorization: 'Bearer anything' }), opts)).toBe(false);
      });

      it('returns true with correct Bearer when CRON_SECRET is set', async () => {
        process.env.CRON_SECRET = 'real-secret';
        expect(await cronIsAuthorized(mockReq({ authorization: 'Bearer real-secret' }), opts)).toBe(true);
      });

      it('returns true with correct x-api-key when CRON_SECRET is set', async () => {
        process.env.CRON_SECRET = 'real-secret';
        expect(await cronIsAuthorized(mockReq({ xApiKey: 'real-secret' }), opts)).toBe(true);
      });

      it('returns false with wrong Bearer when CRON_SECRET is set', async () => {
        process.env.CRON_SECRET = 'real-secret';
        expect(await cronIsAuthorized(mockReq({ authorization: 'Bearer wrong' }), opts)).toBe(false);
      });

      it('returns false for forged gt-auth=garbage cookie', async () => {
        process.env.CRON_SECRET = 'real-secret';
        expect(await cronIsAuthorized(mockReq({ cookies: { 'gt-auth': 'garbage' } }), opts)).toBe(false);
      });
    });
  }

  describe('storm-watch ?mock=miami auth gate', () => {
    it('does not bypass auth even with mock query', async () => {
      process.env.CRON_SECRET = 'real-secret';
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      expect(
        await cronIsAuthorized(
          mockReq({ searchParams: { mock: 'miami' } }),
          { routeName: '/api/cron/storm-watch' },
        ),
      ).toBe(false);
    });
  });

  describe('x-internal-key path (tax-harvest, coach-review)', () => {
    const opts: CronAuthOptions = { routeName: '/test', allowInternalKey: true };

    it('rejects x-internal-key when INTERNAL_API_KEY is unset', async () => {
      process.env.CRON_SECRET = 'real-secret';
      delete process.env.INTERNAL_API_KEY;
      expect(await cronIsAuthorized(mockReq({ xInternalKey: 'anything' }), opts)).toBe(false);
    });

    it('rejects x-internal-key when INTERNAL_API_KEY is empty string', async () => {
      process.env.CRON_SECRET = 'real-secret';
      process.env.INTERNAL_API_KEY = '';
      expect(await cronIsAuthorized(mockReq({ xInternalKey: '' }), opts)).toBe(false);
    });

    it('accepts x-internal-key when INTERNAL_API_KEY matches', async () => {
      process.env.CRON_SECRET = 'real-secret';
      process.env.INTERNAL_API_KEY = 'internal-real';
      expect(await cronIsAuthorized(mockReq({ xInternalKey: 'internal-real' }), opts)).toBe(true);
    });

    it('does not accept x-internal-key on routes without allowInternalKey', async () => {
      process.env.CRON_SECRET = 'real-secret';
      process.env.INTERNAL_API_KEY = 'internal-real';
      const noInternal: CronAuthOptions = { routeName: '/test' };
      expect(await cronIsAuthorized(mockReq({ xInternalKey: 'internal-real' }), noInternal)).toBe(false);
    });
  });

  describe('gt-auth cookie path', () => {
    it('accepts a valid signed JWT', async () => {
      process.env.CRON_SECRET = 'real-secret';
      // Reuse the live createSessionJwt against the same SESSION_SECRET we
      // set in beforeEach so the cookie value verifies under HS256.
      const { createSessionJwt } = await import('../session');
      const token = await createSessionJwt({ sub: 'wes' });
      expect(
        await cronIsAuthorized(
          mockReq({ cookies: { 'gt-auth': token } }),
          { routeName: '/test' },
        ),
      ).toBe(true);
    });

    it('rejects a tampered JWT', async () => {
      process.env.CRON_SECRET = 'real-secret';
      const { createSessionJwt } = await import('../session');
      const token = await createSessionJwt({ sub: 'wes' });
      const parts = token.split('.');
      const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}X`;
      expect(
        await cronIsAuthorized(
          mockReq({ cookies: { 'gt-auth': tampered } }),
          { routeName: '/test' },
        ),
      ).toBe(false);
    });
  });
});
