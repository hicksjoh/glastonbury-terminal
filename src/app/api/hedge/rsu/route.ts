import { NextRequest, NextResponse } from 'next/server';
import { analyzeRsuHedge, loadWealthSnapshot } from '@/lib/hedge/rsu-analyzer';
import { getCached, setCache } from '@/lib/server-cache';
import { checkRateLimitDurable } from '@/lib/rate-limit-durable';

// F2 — RSU concentration hedge agent (Agent Team).
//
// GET /api/hedge/rsu                - cached read of the latest analysis
// POST /api/hedge/rsu               - run a fresh analysis (Claude call)
//
// Cached 30 min on the GET path because the underlying inputs (wealth
// snapshot + market quotes) update slowly. Wes can force-refresh via POST
// when he wants a fresh team-debate.

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_KEY = 'hedge:rsu:latest';

export async function GET() {
  const cached = getCached<unknown>(CACHE_KEY);
  if (cached) return NextResponse.json(cached);

  // No cached analysis yet — return the wealth snapshot so the UI can
  // render a "click to analyze" empty state without burning Claude tokens
  // on every page mount.
  try {
    const wealth = await loadWealthSnapshot();
    return NextResponse.json({
      analysis: null,
      wealth,
      hint: 'POST to /api/hedge/rsu to run the agent team analysis.',
    });
  } catch (err) {
    return NextResponse.json({
      analysis: null,
      wealth: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}

export async function POST() {
  // P0-6: Claude multi-agent debate route. 5 / 5 min durable.
  const { allowed } = await checkRateLimitDurable('hedge-rsu-analyze', 'global', 5, 300);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded — RSU hedge analysis is capped at 5 / 5 min' },
      { status: 429 },
    );
  }

  try {
    const analysis = await analyzeRsuHedge();
    if (!analysis) {
      return NextResponse.json({
        analysis: null,
        error: 'Analysis failed — Anthropic SDK key missing, wealth snapshot empty, or model output unparseable',
      }, { status: 500 });
    }

    const payload = {
      analysis,
      generatedAt: new Date().toISOString(),
    };
    setCache(CACHE_KEY, payload, CACHE_TTL_MS);
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({
      analysis: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}
