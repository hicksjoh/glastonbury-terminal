import { createHmac } from 'crypto';

const PLACEHOLDER = '/news-placeholder.svg';

function getSecret(): string {
  return process.env.IMG_PROXY_SECRET || process.env.APP_PASSWORD || 'gt-img-proxy-dev';
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function hmac(input: string): string {
  return createHmac('sha256', getSecret()).update(input).digest('base64url').slice(0, 24);
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const BLOCKED_HOSTS = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc00:|fe80:)/i;

export function isSafeImageUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!ALLOWED_PROTOCOLS.has(u.protocol)) return false;
    if (BLOCKED_HOSTS.test(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function signImageUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  if (!isSafeImageUrl(rawUrl)) return PLACEHOLDER;
  const encoded = b64url(rawUrl);
  const sig = hmac(encoded);
  return `/api/img?u=${encoded}&s=${sig}`;
}

export function verifyImageParams(encoded: string, sig: string): string | null {
  if (!encoded || !sig) return null;
  const expected = hmac(encoded);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const url = Buffer.from(encoded, 'base64url').toString('utf8');
    return isSafeImageUrl(url) ? url : null;
  } catch {
    return null;
  }
}

export const PLACEHOLDER_PATH = PLACEHOLDER;
