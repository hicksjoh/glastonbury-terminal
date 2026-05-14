// Next.js 14+ instrumentation hook — runs once per runtime boot.
// Wires up Sentry SDKs based on the active runtime (nodejs vs edge),
// plus runs boot-time env validation (Gemini round-3 P0) so a function
// with missing critical secrets fails fast instead of half-serving traffic.
// See https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Validate first — if a critical env var is missing, throw before any
    // module that depends on it gets imported. The edge runtime doesn't
    // host long-running handlers and its env surface is a subset, so we
    // only fail-fast on the node side.
    const { validateEnv } = await import('./src/lib/env');
    validateEnv();
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
