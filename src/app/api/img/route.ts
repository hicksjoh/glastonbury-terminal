import { NextRequest, NextResponse } from 'next/server';
import { verifyImageParams, resolveSafeAddress, pinnedLookup } from '@/lib/img-proxy';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

export const runtime = 'nodejs';

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 5 * 1024 * 1024;
const EDGE_TTL = 60 * 60 * 24 * 7;
const PLACEHOLDER_TTL = 60 * 5;

/** Redirect hops to follow manually. Real image CDNs rarely exceed 2-3. */
const MAX_REDIRECTS = 3;

interface HopResult {
  status: number;
  headers: IncomingMessage['headers'];
  body: Buffer | null;
  tooLarge: boolean;
}

/**
 * Perform ONE request against a pre-approved IP address.
 *
 * Uses node:http(s) rather than fetch specifically so the socket can be pinned
 * to the address we validated, via the agent's `lookup` hook. `fetch` re-resolves
 * the hostname itself, which leaves a DNS-rebinding window between the safety
 * check and the connection — the host answers public for the check and private
 * for the fetch. The original hostname is still used for TLS SNI, certificate
 * validation and the Host header, so pinning changes only which IP we dial.
 */
function fetchPinned(
  target: URL,
  address: string,
  family: 4 | 6,
  timeoutMs: number,
  maxBytes: number,
): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === 'https:';
    const doRequest = isHttps ? httpsRequest : httpRequest;

    const req = doRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        lookup: pinnedLookup(address, family),
        servername: isHttps ? target.hostname : undefined,
        headers: {
          Host: target.host,
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;

        // Redirect: we only need the headers, so drain and move on.
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, headers: res.headers, body: null, tooLarge: false });
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > maxBytes) {
            res.destroy();
            resolve({ status, headers: res.headers, body: null, tooLarge: true });
            return;
          }
          chunks.push(c);
        });
        res.on('end', () =>
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks), tooLarge: false }),
        );
        res.on('error', reject);
      },
    );

    // One deadline for the whole hop.
    req.setTimeout(timeoutMs, () => req.destroy(new Error('upstream timeout')));
    req.on('error', reject);
    req.end();
  });
}

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/avif', 'image/svg+xml',
]);

function placeholderResponse(req: NextRequest, ttlSeconds: number): NextResponse {
  const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  const url = new URL('/news-placeholder.svg', origin).toString();
  return NextResponse.redirect(url, {
    status: 307,
    headers: {
      'Cache-Control': `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`,
    },
  });
}

async function GET_impl(req: NextRequest) {
  const encoded = req.nextUrl.searchParams.get('u');
  const sig = req.nextUrl.searchParams.get('s');
  const target = encoded && sig ? verifyImageParams(encoded, sig) : null;
  if (!target) return placeholderResponse(req, PLACEHOLDER_TTL);

  // Deadline across the whole redirect chain, not per hop, so a chain of slow
  // hops cannot outlive the function.
  const deadline = Date.now() + FETCH_TIMEOUT_MS;

  try {
    // Follow redirects MANUALLY, revalidating AND re-pinning every hop.
    //
    // This used to be a single `fetch(target, { redirect: 'follow' })` whose
    // only safety check was a string regex on the original hostname. News-feed
    // image URLs are signed automatically, so a poisoned feed entry pointing at
    // an attacker-controlled public host that then 302s to a private address —
    // cloud metadata, an internal service — was fetched and cached publicly for
    // seven days.
    let current = new URL(target);
    let hop: HopResult | null = null;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return placeholderResponse(req, PLACEHOLDER_TTL);

      const safe = await resolveSafeAddress(current.toString());
      if (!safe) return placeholderResponse(req, PLACEHOLDER_TTL);

      const res = await fetchPinned(current, safe.address, safe.family, remaining, MAX_BYTES);

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.location;
        if (!location) return placeholderResponse(req, PLACEHOLDER_TTL);
        try {
          current = new URL(location, current);
        } catch {
          return placeholderResponse(req, PLACEHOLDER_TTL);
        }
        continue;
      }

      hop = res;
      break;
    }

    // Redirect budget exhausted without reaching a terminal response.
    if (!hop) return placeholderResponse(req, PLACEHOLDER_TTL);
    if (hop.tooLarge || !hop.body) return placeholderResponse(req, PLACEHOLDER_TTL);
    if (hop.status < 200 || hop.status >= 300) return placeholderResponse(req, PLACEHOLDER_TTL);

    const rawType = hop.headers['content-type'];
    const contentType = String(Array.isArray(rawType) ? rawType[0] : rawType || '')
      .split(';')[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) return placeholderResponse(req, PLACEHOLDER_TTL);
    if (hop.body.length > MAX_BYTES) return placeholderResponse(req, PLACEHOLDER_TTL);

    // Copy out to a plain ArrayBuffer — the only binary BodyInit this
    // TS lib configuration accepts.
    const out = hop.body.buffer.slice(
      hop.body.byteOffset,
      hop.body.byteOffset + hop.body.byteLength,
    ) as ArrayBuffer;
    return new NextResponse(out, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(hop.body.length),
        'Cache-Control': `public, max-age=${EDGE_TTL}, s-maxage=${EDGE_TTL}, immutable`,
        'X-Proxy-Cache': 'miss',
      },
    });
  } catch {
    return placeholderResponse(req, PLACEHOLDER_TTL);
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('img', RATE.ASSET, GET_impl);
