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

export function internalFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith('/api/')) {
    throw new Error(`internalFetch only targets this app's /api routes, got: ${path}`);
  }
  const headers = new Headers(init.headers);
  const key = process.env.INTERNAL_API_KEY;
  if (key) headers.set('x-internal-key', key);
  return fetch(`${internalBaseUrl()}${path}`, { ...init, headers });
}
