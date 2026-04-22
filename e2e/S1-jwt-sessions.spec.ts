import { test, expect } from '@playwright/test';

/**
 * Acceptance test for S1 — JWT session cookies.
 *
 * The old `gt-auth` cookie was `sha256("gt:" + APP_PASSWORD)` — a static
 * value that never rotated and could not be revoked. Any cookie capture
 * granted 30 days of access until APP_PASSWORD itself was changed.
 *
 * Post-S1, the cookie is a real signed JWT with iat/exp claims. Rotating
 * SESSION_SECRET invalidates every outstanding session immediately.
 */
test.describe('@smoke S1 — JWT session cookies', () => {
  test('issued cookie is a JWT (3-part, starts with eyJ)', async ({ request }) => {
    const password = process.env.E2E_PASSWORD || 'Glastonbury#GT!';
    const res = await request.post('/api/auth/login', { data: { password } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const setCookie = res.headers()['set-cookie'] || '';
    const match = /gt-auth=([^;]+)/.exec(setCookie);
    expect(match).not.toBeNull();
    const token = match![1];
    // JWTs are base64url-encoded 3-part (header.payload.signature).
    expect(token.split('.')).toHaveLength(3);
    expect(token.startsWith('eyJ')).toBe(true);
  });

  test('rejects an old-style SHA-256 cookie value', async ({ request }) => {
    // A 64-hex-char string in the shape of the legacy sha256("gt:" + APP_PASSWORD)
    // cookie must fail JWT verification and return 401 from protected routes.
    const legacyLookalike = 'a'.repeat(64);
    const res = await request.get('/api/sectors', {
      headers: { Cookie: `gt-auth=${legacyLookalike}` },
    });
    expect(res.status()).toBe(401);
  });

  test('rejects a tampered JWT signature', async ({ request }) => {
    // Take a real login cookie, flip the last char of the signature, expect 401.
    const password = process.env.E2E_PASSWORD || 'Glastonbury#GT!';
    const loginRes = await request.post('/api/auth/login', { data: { password } });
    const setCookie = loginRes.headers()['set-cookie'] || '';
    const match = /gt-auth=([^;]+)/.exec(setCookie);
    expect(match).not.toBeNull();
    const parts = match![1].split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}X`;

    const res = await request.get('/api/sectors', {
      headers: { Cookie: `gt-auth=${tampered}` },
    });
    expect(res.status()).toBe(401);
  });

  test('redirects unauth page requests to /login', async ({ request }) => {
    // Using a fresh context without any storage state so the gt-auth cookie
    // from global-setup isn't applied.
    const res = await request.get('/', {
      maxRedirects: 0,
      headers: { Cookie: '' },
    });
    // The middleware issues a 307 redirect to /login when no/invalid cookie.
    expect([307, 308]).toContain(res.status());
    expect(res.headers()['location']).toContain('/login');
  });
});
