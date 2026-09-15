import { NextRequest, NextResponse } from 'next/server';
import type { AutopilotCandidate, AutopilotExecution, AutopilotResponse } from '@/lib/autopilot-contract';
import { normalizeExecutionRow } from '@/lib/autopilot-contract';
import { createServiceClient } from '@/lib/supabase';
import { rateLimit } from '@/lib/rate-limit';
import { ALPACA_BASE_URL } from '@/lib/alpaca';
import { assertLiveOrderAllowed, formatLiveOrderRejection, resolveNotionalUsd } from '@/lib/live-order-safety';
import { getServerTradingMode, LiveOrderRejectedError } from '@/lib/trading-mode';
import * as Sentry from '@sentry/nextjs';

// Live-data endpoint — never let Next static-optimize this at build time
export const dynamic = 'force-dynamic';

const ALPACA_HEADERS = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
  'Content-Type': 'application/json',
};

// In-memory store for latest pipeline run
let lastPipelineRun: AutopilotResponse | null = null;

type PipelineCandidate = AutopilotCandidate;

function generatePipelineId(): string {
  return `ap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getBaseUrl(): string {
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
}

// ── Scan: Full Signal Scan + Crew Review Pipeline ──────────────────────────
async function handleScan(): Promise<NextResponse> {
  const pipelineId = generatePipelineId();
  const baseUrl = getBaseUrl();
  const candidates: PipelineCandidate[] = [];
  const rejected: PipelineCandidate[] = [];

  try {
    // 1. Fetch signals from scanner
    const scanRes = await fetch(`${baseUrl}/api/scanner?preset=confluence`);
    if (!scanRes.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch signals from scanner', details: await scanRes.text() },
        { status: 502 }
      );
    }
    const scanData = await scanRes.json();
    const signals = scanData.signals || [];

    // 2. Filter: only signals with score > 70
    const strongSignals = signals.filter((s: { score: number }) => s.score > 70);

    // 3. Cap at 5 signals
    const topSignals = strongSignals.slice(0, 5);

    if (topSignals.length === 0) {
      const result: AutopilotResponse = {
        pipelineId,
        stage: 'scan_complete',
        candidates: [],
        executed: [],
        rejected: [],
        timestamp: new Date().toISOString(),
      };
      lastPipelineRun = result;
      return NextResponse.json(result);
    }

    // 4. For each signal, run crew review
    for (const signal of topSignals) {
      const symbol = signal.symbol || signal.ticker;
      try {
        const crewRes = await fetch(`${baseUrl}/api/agent-crew`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, action: 'buy' }),
        });

        if (!crewRes.ok) {
          rejected.push({
            symbol,
            signalScore: signal.score,
            crewConsensus: 'error',
            guardResult: { passed: false, violations: ['Crew review failed'] },
            kellySize: null,
            status: 'rejected',
            reason: 'Crew review API error',
          });
          continue;
        }

        const crewData = await crewRes.json();
        const consensus = crewData.consensus || crewData.decision || 'no_consensus';

        // 5. Check if crew approved
        const isApproved = consensus === 'unanimous_go' || consensus === 'majority_go';

        if (!isApproved) {
          const candidate: PipelineCandidate = {
            symbol,
            signalScore: signal.score,
            crewConsensus: consensus,
            guardResult: { passed: false, violations: ['Crew did not approve'] },
            kellySize: null,
            status: 'rejected',
            reason: `Crew consensus: ${consensus}`,
          };
          candidates.push(candidate);
          rejected.push(candidate);
          continue;
        }

        // 6. Behavioral guard check
        let guardResult = { passed: true, violations: [] as string[] };
        try {
          const { checkBehavioralGuards } = await import('@/lib/behavioral-guard');
          const alerts = checkBehavioralGuards(
            { action: 'buy', ticker: symbol, quantity: 0 },
            { positions: [], recentSells: [] }
          );
          guardResult = {
            passed: alerts.length === 0,
            violations: alerts.map(a => a.title),
          };
        } catch {
          // If behavioral guard module not available, pass by default
          guardResult = { passed: true, violations: [] };
        }

        if (!guardResult.passed) {
          const candidate: PipelineCandidate = {
            symbol,
            signalScore: signal.score,
            crewConsensus: consensus,
            guardResult,
            kellySize: null,
            status: 'guard_blocked',
            reason: `Guard violations: ${guardResult.violations.join(', ')}`,
          };
          candidates.push(candidate);
          rejected.push(candidate);
          continue;
        }

        // 7. Kelly sizing
        let kellySize: number | null = null;
        try {
          const { calculateKelly } = await import('@/lib/kelly-sizer');
          const kellyResult = calculateKelly({
            winRate: Math.min(0.9, signal.score / 100),
            avgWin: 0.08,
            avgLoss: 0.04,
          });
          // calculateKelly fails closed to 0 on bad input, but `?? null`
          // would have let a NaN through (?? only tests null/undefined),
          // and JSON.stringify renders NaN as null on the wire.
          kellySize = Number.isFinite(kellyResult?.dollarsAtRisk) ? kellyResult.dollarsAtRisk : null;
        } catch {
          // If Kelly sizer not available, use null
          kellySize = null;
        }

        const candidate: PipelineCandidate = {
          symbol,
          signalScore: signal.score,
          crewConsensus: consensus,
          guardResult,
          kellySize,
          status: 'approved',
        };
        candidates.push(candidate);
      } catch (err) {
        rejected.push({
          symbol,
          signalScore: signal.score,
          crewConsensus: 'error',
          guardResult: { passed: false, violations: [(err as Error).message] },
          kellySize: null,
          status: 'rejected',
          reason: `Processing error: ${(err as Error).message}`,
        });
      }
    }

    const result: AutopilotResponse = {
      pipelineId,
      stage: 'scan_complete',
      candidates,
      // A scan places no orders. Approved candidates live in `candidates`
      // with status 'approved'; `executed` is broker fills only.
      executed: [],
      rejected,
      timestamp: new Date().toISOString(),
    };

    lastPipelineRun = result;
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        pipelineId,
        stage: 'error',
        error: (err as Error).message,
        candidates,
        executed: [],
        rejected,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

// ── Execute: Submit Paper Trade ────────────────────────────────────────────
async function handleExecute(req: NextRequest, body: {
  symbol: string;
  shares: number;
  side: string;
  /** Typed notional confirmation, required in live mode above the threshold. */
  typedConfirm?: string;
}): Promise<NextResponse> {
  // CRITICAL SAFETY CHECK: Autopilot in live mode requires an EXPLICIT
  // opt-in (AUTOPILOT_ALLOW_LIVE=true). This is a second env flag on top
  // of TRADING_MODE=live so a single flipped variable can never fire real
  // money. It is a PRECONDITION, not a substitute for the per-request gates —
  // this handler is reachable by any authenticated caller, not only a cron,
  // so assertLiveOrderAllowed() runs below as well.
  const mode = getServerTradingMode();
  if (mode === 'live') {
    const allowLive = ['true', '1', 'yes'].includes(
      (process.env.AUTOPILOT_ALLOW_LIVE ?? '').trim().toLowerCase(),
    );
    if (!allowLive) {
      Sentry.addBreadcrumb({
        category: 'trading.autopilot_blocked',
        level: 'warning',
        message: 'Autopilot blocked: TRADING_MODE=live but AUTOPILOT_ALLOW_LIVE unset',
      });
      return NextResponse.json(
        { error: 'Auto-pilot in LIVE mode requires AUTOPILOT_ALLOW_LIVE=true env flag.', code: 'autopilot_live_disabled' },
        { status: 403 },
      );
    }
  }

  const { symbol, shares, side } = body;

  if (!symbol || !shares || !side) {
    return NextResponse.json(
      { error: 'Missing required fields: symbol, shares, side' },
      { status: 400 }
    );
  }

  // Full live-order safety layer — the same four gates every other order path
  // enforces, not just mode/URL alignment.
  //
  // This used to call `assertOrderSubmissionAllowed()` alone, so autopilot
  // satisfied gate (a) and the AUTOPILOT_ALLOW_LIVE env flag, but never gate
  // (b) the session-bound x-live-ack token or gate (c) typed notional
  // confirmation. A deploy-wide env flag is not a per-request authorisation:
  // with TRADING_MODE=live and AUTOPILOT_ALLOW_LIVE=true, an authenticated
  // POST of {"action":"execute","shares":100000} became an unbounded live
  // market order. /api/alpaca/orders, /api/options/order, the multi-leg route
  // and Keisha's place_order all go through assertLiveOrderAllowed; this is
  // now the fifth.
  //
  // resolveNotionalUsd fetches a live quote for market orders, so a market
  // order cannot slip the typed-confirm threshold by having no limit price.
  //
  // Only resolved in live mode: resolveNotionalUsd fetches a quote, and
  // assertLiveOrderAllowed ignores the notional entirely off-live, so doing it
  // unconditionally would spend an Alpaca call and its latency on every paper
  // trade for a number nothing reads.
  const notionalUsd = mode === 'live'
    ? await resolveNotionalUsd({ symbol: String(symbol), qty: Number(shares) })
    : 0;
  try {
    await assertLiveOrderAllowed({
      request: req,
      typedConfirm: typeof body.typedConfirm === 'string' ? body.typedConfirm : undefined,
      notionalUsd,
      auditContext: { route: 'autopilot/execute', symbol: String(symbol), side: String(side), qty: Number(shares) },
    });
  } catch (lockErr) {
    if (lockErr instanceof LiveOrderRejectedError) {
      const [rejBody, rejInit] = formatLiveOrderRejection(lockErr);
      return NextResponse.json(rejBody, rejInit);
    }
    const msg = lockErr instanceof Error ? lockErr.message : 'trading-mode guard engaged';
    console.error('Autopilot order blocked by safety layer:', msg);
    return NextResponse.json({ error: `Order blocked by safety layer: ${msg}` }, { status: 500 });
  }

  if (mode === 'live') {
    Sentry.addBreadcrumb({
      category: 'trading.autopilot_live_attempt',
      level: 'warning',
      message: 'Autopilot submitting LIVE order',
      data: { symbol, side, shares },
    });
  }

  try {
    // Submit order via Alpaca
    const orderRes = await fetch(`${ALPACA_BASE_URL}/v2/orders`, {
      method: 'POST',
      headers: ALPACA_HEADERS,
      body: JSON.stringify({
        symbol: symbol.toUpperCase(),
        qty: shares.toString(),
        side,
        type: 'market',
        time_in_force: 'day',
      }),
    });

    const orderData = await orderRes.json();

    if (!orderRes.ok) {
      return NextResponse.json(
        { error: 'Alpaca order failed', details: orderData },
        { status: orderRes.status }
      );
    }

    // Log to Supabase
    try {
      const supabase = createServiceClient();
      await (supabase as any).from('autopilot_executions').insert({
        symbol: symbol.toUpperCase(),
        shares,
        side,
        order_id: orderData.id,
        status: orderData.status,
        filled_avg_price: orderData.filled_avg_price,
        pipeline_id: lastPipelineRun?.pipelineId || null,
        created_at: new Date().toISOString(),
      });
    } catch (dbErr) {
      console.error('Failed to log execution to Supabase:', dbErr);
    }

    return NextResponse.json({
      pipelineId: lastPipelineRun?.pipelineId || null,
      stage: 'executed',
      candidates: [],
      executed: [normalizeExecutionRow({
        id: orderData.id,
        symbol: symbol.toUpperCase(),
        shares,
        side,
        order_id: orderData.id,
        status: orderData.status,
        filled_avg_price: orderData.filled_avg_price,
        pipeline_id: lastPipelineRun?.pipelineId ?? null,
        created_at: new Date().toISOString(),
      })],
      rejected: [],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Execution failed', details: (err as Error).message },
      { status: 500 }
    );
  }
}

// ── Status: Current Pipeline Status ────────────────────────────────────────
async function handleStatus(): Promise<NextResponse> {
  // ALWAYS read execution history from the database, even when an in-memory
  // pipeline run exists.
  //
  // This used to short-circuit on `lastPipelineRun` alone. That was survivable
  // while `executed` carried approved candidates, but now that it carries only
  // real broker fills — and a scan deliberately sets it to [] — short-circuiting
  // meant that after one scan on a warm lambda, every later status call
  // returned `executed: []` and never looked at `autopilot_executions`. The
  // fills were in the table and invisible in the UI.
  let executed: AutopilotExecution[] = [];
  let historyError = false;
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('autopilot_executions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    executed = (data || []).map(normalizeExecutionRow);
  } catch {
    historyError = true;
  }

  if (lastPipelineRun) {
    return NextResponse.json({ ...lastPipelineRun, executed });
  }

  try {
    if (historyError) throw new Error('history unavailable');

    return NextResponse.json({
      pipelineId: executed[0]?.pipelineId ?? null,
      stage: 'last_known',
      candidates: [],
      executed,
      rejected: [],
      timestamp: executed[0]?.executedAt ?? new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      pipelineId: null,
      stage: 'no_data',
      candidates: [],
      executed: [],
      rejected: [],
      timestamp: new Date().toISOString(),
    });
  }
}

// ── History: Execution History ─────────────────────────────────────────────
async function handleHistory(): Promise<NextResponse> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('autopilot_executions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    return NextResponse.json({
      pipelineId: null,
      stage: 'history',
      candidates: [],
      executed: (data || []).map(normalizeExecutionRow),
      rejected: [],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch history', details: (err as Error).message },
      { status: 500 }
    );
  }
}

// ── Route Handlers ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('autopilot', 15, 60000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'scan':
        return handleScan();
      case 'execute':
        return handleExecute(req, body);
      case 'status':
        return handleStatus();
      case 'history':
        return handleHistory();
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Valid actions: scan, execute, status, history` },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid request', details: (err as Error).message },
      { status: 400 }
    );
  }
}

export async function GET() {
  return handleStatus();
}
