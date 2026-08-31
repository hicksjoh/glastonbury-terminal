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
    // Replace the last signature char with a DIFFERENT char — a fixed 'X'
    // is a no-op 1/64 of the time when the signature already ends in 'X'.
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}${parts[2].endsWith('X') ? 'Y' : 'X'}`;
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

  // P0-1: an OAuth access token (which carries an `aud` claim) must NOT
  // verify as a session cookie. Without this guard, a stolen 1h-TTL OAuth
  // token planted in the gt-auth cookie would grant 1h of session-grade
  // access — including the OAuth consent screen, which lets the attacker
  // authorize new clients and chain a long-lived foothold.
  it('rejects a JWT with an aud claim (cross-replay defense)', async () => {
    const { SignJWT } = await import('jose');
    const secretBytes = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const oauthLikeToken = await new SignJWT({ sub: 'wes' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setAudience('https://terminal.johnwesleyhicks.com/api/mcp')
      .setExpirationTime('1h')
      .sign(secretBytes);

    const verified = await verifySessionJwt(oauthLikeToken);
    expect(verified).toBeNull();
  });

  it('rejects a JWT with the legacy terminal-mcp aud claim', async () => {
    const { SignJWT } = await import('jose');
    const secretBytes = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const legacyOauthToken = await new SignJWT({ sub: 'wes' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setAudience('terminal-mcp')
      .setExpirationTime('1h')
      .sign(secretBytes);

    const verified = await verifySessionJwt(legacyOauthToken);
    expect(verified).toBeNull();
  });
});
