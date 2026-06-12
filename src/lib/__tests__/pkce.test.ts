import { describe, it, expect } from 'vitest';
import { verifyS256, isWellFormedVerifier } from '../oauth/pkce';

// Helper: build a valid PKCE pair (challenge from a known verifier) using
// the same encoding the implementation uses. Avoids hard-coding base64.
async function challengeFor(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const arr = new Uint8Array(digest);
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return Buffer.from(binary, 'binary')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const MIN_VERIFIER = 'a'.repeat(43);
const MAX_VERIFIER = 'a'.repeat(128);

describe('PKCE — isWellFormedVerifier (RFC 7636 §4.1)', () => {
  it('accepts the minimum-length verifier', () => {
    expect(isWellFormedVerifier(MIN_VERIFIER)).toBe(true);
  });

  it('accepts the maximum-length verifier', () => {
    expect(isWellFormedVerifier(MAX_VERIFIER)).toBe(true);
  });

  it('rejects verifier shorter than 43 chars', () => {
    expect(isWellFormedVerifier('a'.repeat(42))).toBe(false);
  });

  it('rejects verifier longer than 128 chars', () => {
    expect(isWellFormedVerifier('a'.repeat(129))).toBe(false);
  });

  it('accepts the full RFC unreserved character set', () => {
    // 43 chars of every allowed class
    const v = 'AaBbCc0123456789-._~AaBbCc0123456789-._~Aaa';
    expect(v.length).toBe(43);
    expect(isWellFormedVerifier(v)).toBe(true);
  });

  it('rejects whitespace', () => {
    const v = 'a'.repeat(42) + ' ';
    expect(isWellFormedVerifier(v)).toBe(false);
  });

  it('rejects newline', () => {
    expect(isWellFormedVerifier('a'.repeat(42) + '\n')).toBe(false);
  });

  it('rejects NUL byte', () => {
    expect(isWellFormedVerifier('a'.repeat(42) + '\0')).toBe(false);
  });

  it('rejects URL-reserved characters', () => {
    for (const c of ['/', '?', '#', '=', '&', '+', '%']) {
      const v = 'a'.repeat(42) + c;
      expect(isWellFormedVerifier(v)).toBe(false);
    }
  });

  it('rejects non-ASCII', () => {
    expect(isWellFormedVerifier('a'.repeat(42) + 'é')).toBe(false);
    expect(isWellFormedVerifier('a'.repeat(42) + '🦀')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isWellFormedVerifier(undefined)).toBe(false);
    expect(isWellFormedVerifier(null)).toBe(false);
    expect(isWellFormedVerifier(42)).toBe(false);
    expect(isWellFormedVerifier({})).toBe(false);
  });
});

describe('PKCE — verifyS256', () => {
  it('round-trips a known verifier/challenge pair', async () => {
    const v = MIN_VERIFIER;
    const c = await challengeFor(v);
    expect(await verifyS256(v, c)).toBe(true);
  });

  it('rejects a verifier that does not hash to the challenge', async () => {
    const v = MIN_VERIFIER;
    const c = await challengeFor(v);
    // Flip one byte of the verifier — challenge should no longer match.
    const tampered = 'b' + v.slice(1);
    expect(await verifyS256(tampered, c)).toBe(false);
  });

  it('rejects a malformed verifier shape even if challenge would match', async () => {
    // Verifier with whitespace — shape-check rejects before digest.
    const v = 'a'.repeat(42) + ' ';
    const c = await challengeFor(v);
    expect(await verifyS256(v, c)).toBe(false);
  });

  it('rejects empty inputs', async () => {
    expect(await verifyS256('', '')).toBe(false);
  });

  it('rejects when challenge length differs', async () => {
    const v = MIN_VERIFIER;
    expect(await verifyS256(v, 'wrong-length-challenge')).toBe(false);
  });
});
