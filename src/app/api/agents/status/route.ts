import { NextResponse } from 'next/server';
import { getAgentStatuses } from '@/lib/agents/orchestrator';
import { buildMeta } from '@/lib/api-meta';

export async function GET() {
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
