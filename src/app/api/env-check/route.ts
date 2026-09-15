import { NextResponse } from 'next/server';
import { checkEnvironment, getEnvStatus } from '@/lib/env-check';
import { getAllRateLimitStats } from '@/lib/rate-limiter';
import { getAllCircuitStats } from '@/lib/circuit-breaker';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

// Live-data endpoint — never let Next static-optimize this at build time
export const dynamic = 'force-dynamic';

async function GET_impl() {
  const envCheck = checkEnvironment();
  const envStatus = getEnvStatus();
  const rateLimits = getAllRateLimitStats();
  const circuits = getAllCircuitStats();

  const isPaper = process.env.ALPACA_PAPER === 'true' ||
    (process.env.ALPACA_BASE_URL || '').includes('paper');

  return NextResponse.json({
    valid: envCheck.valid,
    vars: envStatus,
    isPaper,
    missing: envCheck.missing,
    warnings: envCheck.warnings,
    rateLimits,
    circuits,
    summary: {
      totalVars: Object.keys(envStatus).length,
      setVars: Object.values(envStatus).filter(v => v.set).length,
      missingRequired: envCheck.missing.filter(m => m.required).length,
      missingOptional: envCheck.missing.filter(m => !m.required).length,
    },
  });
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('env-check', RATE.READ, GET_impl);
