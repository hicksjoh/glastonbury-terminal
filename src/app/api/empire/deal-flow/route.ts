import { NextResponse } from 'next/server';
import { cc, CcMcpUnavailableError, CcMcpError } from '@/lib/mcp/cc-client';

// /api/empire/deal-flow — Server-only aggregator that talks to the
// Command Center MCP and returns everything the Deal Flow page needs in
// one round trip: pipeline, territories grouped by status, and CC
// agent-health metadata.
//
// Auth: middleware-protected (gt-auth session JWT). Client never sees
// the CC_MCP_TOKEN; CC's bearer only lives in the server-side env.
//
// Notion bridge: NOTION_PIPELINE_URL points at the Notion DB that mirrors
// pipeline.json. Wes edits prospects in Notion (mobile-friendly), then
// asks Claude.app to "sync my Notion pipeline to the terminal" — Claude
// reads via notion-* tools and writes via the empire_* MCP tools. The
// page surfaces the link as a one-tap shortcut into Notion.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NOTION_PIPELINE_URL =
  process.env.NOTION_PIPELINE_URL ?? 'https://www.notion.so/122e60309061422f93d23fe266e696b9';
const NOTION_HUB_URL =
  process.env.NOTION_HUB_URL ?? 'https://www.notion.so/360d01bc6fa381e796dcfdce1ee962f5';

export async function GET() {
  try {
    const [pipelineRes, territoriesRes, agentStatus] = await Promise.all([
      cc.getPipeline().catch((err) => ({ __err: err })),
      cc.getTerritories().catch((err) => ({ __err: err })),
      cc.getAgentStatus().catch((err) => ({ __err: err })),
    ]);

    // Bubble the first CC error encountered — the page renders a clear
    // "Command Center unreachable" panel rather than a stack trace.
    const firstErr =
      (pipelineRes as { __err?: unknown }).__err ??
      (territoriesRes as { __err?: unknown }).__err ??
      (agentStatus as { __err?: unknown }).__err;
    if (firstErr) {
      if (firstErr instanceof CcMcpUnavailableError) {
        return NextResponse.json(
          { error: 'cc_unavailable', message: firstErr.message },
          { status: 503 },
        );
      }
      if (firstErr instanceof CcMcpError) {
        return NextResponse.json(
          { error: 'cc_error', code: firstErr.code, message: firstErr.message },
          { status: 502 },
        );
      }
      throw firstErr;
    }

    const pipeline = pipelineRes as Awaited<ReturnType<typeof cc.getPipeline>>;
    const territories = territoriesRes as Awaited<ReturnType<typeof cc.getTerritories>>;
    const status = agentStatus as Awaited<ReturnType<typeof cc.getAgentStatus>>;

    // Group territories by status for the page's territory panel.
    const byStatus: Record<string, typeof territories.territories> = {};
    for (const t of territories.territories) {
      const key = t.status || 'unknown';
      (byStatus[key] ||= []).push(t);
    }

    // Roll up pipeline by stage so the page can render the kanban summary.
    const byStage: Record<string, typeof pipeline.deals> = {};
    let totalValue = 0;
    for (const d of pipeline.deals) {
      const key = d.stage || 'unknown';
      (byStage[key] ||= []).push(d);
      totalValue += Number(d.value) || 0;
    }

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      cc: {
        server: status.server,
        cc_time: status.time,
        present_files: Object.entries(status.agents)
          .filter(([, v]) => v.present)
          .map(([k]) => k),
      },
      notion: {
        pipeline_url: NOTION_PIPELINE_URL,
        hub_url: NOTION_HUB_URL,
      },
      pipeline: {
        total_deals: pipeline.count,
        total_value: totalValue,
        by_stage: byStage,
        deals: pipeline.deals,
      },
      territories: {
        total: territories.count,
        by_status: byStatus,
        all: territories.territories,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'internal',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
