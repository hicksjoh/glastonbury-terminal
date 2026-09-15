import { NextRequest, NextResponse } from 'next/server';
import { verifyImageParams, isPubliclyRoutableUrl } from '@/lib/img-proxy';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

export const runtime = 'nodejs';

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 5 * 1024 * 1024;
const EDGE_TTL = 60 * 60 * 24 * 7;
const PLACEHOLDER_TTL = 60 * 5;

/** Redirect hops to follow manually. Real image CDNs rarely exceed 2-3. */
const MAX_REDIRECTS = 3;

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // Follow redirects MANUALLY, revalidating every hop.
    //
    // This used to be `redirect: 'follow'`, and the only safety check was a
    // string regex on the original hostname. Since the news feeds get their
    // image URLs signed automatically, a poisoned or malicious feed entry only
    // had to point at an attacker-controlled public host that then 302'd to a
    // private address — cloud metadata, an internal service — and the function
    // fetched it and cached the response publicly for seven days. DNS
    // rebinding worked for the same reason: nothing ever resolved the name.
    let current = target;
    let upstream: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await isPubliclyRoutableUrl(current))) return placeholderResponse(req, PLACEHOLDER_TTL);

      const res = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return placeholderResponse(req, PLACEHOLDER_TTL);
        try {
          current = new URL(location, current).toString();
        } catch {
          return placeholderResponse(req, PLACEHOLDER_TTL);
        }
        try { await res.body?.cancel(); } catch {}
        continue;
      }

      upstream = res;
      break;
    }

    // Ran out of hops without reaching a terminal response.
    if (!upstream) return placeholderResponse(req, PLACEHOLDER_TTL);
    if (!upstream.ok || !upstream.body) return placeholderResponse(req, PLACEHOLDER_TTL);

    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) return placeholderResponse(req, PLACEHOLDER_TTL);

    const lenHeader = upstream.headers.get('content-length');
    if (lenHeader && parseInt(lenHeader, 10) > MAX_BYTES) return placeholderResponse(req, PLACEHOLDER_TTL);

    const reader = upstream.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        try { reader.cancel(); } catch {}
        return placeholderResponse(req, PLACEHOLDER_TTL);
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks.map(c => Buffer.from(c)));

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.length),
        'Cache-Control': `public, max-age=${EDGE_TTL}, s-maxage=${EDGE_TTL}, immutable`,
        'X-Proxy-Cache': 'miss',
      },
    });
  } catch {
    return placeholderResponse(req, PLACEHOLDER_TTL);
  } finally {
    clearTimeout(timeout);
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('img', RATE.ASSET, GET_impl);
