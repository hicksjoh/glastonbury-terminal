// Client-side Sentry init. Next.js auto-loads this in the browser bundle.
// Catches React errors, unhandled promise rejections, and can correlate
// with server-side traces if both DSNs point to the same project.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || 'development',

    // Low sample rate to stay under free-tier transaction quota.
    tracesSampleRate: 0.1,

    // Replay: disabled by default to avoid bundle bloat + privacy concerns.
    // Enable via Sentry.replayIntegration() in a future PR if useful.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Send errors only in production; development errors are noise.
    enabled: process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production',

    debug: false,
  });
}
