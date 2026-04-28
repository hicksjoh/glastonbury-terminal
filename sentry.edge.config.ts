// Edge runtime Sentry init. Loaded by instrumentation.ts when the Edge
// runtime boots. Catches errors in Edge middleware and Edge API routes.
// Simpler than server config because many Node-only integrations are
// unavailable on Edge.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    enabled: process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production',
    debug: false,
  });
}
