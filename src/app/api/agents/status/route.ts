import { NextResponse } from 'next/server';
import { getAgentStatuses } from '@/lib/agents/orchestrator';
import { buildMeta } from '@/lib/api-meta';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

// Live-data endpoint — never let Next static-optimize this at build time
export const dynamic = 'force-dynamic';

async function GET_impl() {
  const agents = getAgentStatuses();

  const healthy = agents.filter(a => a.status === 'idle').length;
  const running = agents.filter(a => a.status === 'running').length;
  const errored = agents.filter(a => a.status === 'error').length;

  return NextResponse.json({
    agents,
    summary: {
      total: agents.length,
      healthy,
      running,
      errored,
      status: errored > 0 ? 'degraded' : 'operational',
    },
    _meta: buildMeta({ source: 'agents', live: true }),
  });
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('agents/status', RATE.EXPENSIVE, GET_impl);
