// Server-side Sentry init. Loaded by instrumentation.ts when the Node
// runtime boots. Catches errors in API routes, server components, and
// anything running in the Node runtime.
//
// Set SENTRY_DSN in Vercel env (Production + Preview + Development) to
// activate. Leaving it unset is a safe no-op — Sentry will not phone home.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',

    // Low sample rate to stay under free-tier transaction quota.
    // Bump locally if actively debugging performance.
    tracesSampleRate: 0.1,

    // Send errors only in production; development errors are noise.
    enabled: process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production',

    debug: false,

    // Don't ship full request bodies by default — could contain PII /
    // portfolio context. Opt-in per route if you need it.
    sendDefaultPii: false,
  });
}
