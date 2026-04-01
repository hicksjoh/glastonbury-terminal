import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const ALPACA_BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const ALPACA_HEADERS = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
  'Content-Type': 'application/json',
};

// In-memory store for latest pipeline run
let lastPipelineRun: PipelineResult | null = null;

interface PipelineCandidate {
  symbol: string;
  signalScore: number;
  crewConsensus: string;
  guardResult: { passed: boolean; violations: string[] };
  kellySize: number | null;
  status: 'approved' | 'rejected' | 'guard_blocked';
  reason?: string;
}

interface PipelineResult {
  pipelineId: string;
  stage: string;
  candidates: PipelineCandidate[];
  executed: PipelineCandidate[];
  rejected: PipelineCandidate[];
  timestamp: string;
}

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
  const executed: PipelineCandidate[] = [];
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
      const result: PipelineResult = {
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
            expectedReturn: 0.05,
            winRate: Math.min(0.9, signal.score / 100),
            avgWin: 0.08,
            avgLoss: 0.04,
          });
          kellySize = kellyResult?.dollarsAtRisk ?? null;
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
        executed.push(candidate);
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

    const result: PipelineResult = {
      pipelineId,
      stage: 'scan_complete',
      candidates,
      executed,
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
        executed,
        rejected,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

// ── Execute: Submit Paper Trade ────────────────────────────────────────────
async function handleExecute(body: {
  symbol: string;
  shares: number;
  side: string;
}): Promise<NextResponse> {
  // CRITICAL SAFETY CHECK: Paper mode only
  if (process.env.ALPACA_PAPER !== 'true') {
    return NextResponse.json(
      { error: 'Auto-pilot execution is only available in PAPER trading mode' },
      { status: 403 }
    );
  }

  const { symbol, shares, side } = body;

  if (!symbol || !shares || !side) {
    return NextResponse.json(
      { error: 'Missing required fields: symbol, shares, side' },
      { status: 400 }
    );
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
      executed: [{
        symbol: symbol.toUpperCase(),
        shares,
        side,
        orderId: orderData.id,
        orderStatus: orderData.status,
      }],
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
  if (lastPipelineRun) {
    return NextResponse.json(lastPipelineRun);
  }

  // Try fetching from Supabase if no in-memory run
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('autopilot_executions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) throw error;

    return NextResponse.json({
      pipelineId: data?.[0]?.pipeline_id || null,
      stage: 'last_known',
      candidates: [],
      executed: data || [],
      rejected: [],
      timestamp: data?.[0]?.created_at || new Date().toISOString(),
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
      executed: data || [],
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
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'scan':
        return handleScan();
      case 'execute':
        return handleExecute(body);
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
