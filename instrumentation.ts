// Next.js 14+ instrumentation hook — runs once per runtime boot.
// Wires up Sentry SDKs based on the active runtime (nodejs vs edge).
// See https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Catches errors from React Server Components, Server Actions, and route
// handlers so Sentry can report them with full request context.
export async function onRequestError(
  err: unknown,
  request: Parameters<typeof import('@sentry/nextjs').captureRequestError>[1],
  context: Parameters<typeof import('@sentry/nextjs').captureRequestError>[2],
) {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(err, request, context);
}
