# Structured Logging — Migration Guide

Foundation shipped in **p2-5**. This doc is the migration cookbook for
moving the rest of the ~140 API routes off `console.log` onto the
structured pipeline.

## Why

`console.log` lines vanish into Vercel's per-invocation function logs.
You can't query them, can't correlate across services, can't grep "every
log line for the request that 401'd at 03:47am UTC." Pino + Logtail (or
Datadog / Axiom) gets us:

- One JSON line per record, every field indexable
- `request_id` binding so a single request's lines group cleanly
- PII / secret redaction baked in
- Cheap to operate on Vercel — straight stdout, no transport workers

## How (the pattern)

Every API handler does this at the top:

```ts
import { loggerFor } from '@/lib/request-id';

export async function POST(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'feature/action' });

  // ... use `log.info({...}, 'message')` instead of console.log
  // ... include `'x-request-id': request_id` in every NextResponse for client correlation
}
```

That's the whole change.

## Log levels — when to use which

| Level | When |
|-------|------|
| `log.debug` | Verbose runtime detail useful in dev. Suppressed in prod (LOG_LEVEL=info). |
| `log.info`  | Lifecycle events: request received, cron started/completed, login success. |
| `log.warn`  | Something off but not failing: rate-limit hit, fallback path triggered, idempotent skip. |
| `log.error` | A 5xx, an unhandled exception caught and returned, an upstream provider failure. |
| `log.fatal` | Reserved — process can't continue. We don't use this on serverless. |

## Field naming convention

- `outcome`: terminal state — `success`, `invalid_password`, `rate_limited`, `skipped_idempotent`
- `route`: static route name (kept stable across dynamic segments)
- `request_id`: bound automatically by `loggerFor`
- `*_id`: any external resource id (`sent_id`, `briefing_id`, `client_id`)
- `err`: error message string (we redact stacks in prod via Sentry already)

## Reference implementations

Already migrated (use these as templates):

- `src/app/api/auth/login/route.ts` — security event logging, rate-limit logs, redacted error path
- `src/app/api/cron/weekly-report/route.ts` — cron lifecycle (start, success, idempotent skip, send failure)

## Production wiring (operator step, one-time)

For logs to actually leave Vercel's function-log retention you need a
**Vercel log drain → Logtail (or Datadog, Axiom)**:

1. In Logtail, create a "Vercel" source. Copy the ingest URL it gives you.
2. In the Vercel dashboard for `glastonbury-terminal`: Settings → Log
   Drains → Add Log Drain. Paste the Logtail URL. Source: "Functions".
3. (Optional) Set `LOG_LEVEL=info` in Vercel project envs to override the
   default. `debug` works in dev but is noisy in prod.

Once that's wired, every `log.*` call lands queryable in Logtail with
all fields indexed. The `LOGTAIL_SOURCE_TOKEN` env var in `.env.example`
is only needed if you ever switch back to direct HTTP transport (we
don't — drain is more reliable on serverless).

## Migration checklist (per route)

When migrating a route off `console.log`:

1. [ ] Add `import { loggerFor } from '@/lib/request-id';`
2. [ ] Add `const { log, request_id } = loggerFor(req, { route: 'X' });` at the top of the handler
3. [ ] Replace every `console.log/info/warn/error` with the corresponding `log.*({...fields}, 'message')`
4. [ ] Add `'x-request-id': request_id` to every `NextResponse` headers
5. [ ] Keep the message string short and stable; put dynamic data in the fields object
6. [ ] Don't log PII or secrets — the redact paths catch the obvious cases but new field names won't auto-redact

## What not to do

- Don't log entire request objects (`log.info({ req }, ...)`) — even with
  redact, this dumps too much per line and is expensive in the drain.
- Don't use string interpolation inside the message: `log.info('user ${id} logged in')`
  defeats structured search. Use `log.info({ user_id: id }, 'user logged in')` instead.
- Don't log on the hot path of streaming endpoints (Alpaca WS, SSE briefing
  stream). One line per request lifecycle, not one per chunk.
