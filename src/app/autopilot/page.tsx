'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Bot, Play, AlertTriangle, Loader2, Activity, Shield, TrendingUp, BarChart3 } from 'lucide-react';
import type { AutopilotCandidate, AutopilotExecution } from '@/lib/autopilot-contract';
import { APP_TIME_ZONE } from '@/lib/et-clock';

// ── Types ──────────────────────────────────────────────────────────────────────

// Shapes come from the route via a shared module now — see
// src/lib/autopilot-contract.ts for why these were redeclared (and wrong).
type Candidate = AutopilotCandidate;
type ExecutionRecord = AutopilotExecution;

interface PipelineCounts {
  scanned: number;
  filtered: number;
  crewApproved: number;
  guardCleared: number;
  sized: number;
  executed: number;
}


interface PerformanceSummary {
  wins: number;
  losses: number;
  open: number;
  winRate: number;
  totalPnl: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PIPELINE_STEPS = ['SCAN', 'FILTER', 'CREW', 'GUARD', 'SIZE', 'EXECUTE'] as const;

const COLORS = {
  bg: '#0a0a1a',
  surface: '#1a1a24',
  border: '#2a2a3a',
  purple: '#8a5cf6',
  gold: '#f0c674',
  green: '#4ade80',
  red: '#f87171',
  cyan: '#22d3ee',
  textPrimary: '#e0e0e8',
  textSecondary: '#8888a8',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function getVerdictStyle(verdict: string): { bg: string; color: string } {
  switch (verdict) {
    case 'BUY': return { bg: 'rgba(74,222,128,0.15)', color: COLORS.green };
    case 'HOLD': return { bg: 'rgba(240,198,116,0.15)', color: COLORS.gold };
    case 'REJECT': return { bg: 'rgba(248,113,113,0.15)', color: COLORS.red };
    default: return { bg: 'rgba(255,255,255,0.05)', color: COLORS.textSecondary };
  }
}

/** Execution timestamps are ISO UTC; the terminal reads in ET everywhere. */
function formatExecutedAt(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    timeZone: APP_TIME_ZONE,
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function AutoPilotPage() {
  const [armed, setArmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<number>(-1);
  const [maxTradesPerDay, setMaxTradesPerDay] = useState(3);
  const [maxAllocationPct, setMaxAllocationPct] = useState(10);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pipelineCounts, setPipelineCounts] = useState<PipelineCounts | null>(null);
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [performance, setPerformance] = useState<PerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState<string | null>(null);

  // Restore armed state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('autopilot-armed');
    if (stored === 'true') setArmed(true);
    const storedMax = localStorage.getItem('autopilot-maxTrades');
    if (storedMax) setMaxTradesPerDay(Number(storedMax));
    const storedAlloc = localStorage.getItem('autopilot-maxAlloc');
    if (storedAlloc) setMaxAllocationPct(Number(storedAlloc));
  }, []);

  // Persist settings
  useEffect(() => {
    localStorage.setItem('autopilot-armed', String(armed));
  }, [armed]);
  useEffect(() => {
    localStorage.setItem('autopilot-maxTrades', String(maxTradesPerDay));
  }, [maxTradesPerDay]);
  useEffect(() => {
    localStorage.setItem('autopilot-maxAlloc', String(maxAllocationPct));
  }, [maxAllocationPct]);

  // Load history and performance on mount
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.executed) setExecutions(data.executed);
        if (data.performance) setPerformance(data.performance);
        if (data.candidates) setCandidates(data.candidates);
        if (data.pipelineCounts) setPipelineCounts(data.pipelineCounts);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Run pipeline
  const runPipeline = async () => {
    setRunning(true);
    setCandidates([]);
    setPipelineCounts(null);
    setCurrentStep(0);

    try {
      // Simulate step progression
      for (let i = 0; i < PIPELINE_STEPS.length; i++) {
        setCurrentStep(i);
        await new Promise(r => setTimeout(r, 800));
      }

      const res = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run_pipeline',
          maxTradesPerDay,
          maxAllocationPct,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.candidates) setCandidates(data.candidates);
        if (data.pipelineCounts) setPipelineCounts(data.pipelineCounts);
        if (data.executed) setExecutions(data.executed);
        if (data.performance) setPerformance(data.performance);
      }
    } catch {
      // silent
    } finally {
      setRunning(false);
      setCurrentStep(-1);
    }
  };

  // Execute a single candidate
  const executeTrade = async (symbol: string) => {
    setExecuting(symbol);
    try {
      const res = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'execute', symbol }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.executed) setExecutions(data.executed);
        if (data.performance) setPerformance(data.performance);
      }
    } catch {
      // silent
    } finally {
      setExecuting(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <ErrorBoundary label="Autopilot">
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: `linear-gradient(135deg, ${COLORS.purple}, ${COLORS.cyan})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Bot size={28} color="#fff" />
          </div>
          <div>
            <h1 style={{
              fontSize: 28, fontWeight: 700, color: COLORS.textPrimary, margin: 0,
              letterSpacing: '-0.5px',
            }}>
              Auto-Pilot Control Center
            </h1>
            <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0 }}>
              Agentic Trading Pipeline
            </p>
          </div>
        </div>

        {/* ── Safety Banner ──────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 20px', borderRadius: 10, marginBottom: 24, marginTop: 16,
          background: 'rgba(240,198,116,0.08)', border: `1px solid ${COLORS.gold}40`,
        }}>
          <AlertTriangle size={18} color={COLORS.gold} />
          <span style={{ fontSize: 14, color: COLORS.gold, fontWeight: 600 }}>
            Paper Trading Mode
          </span>
          <span style={{ fontSize: 13, color: COLORS.textSecondary }}>
            — Auto-Pilot will only execute in paper trading environment
          </span>
        </div>

        {/* ── Toggle + Controls Bar ──────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 16, padding: '20px 24px', borderRadius: 12,
          background: COLORS.surface, border: `1px solid ${COLORS.border}`,
          marginBottom: 24,
        }}>
          {/* Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              onClick={() => setArmed(!armed)}
              style={{
                width: 72, height: 36, borderRadius: 18, border: 'none', cursor: 'pointer',
                background: armed ? COLORS.green : '#333340',
                position: 'relative', transition: 'background 0.3s',
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 14,
                background: '#fff', position: 'absolute', top: 4,
                left: armed ? 40 : 4, transition: 'left 0.3s',
                boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
              }} />
            </button>
            {armed ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: 5, background: COLORS.green,
                  animation: 'pulse-dot 2s ease-in-out infinite',
                }} />
                <span style={{ fontSize: 15, fontWeight: 700, color: COLORS.green }}>
                  Auto-Pilot is ARMED
                </span>
              </div>
            ) : (
              <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.textSecondary }}>
                Auto-Pilot is OFFLINE
              </span>
            )}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {/* Max trades */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: COLORS.textSecondary }}>Max Trades/Day</span>
              <select
                value={maxTradesPerDay}
                onChange={e => setMaxTradesPerDay(Number(e.target.value))}
                style={{
                  background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6,
                  color: COLORS.textPrimary, padding: '6px 10px', fontSize: 13,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {[1, 3, 5, 10].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>

            {/* Max allocation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: COLORS.textSecondary }}>Max Alloc %</span>
              <select
                value={maxAllocationPct}
                onChange={e => setMaxAllocationPct(Number(e.target.value))}
                style={{
                  background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6,
                  color: COLORS.textPrimary, padding: '6px 10px', fontSize: 13,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {[5, 10, 25, 50].map(v => <option key={v} value={v}>{v}%</option>)}
              </select>
            </div>

            {/* Run button */}
            <button
              onClick={runPipeline}
              disabled={running}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 8, border: 'none', cursor: running ? 'not-allowed' : 'pointer',
                background: running ? '#555' : COLORS.purple, color: '#fff',
                fontSize: 14, fontWeight: 600, opacity: running ? 0.7 : 1,
              }}
            >
              {running ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={16} />}
              {running ? 'Running...' : 'Run Pipeline Now'}
            </button>
          </div>
        </div>

        {/* ── Pipeline Flow Diagram ──────────────────────────────────────── */}
        <div style={{
          padding: '24px', borderRadius: 12, marginBottom: 24,
          background: COLORS.surface, border: `1px solid ${COLORS.border}`,
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: COLORS.textSecondary, margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: 1 }}>
            Pipeline Flow
          </h3>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 0, overflowX: 'auto', padding: '8px 0',
          }}>
            {PIPELINE_STEPS.map((step, i) => {
              const isActive = running && currentStep === i;
              const isPast = running && currentStep > i;
              const countKeys: (keyof PipelineCounts)[] = ['scanned', 'filtered', 'crewApproved', 'guardCleared', 'sized', 'executed'];
              const count = pipelineCounts ? pipelineCounts[countKeys[i]] : null;

              return (
                <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    padding: '14px 20px', borderRadius: 10, minWidth: 90,
                    background: isActive ? `${COLORS.purple}25` : isPast ? `${COLORS.green}15` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isActive ? COLORS.purple : isPast ? COLORS.green + '40' : COLORS.border}`,
                    transition: 'all 0.3s',
                    boxShadow: isActive ? `0 0 20px ${COLORS.purple}30` : 'none',
                  }}>
                    <span style={{
                      fontSize: 12, fontWeight: 700, letterSpacing: 1,
                      color: isActive ? COLORS.purple : isPast ? COLORS.green : COLORS.textSecondary,
                    }}>
                      {step}
                    </span>
                    {count !== null && count !== undefined && (
                      <span style={{
                        fontSize: 18, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
                        color: isActive ? COLORS.purple : isPast ? COLORS.green : COLORS.textPrimary,
                      }}>
                        {count}
                      </span>
                    )}
                  </div>
                  {i < PIPELINE_STEPS.length - 1 && (
                    <div style={{
                      width: 32, height: 2, margin: '0 2px',
                      background: isPast ? COLORS.green : isActive ? COLORS.purple : COLORS.border,
                      transition: 'background 0.3s',
                    }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Candidates Table ───────────────────────────────────────────── */}
        <div style={{
          padding: '24px', borderRadius: 12, marginBottom: 24,
          background: COLORS.surface, border: `1px solid ${COLORS.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Activity size={18} color={COLORS.cyan} />
            <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
              Candidates
            </h3>
            <span style={{ fontSize: 12, color: COLORS.textSecondary }}>
              ({candidates.length} results)
            </span>
          </div>

          {loading && candidates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Loader2 size={24} color={COLORS.purple} style={{ animation: 'spin 1s linear infinite' }} />
              <p style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 12 }}>Loading candidates...</p>
            </div>
          ) : candidates.length === 0 ? (
            <p style={{ color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', padding: 32 }}>
              No candidates yet. Run the pipeline to scan for opportunities.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Symbol', 'Score', 'Crew Verdict', 'Guard', 'Kelly Size', 'Action'].map(h => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
                        color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 1,
                        borderBottom: `1px solid ${COLORS.border}`,
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => {
                    const approved = c.status === 'approved';
                    const vs = getVerdictStyle(c.crewConsensus);
                    return (
                      <tr key={c.symbol} style={{
                        background: approved ? 'rgba(74,222,128,0.04)' : c.status === 'rejected' ? 'rgba(248,113,113,0.04)' : 'transparent',
                      }}>
                        <td style={{ padding: '12px 14px', fontWeight: 700, color: COLORS.textPrimary, fontSize: 14 }}>
                          {c.symbol}
                        </td>
                        <td style={{ padding: '12px 14px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: c.signalScore >= 70 ? COLORS.green : c.signalScore >= 50 ? COLORS.gold : COLORS.red, fontSize: 14 }}>
                          {c.signalScore}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{
                            display: 'inline-block', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                            background: vs.bg, color: vs.color,
                          }}>
                            {c.crewConsensus}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{
                            display: 'inline-block', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                            background: c.guardResult?.passed ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
                            color: c.guardResult?.passed ? COLORS.green : COLORS.red,
                          }}>
                            {c.guardResult?.passed ? 'PASS' : 'FAIL'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: COLORS.textPrimary }}>
                          {/* kellySize is dollars at risk and is null whenever
                              the sizer failed closed. The old code rendered
                              `c.kellyDollars.toLocaleString()` on a field the
                              API never sent, which threw on the first row. */}
                          {c.kellySize != null
                            ? `$${Math.round(c.kellySize).toLocaleString()}`
                            : '—'}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          {approved && (
                            <button
                              onClick={() => executeTrade(c.symbol)}
                              disabled={executing === c.symbol}
                              style={{
                                padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                                background: COLORS.purple, color: '#fff', fontSize: 12, fontWeight: 600,
                                opacity: executing === c.symbol ? 0.6 : 1,
                              }}
                            >
                              {executing === c.symbol ? 'Executing...' : 'Execute'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Execution Log ──────────────────────────────────────────────── */}
        <div style={{
          padding: '24px', borderRadius: 12, marginBottom: 24,
          background: COLORS.surface, border: `1px solid ${COLORS.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Shield size={18} color={COLORS.purple} />
            <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
              Execution Log
            </h3>
          </div>

          {loading && executions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Loader2 size={24} color={COLORS.purple} style={{ animation: 'spin 1s linear infinite' }} />
              <p style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 12 }}>Loading history...</p>
            </div>
          ) : executions.length === 0 ? (
            <p style={{ color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', padding: 32 }}>
              No executions yet.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {/* Score / Crew / Outcome / P&L used to be columns here, but
                        `autopilot_executions` stores none of them — they could only
                        ever render blank. Showing what the broker actually
                        returned instead. */}
                    {['Executed', 'Symbol', 'Side', 'Shares', 'Fill', 'Order status'].map(h => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
                        color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 1,
                        borderBottom: `1px solid ${COLORS.border}`,
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {executions.map((ex) => (
                    <tr key={ex.id}>
                      <td style={{ padding: '12px 14px', fontSize: 13, color: COLORS.textSecondary, fontFamily: 'JetBrains Mono, monospace' }}>
                        {formatExecutedAt(ex.executedAt)}
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 700, color: COLORS.textPrimary, fontSize: 14 }}>
                        {ex.symbol}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{
                          display: 'inline-block', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                          background: ex.side === 'buy' ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
                          color: ex.side === 'buy' ? COLORS.green : COLORS.red,
                        }}>
                          {ex.side.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: COLORS.textPrimary }}>
                        {ex.shares}
                      </td>
                      <td style={{ padding: '12px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: COLORS.textPrimary }}>
                        {/* null until the order fills — never format it blind. */}
                        {ex.price != null ? `$${ex.price.toFixed(2)}` : '—'}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: 12, color: COLORS.textSecondary }}>
                        {ex.orderStatus ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Performance Summary ────────────────────────────────────────── */}
        <div style={{
          padding: '24px', borderRadius: 12, marginBottom: 32,
          background: COLORS.surface, border: `1px solid ${COLORS.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <BarChart3 size={18} color={COLORS.gold} />
            <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
              Performance Summary
            </h3>
          </div>

          {loading && !performance ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Loader2 size={24} color={COLORS.purple} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : !performance ? (
            <p style={{ color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', padding: 32 }}>
              No performance data yet. Execute trades to see results.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
              {/* Wins */}
              <div style={{
                padding: '20px', borderRadius: 10, textAlign: 'center',
                background: 'rgba(74,222,128,0.06)', border: `1px solid ${COLORS.green}30`,
              }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: COLORS.textSecondary, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: 1 }}>Wins</p>
                <p style={{ fontSize: 32, fontWeight: 800, color: COLORS.green, margin: 0, fontFamily: 'JetBrains Mono, monospace' }}>{performance.wins}</p>
              </div>

              {/* Losses */}
              <div style={{
                padding: '20px', borderRadius: 10, textAlign: 'center',
                background: 'rgba(248,113,113,0.06)', border: `1px solid ${COLORS.red}30`,
              }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: COLORS.textSecondary, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: 1 }}>Losses</p>
                <p style={{ fontSize: 32, fontWeight: 800, color: COLORS.red, margin: 0, fontFamily: 'JetBrains Mono, monospace' }}>{performance.losses}</p>
              </div>

              {/* Win Rate */}
              <div style={{
                padding: '20px', borderRadius: 10, textAlign: 'center',
                background: 'rgba(138,92,246,0.06)', border: `1px solid ${COLORS.purple}30`,
              }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: COLORS.textSecondary, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: 1 }}>Win Rate</p>
                <p style={{ fontSize: 32, fontWeight: 800, color: COLORS.purple, margin: 0, fontFamily: 'JetBrains Mono, monospace' }}>{(performance.winRate * 100).toFixed(1)}%</p>
              </div>

              {/* Total P&L */}
              <div style={{
                padding: '20px', borderRadius: 10, textAlign: 'center',
                background: performance.totalPnl >= 0 ? 'rgba(74,222,128,0.06)' : 'rgba(248,113,113,0.06)',
                border: `1px solid ${performance.totalPnl >= 0 ? COLORS.green : COLORS.red}30`,
              }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: COLORS.textSecondary, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: 1 }}>Total P&L</p>
                <p style={{
                  fontSize: 32, fontWeight: 800, margin: 0, fontFamily: 'JetBrains Mono, monospace',
                  color: performance.totalPnl >= 0 ? COLORS.green : COLORS.red,
                }}>
                  {performance.totalPnl >= 0 ? '+' : ''}${performance.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>

              {/* Autopilot vs Manual */}
              <div style={{
                padding: '20px', borderRadius: 10, textAlign: 'center',
                background: 'rgba(34,211,238,0.06)', border: `1px solid ${COLORS.cyan}30`,
              }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: COLORS.textSecondary, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: 1 }}>Autopilot vs Manual</p>
                <p style={{ fontSize: 16, fontWeight: 700, color: COLORS.cyan, margin: 0 }}>Coming Soon</p>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* ── Keyframe animations ──────────────────────────────────────────── */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      </ErrorBoundary>
    </AppShell>
  );
}
