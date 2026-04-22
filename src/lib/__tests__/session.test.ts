import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSessionJwt, verifySessionJwt, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '../session';

describe('session JWT', () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalNodeEnv = (process.env as Record<string, string | undefined>).NODE_ENV;

  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-that-is-at-least-thirty-two-characters-long-indeed';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
    if (originalNodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  it('creates a valid 3-part JWT', async () => {
    const token = await createSessionJwt({ sub: 'wes' });
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    parts.forEach(p => expect(p.length).toBeGreaterThan(0));
  });

  it('round-trips create → verify', async () => {
    const token = await createSessionJwt({ sub: 'wes' });
    const verified = await verifySessionJwt(token);
    expect(verified).toEqual({ sub: 'wes' });
  });

  it('returns null for empty/undefined token', async () => {
    expect(await verifySessionJwt(undefined)).toBeNull();
    expect(await verifySessionJwt(null)).toBeNull();
    expect(await verifySessionJwt('')).toBeNull();
  });

  it('returns null for a malformed token', async () => {
    expect(await verifySessionJwt('not-a-jwt')).toBeNull();
    expect(await verifySessionJwt('aaa.bbb.ccc')).toBeNull();
  });

  it('returns null when the secret rotates', async () => {
    const token = await createSessionJwt({ sub: 'wes' });
    process.env.SESSION_SECRET = 'a-completely-different-secret-that-is-also-at-least-32-chars-ok';
    const verified = await verifySessionJwt(token);
    expect(verified).toBeNull();
  });

  it('returns null for a tampered token', async () => {
    const token = await createSessionJwt({ sub: 'wes' });
    const parts = token.split('.');
    // Flip the last char of the signature.
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}X`;
    const verified = await verifySessionJwt(tampered);
    expect(verified).toBeNull();
  });

  it('rejects tokens signed with a non-HS256 alg', async () => {
    // Hand-crafted "none"-alg token — must be rejected because we pin HS256.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'wes' })).toString('base64url');
    const token = `${header}.${payload}.`;
    const verified = await verifySessionJwt(token);
    expect(verified).toBeNull();
  });

  it('throws in production when SESSION_SECRET is unset', async () => {
    delete process.env.SESSION_SECRET;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    await expect(createSessionJwt({ sub: 'wes' })).rejects.toThrow(/SESSION_SECRET must be set/);
  });

  it('throws when SESSION_SECRET is too short', async () => {
    process.env.SESSION_SECRET = 'too-short';
    await expect(createSessionJwt({ sub: 'wes' })).rejects.toThrow(/≥32/);
  });

  it('exports a 30-day max age', () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it('exports the legacy cookie name for drop-in compat', () => {
    expect(SESSION_COOKIE_NAME).toBe('gt-auth');
  });
});
