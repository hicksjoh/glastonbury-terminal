/** @type {import('next').NextConfig} */

const { withSentryConfig } = require('@sentry/nextjs');

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://s3.tradingview.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // `*.ingest.sentry.io` and `*.sentry.io` added so the browser client
      // can ship errors + traces to Sentry. If you self-host Sentry, swap
      // these for your ingest domain.
      // Phase 1-12 connect-src additions: server-side calls bypass CSP, but listed here so any future
      // client-side fetches don't get blocked by the browser. Includes Voyage (P6 embeddings),
      // OpenAI (P4 Whisper + embeddings fallback), ElevenLabs (P2 voice WS + REST), Kalshi/Polymarket
      // (P11 prediction markets), NHC (P7 storm cone images), Resend (notifications), Healthchecks (cron).
      "connect-src 'self' https://paper-api.alpaca.markets https://data.alpaca.markets wss://stream.data.alpaca.markets https://*.supabase.co https://financialmodelingprep.com https://api.anthropic.com https://finnhub.io wss://*.supabase.co https://*.ingest.sentry.io https://*.sentry.io https://api.voyageai.com https://api.openai.com https://api.elevenlabs.io wss://api.elevenlabs.io https://api.elections.kalshi.com https://gamma-api.polymarket.com https://www.nhc.noaa.gov https://api.resend.com https://hc-ping.com",
      "frame-src 'self' https://s3.tradingview.com https://*.tradingview.com",
      "frame-ancestors 'none'",
      "worker-src 'self' blob:",
      "media-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join('; '),
  },
];

const nextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

// Sentry wrapper. If SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT are
// set at build time, it also uploads source maps. With those unset the
// wrapper is still safe — the app just ships without symbolicated stacks.
module.exports = withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Bundle client-side SDK into pages that don't statically import it,
  // so unhandled errors in dynamic routes still get captured.
  widenClientFileUpload: true,
  // Keep source maps out of the public bundle — Sentry stores them
  // server-side and uses them to symbolicate when an error is received.
  hideSourceMaps: true,
  // Suppress the Sentry webpack plugin's verbose logger in CI/Vercel logs.
  disableLogger: true,
  // Let the Sentry plugin automatically tunnel requests through /monitoring
  // so ad-blockers don't swallow client-side errors.
  tunnelRoute: '/monitoring',
});
