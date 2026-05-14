import { NextRequest, NextResponse } from 'next/server';
import { verifyImageParams } from '@/lib/img-proxy';
import { loggerFor } from '@/lib/request-id';

export const runtime = 'nodejs';

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 5 * 1024 * 1024;
const EDGE_TTL = 60 * 60 * 24 * 7;
const PLACEHOLDER_TTL = 60 * 5;

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

export async function GET(req: NextRequest) {
  const { log } = loggerFor(req, { route: 'img' });

  const encoded = req.nextUrl.searchParams.get('u');
  const sig = req.nextUrl.searchParams.get('s');
  const target = encoded && sig ? verifyImageParams(encoded, sig) : null;
  if (!target) return placeholderResponse(req, PLACEHOLDER_TTL);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
      },
    });

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
        try {
          reader.cancel();
        } catch (err) {
          // Gemini round-3 P1 — was bare `catch {}`. The reader is already
          // about to be discarded so behavior is unchanged; log so we see
          // upstream bodies that misbehave under cancel (rare but real).
          log.warn(
            { err: err instanceof Error ? err.message : String(err), target },
            'img proxy: reader.cancel() threw while aborting oversize body',
          );
        }
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
