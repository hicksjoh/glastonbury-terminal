// Structured logging — pino → stdout JSON.
//
// Production-readiness audit (audit finding: no structured logs). Sentry
// catches errors, but for "what did Wes do at 3:47am that made the FMP
// client return null" you need a query-able log stream with request IDs,
// trace IDs, and structured fields. console.log soup doesn't cut it.
//
// Architecture (Vercel-friendly):
//   1. pino emits JSON lines to stdout.
//   2. Vercel captures function stdout/stderr per invocation automatically.
//   3. Configure a Vercel log drain → Logtail (or Datadog, Axiom) to forward.
//      Set LOGTAIL_SOURCE_TOKEN as a project env on Logtail's side or as the
//      drain destination secret.
//
// We deliberately do NOT use @logtail/pino (HTTP transport): it spawns
// worker threads that don't always survive Vercel function shutdown, so
// the last few log lines of a request can be lost. Stdout is reliable.
//
// Migration plan:
//   - This module is the foundation. Three routes are wired in p2-5 as
//     reference. Subsequent migrations replace `console.log/error/warn`
//     with `log.info/error/warn` and replace request handlers with
//     `withRequestLogger(req, async (log) => ...)` for auto request_id.

import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';
const isDev = process.env.NODE_ENV === 'development';

/**
 * Base logger. In dev, pretty-prints to make logs readable in the dev server
 * console. In prod (and CI), emits one JSON line per record so log drains can
 * structurally index every field.
 */
export const log = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  base: {
    // Identifies log lines to the drain. Useful when one Logtail source
    // collects from multiple apps.
    app: 'glastonbury-terminal',
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
  },
  // Standard PII / secret redaction. Pino redact paths use lodash-style
  // dot notation. These cover the common shapes that show up when you
  // accidentally log a request object whole.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.headers["x-internal-key"]',
      'headers.authorization',
      'headers.cookie',
      'headers["x-api-key"]',
      'headers["x-internal-key"]',
      'password',
      'access_token',
      'refresh_token',
      'client_secret',
      'apiKey',
      'api_key',
      // Defense-in-depth for keisha actions logs that may include order
      // payloads with PII-adjacent fields.
      '*.password',
      '*.access_token',
      '*.client_secret',
    ],
    censor: '[REDACTED]',
  },
  // Dev pretty-print: a separate transport process formats JSON into
  // human-readable lines. Skipped in prod to avoid the worker-thread
  // shutdown loss described above.
  ...(isDev && {
    transport: {
      target: 'pino/file',
      options: { destination: 1 }, // stdout, async safe in dev
    },
  }),
});

/**
 * Create a request-scoped child logger. All log lines emitted via the
 * returned logger inherit the bound fields (request_id at minimum) so
 * a single request's lines can be grep-grouped in the drain.
 */
export interface RequestLogContext {
  request_id: string;
  method?: string;
  path?: string;
  route?: string;
}

export function childLogger(ctx: RequestLogContext) {
  return log.child(ctx);
}
