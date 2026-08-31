import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// findClient is called inside verifyAccessToken to gate on revocation.
// Stub it to a permissive default — individual tests override.
const findClientMock = vi.fn();
const touchClientUsageMock = vi.fn();
vi.mock('../oauth/clients', () => ({
  findClient: (id: string) => findClientMock(id),
  touchClientUsage: (id: string) => touchClientUsageMock(id),
}));

import { createAccessToken, verifyAccessToken } from '../oauth/tokens';
import { decodeJwt } from 'jose';

describe('OAuth access tokens — P0-2 resource binding', () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalNodeEnv = (process.env as Record<string, string | undefined>).NODE_ENV;

  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-that-is-at-least-thirty-two-characters-long-indeed';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    findClientMock.mockReset();
    touchClientUsageMock.mockReset();
    // Default: client exists and is not revoked.
    findClientMock.mockResolvedValue({
      client_id: 'gt_test_client',
      revoked_at: null,
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
    if (originalNodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  it('stamps aud=resource URL when resource is provided', async () => {
    const { token } = await createAccessToken({
      sub: 'wes',
      client_id: 'gt_test_client',
      scope: 'mcp',
      resource: 'https://terminal.johnwesleyhicks.com/api/mcp',
    });
    const decoded = decodeJwt(token);
    expect(decoded.aud).toBe('https://terminal.johnwesleyhicks.com/api/mcp');
  });

  it('falls back to legacy aud=terminal-mcp when resource is omitted', async () => {
    const { token } = await createAccessToken({
      sub: 'wes',
      client_id: 'gt_test_client',
      scope: 'mcp',
    });
    const decoded = decodeJwt(token);
    expect(decoded.aud).toBe('terminal-mcp');
  });

  it('falls back to legacy aud=terminal-mcp when resource is null', async () => {
    const { token } = await createAccessToken({
      sub: 'wes',
      client_id: 'gt_test_client',
      scope: 'mcp',
      resource: null,
    });
    const decoded = decodeJwt(token);
    expect(decoded.aud).toBe('terminal-mcp');
  });

  it('verifyAccessToken accepts a URL-aud token against the matching expected resource', async () => {
    const resource = 'https://terminal.johnwesleyhicks.com/api/mcp';
    const { token } = await createAccessToken({
      sub: 'wes',
      client_id: 'gt_test_client',
      scope: 'mcp',
      resource,
    });
    const payload = await verifyAccessToken(token, resource);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('wes');
    expect(payload!.resource).toBe(resource);
  });

  it('verifyAccessToken rejects a URL-aud token against the wrong expected resource', async () => {
    const { token } = await createAccessToken({
      sub: 'wes',
      client_id: 'gt_test_client',
      scope: 'mcp',
      resource: 'https://terminal.johnwesleyhicks.com/api/mcp',
    });
    const payload = await verifyAccessToken(token, 'https://other.example.com/api/mcp');
    expect(payload).toBeNull();
  });

  it('verifyAccessToken accepts a legacy-aud token during rollout window', async () => {
    const { token } = await createAccessToken({
      sub: 'wes',
      client_id: 'gt_test_client',
      scope: 'mcp',
      // No resource — token gets legacy aud
    });
    const payload = await verifyAccessToken(
      token,
      'https://terminal.johnwesleyhicks.com/api/mcp',
    );
    expect(payload).not.toBeNull();
    expect(payload!.resource).toBe('terminal-mcp');
  });

  it('verifyAccessToken (no expectedResource arg) accepts only legacy-aud tokens', async () => {
    const legacyToken = (await createAccessToken({
      sub: 'wes',
      client_id: 'gt_test_client',
      scope: 'mcp',
    })).token;
    const urlToken = (await createAccessToken({
      sub: 'wes',
      client_id: 'gt_test_client',
      scope: 'mcp',
      resource: 'https://terminal.johnwesleyhicks.com/api/mcp',
    })).token;

    expect(await verifyAccessToken(legacyToken)).not.toBeNull();
    expect(await verifyAccessToken(urlToken)).toBeNull();
  });

  it('verifyAccessToken rejects when client is revoked', async () => {
    findClientMock.mockResolvedValueOnce({
      client_id: 'gt_test_client',
      revoked_at: '2026-01-01T00:00:00Z',
      redirect_uris: [],
    });
    const { token } = await createAccessToken({
      sub: 'wes',
      client_id: 'gt_test_client',
      scope: 'mcp',
      resource: 'https://terminal.johnwesleyhicks.com/api/mcp',
    });
    const payload = await verifyAccessToken(
      token,
      'https://terminal.johnwesleyhicks.com/api/mcp',
    );
    expect(payload).toBeNull();
  });

  it('verifyAccessToken rejects when client is missing entirely', async () => {
    findClientMock.mockResolvedValueOnce(null);
    const { token } = await createAccessToken({
      sub: 'wes',
      client_id: 'gt_test_client',
      scope: 'mcp',
      resource: 'https://terminal.johnwesleyhicks.com/api/mcp',
    });
    const payload = await verifyAccessToken(
      token,
      'https://terminal.johnwesleyhicks.com/api/mcp',
    );
    expect(payload).toBeNull();
  });

  it('verifyAccessToken rejects bogus tokens', async () => {
    expect(await verifyAccessToken(undefined)).toBeNull();
    expect(await verifyAccessToken(null)).toBeNull();
    expect(await verifyAccessToken('')).toBeNull();
    expect(await verifyAccessToken('not.a.jwt')).toBeNull();
  });
});
