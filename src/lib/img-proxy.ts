import { createHmac } from 'crypto';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

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

/**
 * True for any address that is not globally routable.
 *
 * The string-only hostname regex above cannot see these: a public DNS name
 * that resolves to 10.x, an IPv4-mapped IPv6 literal, 0.0.0.0, CGNAT space,
 * or a rebinding domain that answers publicly during validation and privately
 * during the actual fetch. Everything that reaches the network must be checked
 * here, against the resolved address.
 */
export function isPrivateAddress(addr: string): boolean {
  const ip = addr.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const v = isIP(ip);

  if (v === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true;                        // "this network" / 0.0.0.0
    if (a === 10) return true;                       // RFC1918
    if (a === 127) return true;                      // loopback
    if (a === 169 && b === 254) return true;         // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true;         // RFC1918
    if (a === 192 && b === 0) return true;           // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT RFC6598
    if (a >= 224) return true;                       // multicast + reserved + broadcast
    return false;
  }

  if (v === 6) {
    // IPv4-mapped addresses tunnel the whole IPv4 problem space through an
    // IPv6 literal, and they arrive in TWO notations: the dotted form
    // `::ffff:127.0.0.1` that a human writes, and the hex form
    // `::ffff:7f00:1` that `new URL().hostname` normalises it to. Handling
    // only the dotted form leaves `http://[::ffff:127.0.0.1]/x.png` wide open.
    const dotted = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateAddress(dotted[1]);

    const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      const quad = [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
      return isPrivateAddress(quad);
    }

    if (ip === '::' || ip === '::1') return true;    // unspecified / loopback
    if (/^f[cd]/.test(ip)) return true;              // unique-local fc00::/7
    if (/^fe[89ab]/.test(ip)) return true;           // link-local fe80::/10
    if (/^ff/.test(ip)) return true;                 // multicast
    return false;
  }

  // Not an IP literal at all — caller must resolve it first.
  return true;
}

/** Cheap, synchronous, pre-DNS screen. Necessary but NOT sufficient. */
export function isSafeImageUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!ALLOWED_PROTOCOLS.has(u.protocol)) return false;
    if (BLOCKED_HOSTS.test(u.hostname)) return false;
    // A bare IP literal can be checked properly right here.
    const bare = u.hostname.replace(/^\[|\]$/g, '');
    if (isIP(bare) && isPrivateAddress(bare)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * The authoritative check: resolve the hostname and reject if ANY answer is
 * non-global. Must be called for the initial target and again for every
 * redirect hop, because `redirect: 'follow'` never re-runs validation.
 */
export async function isPubliclyRoutableUrl(raw: string): Promise<boolean> {
  if (!isSafeImageUrl(raw)) return false;
  let hostname: string;
  try {
    hostname = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (isIP(hostname)) return !isPrivateAddress(hostname);
  try {
    const answers = await lookup(hostname, { all: true });
    if (answers.length === 0) return false;
    return answers.every(a => !isPrivateAddress(a.address));
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
