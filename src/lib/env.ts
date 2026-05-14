// Boot-time environment validation (Gemini round-3 P0 finding).
//
// Previously every critical env var was read lazily at request time
// (e.g. `process.env.ANTHROPIC_API_KEY!` deep inside `lib/claude.ts`).
// If Vercel rolled a deploy with a missing key, the first 3am cron firing
// was the discovery channel. This module is invoked once from
// `instrumentation.ts#register` so the function refuses to come up at all
// when a required key is unset.
//
// Build vs runtime: Next's `next build` calls every route's module loader
// to collect metadata. We MUST NOT crash the build process; otherwise a
// CI pipeline with no runtime secrets configured can't produce an
// artifact. The `NEXT_PHASE === 'phase-production-build'` gate (set by
// Next during build) opts the build phase out of validation. Production
// runtime sets `NODE_ENV=production` without that phase flag, so prod
// boots still fail-fast.
//
// Production-only vars (SESSION_SECRET, CRON_SECRET, RESEND_*):
// Lower environments (preview, dev) don't always set these and shouldn't
// be blocked from booting. They're enforced only when NODE_ENV=production.

import { log } from '@/lib/logger';

// Variables that block every environment (incl. preview + local) when missing.
// These cover the data plane (Supabase, Alpaca, Anthropic, FMP) and the auth
// boundary (APP_PASSWORD). A null value here means the app cannot serve a
// single useful request, so refusing to boot is correct.
const REQUIRED_VARS = [
  // Supabase data plane. `NEXT_PUBLIC_SUPABASE_URL` is the actual key used
  // by `lib/supabase.ts`; the task prompt's `SUPABASE_URL` would be a
  // false-positive miss, so we validate the real key name.
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  // AI calls — Claude is load-bearing for Keisha + briefings.
  'ANTHROPIC_API_KEY',
  // Trading data + brokerage.
  'ALPACA_API_KEY',
  'ALPACA_SECRET_KEY',
  // Market data.
  'FMP_API_KEY',
  // Terminal auth boundary.
  'APP_PASSWORD',
] as const;

// Production-only — these are tolerated in preview/dev but a production
// rollout without them is a security hole.
//   - SESSION_SECRET: signs the JWT session cookie. Without it, sessions
//     fall back to a dev placeholder and every cookie is forgeable.
//   - CRON_SECRET: Vercel cron Authorization bearer. Without it, scheduled
//     jobs can't authenticate.
//   - RESEND_ALLOWED_RECIPIENTS: p6-7 hardening — without an allowlist,
//     a misconfigured ingestion path could mass-email arbitrary addresses.
const PROD_REQUIRED_VARS = [
  'SESSION_SECRET',
  'CRON_SECRET',
  'RESEND_ALLOWED_RECIPIENTS',
] as const;

/**
 * Validate the running environment has every required variable set.
 *
 * Behavior:
 *   - During `next build` (NEXT_PHASE=phase-production-build): silently
 *     no-ops. Build collects route metadata, doesn't serve traffic.
 *   - Outside the build phase: collects every missing variable into a
 *     single error message and throws. Calling code (instrumentation.ts)
 *     bubbles this into a process crash so the function won't accept
 *     traffic.
 *
 * Production-only vars are only enforced when NODE_ENV=production.
 */
export function validateEnv(): void {
  // Gate: don't fail at build phase. `next build` walks every route
  // module to extract metadata (export const dynamic, runtime, etc.),
  // which would otherwise blow up here.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const errors: string[] = [];

  for (const k of REQUIRED_VARS) {
    if (!process.env[k]) errors.push(`Missing required env: ${k}`);
  }

  if (process.env.NODE_ENV === 'production') {
    for (const k of PROD_REQUIRED_VARS) {
      if (!process.env[k]) errors.push(`Missing prod-required env: ${k}`);
    }
  }

  if (errors.length) {
    const msg = `Boot-time env validation failed:\n  - ${errors.join('\n  - ')}`;
    log.error({ missing_count: errors.length }, msg);
    throw new Error(msg);
  }

  log.info(
    { required_count: REQUIRED_VARS.length, prod_required_enforced: process.env.NODE_ENV === 'production' },
    'Boot-time env validation passed',
  );
}

/** Exported for the unit test — caller never touches these directly. */
export const __TEST_REQUIRED_VARS = REQUIRED_VARS;
export const __TEST_PROD_REQUIRED_VARS = PROD_REQUIRED_VARS;
