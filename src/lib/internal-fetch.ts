/**
 * Server-to-server fetch for this app's own API routes.
 *
 * A route handler calling another route has no session cookie, so middleware
 * 401s it unless the request carries `x-internal-key`. Every self-fetch used to
 * be a bare fetch() against `https://${VERCEL_URL}` and failed that way, with
 * the caller swallowing the 401 into "no data" (QA 2026-10-05, blocker 3).
 *
 * Server-only: INTERNAL_API_KEY must never reach a client bundle.
 */
import { SESSION_COOKIE_NAME } from '@/lib/session';

/**
 * Origin for self-calls.
 *
 * Production uses the public app URL: VERCEL_URL there is the per-deployment
 * host, which can sit behind Vercel deployment protection. Every other Vercel
 * environment must call ITSELF — NEXT_PUBLIC_APP_URL is pinned to the
 * production host in vercel.json for all environments, so honouring it on a
 * preview would send preview traffic, with the internal key, to production.
 */
export function internalBaseUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '');
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== 'production') {
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  } else if (appUrl) {
    return appUrl;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

/**
 * The caller's own session cookie, when this runs inside a request.
 *
 * Most self-calls happen while serving a signed-in browser request (scanner,
 * Keisha alerts, narrative, chat context). Forwarding that request's session
 * cookie lets middleware admit the call through its normal JWT check, so those
 * paths do not depend on INTERNAL_API_KEY at all. Production showed why that
 * matters: with the key header attached, self-calls still 401'd at middleware
 * (2026-10-06 post-deploy smoke), i.e. the key the function sends is not the
 * key middleware compares against.
 *
 * Only the session cookie is forwarded, and only ever to internalBaseUrl().
 * Outside a request scope (cron, build) there is no cookie and this is null.
 */
async function callerSessionCookie(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers');
    const value = cookies().get(SESSION_COOKIE_NAME)?.value;
    return value ? `${SESSION_COOKIE_NAME}=${value}` : null;
  } catch {
    return null;
  }
}

export async function internalFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith('/api/')) {
    throw new Error(`internalFetch only targets this app's /api routes, got: ${path}`);
  }
  const headers = new Headers(init.headers);
  // Trimmed: fetch strips surrounding whitespace from header values anyway, so
  // an env value saved with a trailing newline can never match byte-for-byte.
  const key = process.env.INTERNAL_API_KEY?.trim();
  if (key) headers.set('x-internal-key', key);
  if (!headers.has('cookie')) {
    const cookie = await callerSessionCookie();
    if (cookie) headers.set('cookie', cookie);
  }
  return fetch(`${internalBaseUrl()}${path}`, { ...init, headers });
}
