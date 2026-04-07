'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Users, Brain, Shield, Zap, Trash2 } from 'lucide-react';

interface CrewResponse {
  symbol: string;
  proposedAction: string;
  analyst: {
    thesis: string;
    conviction: number;
    keyFactors: string[];
    risks: string[];
    priceTarget: string;
  };
  riskController: {
    approval: string;
    concerns: string[];
    riskRating: string;
    maxPositionSize: string;
    stopLoss: string;
    hedge: string;
  };
  executor: {
    recommendation: string;
    executionPlan: {
      orderType: string;
      entryPrice: string;
      stopLoss: string;
      takeProfit: string;
      timeframe: string;
    };
    alternativeStrategy: string;
    kellySize: {
      shares: number;
      dollars: number;
      pctOfPortfolio: number;
    };
  };
  consensus: 'unanimous_go' | 'majority_go' | 'split' | 'unanimous_stop';
  finalVerdict: string;
  timestamp: string;
}

interface HistoryEntry {
  symbol: string;
  action: string;
  consensus: string;
  timestamp: string;
}

const COLORS = {
  bg: '#0a0a1a',
  surface: '#1a1a24',
  border: '#2a2a3a',
  purple: '#8a5cf6',
  gold: '#f0c674',
  green: '#4ade80',
  red: '#f87171',
  cyan: '#22d3ee',
  text: '#e0e0f0',
  textDim: '#8888a8',
};

const CONSENSUS_STYLES: Record<string, { bg: string; label: string }> = {
  unanimous_go: { bg: COLORS.green, label: 'UNANIMOUS GO' },
  majority_go: { bg: COLORS.gold, label: 'MAJORITY GO' },
  split: { bg: '#f97316', label: 'SPLIT DECISION' },
  unanimous_stop: { bg: COLORS.red, label: 'UNANIMOUS STOP' },
};

function getRiskColor(rating: string): string {
  const r = rating.toLowerCase();
  if (r === 'low') return COLORS.green;
  if (r === 'medium') return COLORS.gold;
  if (r === 'high') return '#f97316';
  return COLORS.red;
}

function getRecommendationColor(rec: string): string {
  const r = rec.toLowerCase();
  if (r.includes('proceed') || r.includes('go')) return COLORS.green;
  if (r.includes('modify') || r.includes('caution')) return COLORS.gold;
  return COLORS.red;
}

function ConvictionBar({ value }: { value: number }) {
  const pct = Math.min(Math.max(value, 0), 10) * 10;
  const color = pct >= 70 ? COLORS.green : pct >= 40 ? COLORS.gold : COLORS.red;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: COLORS.textDim }}>Conviction</span>
        <span style={{ fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color }}>{value}/10</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: COLORS.border, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 4,
          background: `linear-gradient(90deg, ${COLORS.red}, ${COLORS.gold}, ${COLORS.green})`,
          transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  );
}

function PulsingCard({ label, color }: { label: string; color: string }) {
  return (
    <div style={{
      background: COLORS.surface, borderRadius: 12, padding: 32,
      borderLeft: `4px solid ${color}`, border: `1px solid ${COLORS.border}`,
      borderLeftColor: color, borderLeftWidth: 4,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: 200,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: '50%', background: `${color}22`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
        animation: 'pulse 1.5s ease-in-out infinite',
      }}>
        <div style={{ width: 16, height: 16, borderRadius: '50%', background: color }} />
      </div>
      <span style={{ color: COLORS.textDim, fontSize: 14, fontWeight: 600, letterSpacing: 1 }}>{label}</span>
      <span style={{ color: COLORS.textDim, fontSize: 12, marginTop: 8 }}>Analyzing...</span>
    </div>
  );
}

export default function CrewPage() {
  const [symbol, setSymbol] = useState('');
  const [action, setAction] = useState<'buy' | 'sell'>('buy');
  const [context, setContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CrewResponse | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('crew-history');
      if (saved) setHistory(JSON.parse(saved));
    } catch {}
  }, []);

  const saveHistory = (entry: HistoryEntry) => {
    const updated = [entry, ...history].slice(0, 20);
    setHistory(updated);
    localStorage.setItem('crew-history', JSON.stringify(updated));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('crew-history');
  };

  const handleSubmit = async () => {
    if (!symbol.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const body: Record<string, string> = { symbol: symbol.toUpperCase(), action };
      if (context.trim()) body.context = context.trim();

      const res = await fetch('/api/agent-crew', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`API error ${res.status}`);

      const data: CrewResponse = await res.json();
      setResult(data);
      saveHistory({
        symbol: data.symbol,
        action: data.proposedAction || action,
        consensus: data.consensus,
        timestamp: data.timestamp || new Date().toISOString(),
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to convene the crew');
    } finally {
      setLoading(false);
    }
  };

  const cardBase = {
    background: COLORS.surface,
    borderRadius: 12,
    padding: 24,
    border: `1px solid ${COLORS.border}`,
  };

  return (
    <AppShell>
      <ErrorBoundary label="Crew">
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.1); }
        }
      `}</style>

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Header */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <Users size={28} color={COLORS.purple} />
              <h1 style={{ fontSize: 28, fontWeight: 800, color: COLORS.text, margin: 0 }}>Trading Crew</h1>
            </div>
            <p style={{ color: COLORS.textDim, fontSize: 14, margin: 0, marginLeft: 40 }}>Multi-Agent Decision Engine</p>
          </div>

          {/* Input Area */}
          <div style={{ ...cardBase, marginBottom: 24, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 180px' }}>
              <label style={{ fontSize: 12, color: COLORS.textDim, fontWeight: 600, letterSpacing: 1, display: 'block', marginBottom: 6 }}>SYMBOL</label>
              <input
                value={symbol}
                onChange={e => setSymbol(e.target.value.toUpperCase())}
                placeholder="AAPL"
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                style={{
                  background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '10px 14px',
                  color: COLORS.text, fontSize: 18, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
                  width: '100%', outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 12, color: COLORS.textDim, fontWeight: 600, letterSpacing: 1, display: 'block', marginBottom: 6 }}>ACTION</label>
              <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: `1px solid ${COLORS.border}` }}>
                {(['buy', 'sell'] as const).map(a => (
                  <button
                    key={a}
                    onClick={() => setAction(a)}
                    style={{
                      padding: '10px 20px', border: 'none', cursor: 'pointer',
                      fontWeight: 700, fontSize: 14, textTransform: 'uppercase', letterSpacing: 1,
                      background: action === a
                        ? (a === 'buy' ? COLORS.green : COLORS.red)
                        : COLORS.bg,
                      color: action === a ? '#0a0a1a' : COLORS.textDim,
                      transition: 'all 0.2s',
                    }}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: '2 1 300px' }}>
              <label style={{ fontSize: 12, color: COLORS.textDim, fontWeight: 600, letterSpacing: 1, display: 'block', marginBottom: 6 }}>CONTEXT (OPTIONAL)</label>
              <textarea
                value={context}
                onChange={e => setContext(e.target.value)}
                placeholder="Earnings tomorrow, hedging existing position..."
                rows={1}
                style={{
                  background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '10px 14px',
                  color: COLORS.text, fontSize: 13, width: '100%', outline: 'none', resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading || !symbol.trim()}
              style={{
                background: COLORS.purple, color: '#fff', border: 'none', borderRadius: 8,
                padding: '12px 28px', fontWeight: 800, fontSize: 15, cursor: loading ? 'wait' : 'pointer',
                opacity: loading || !symbol.trim() ? 0.5 : 1, whiteSpace: 'nowrap',
                transition: 'all 0.2s', letterSpacing: 0.5,
              }}
            >
              {loading ? 'Convening...' : 'Convene the Crew'}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div style={{ ...cardBase, borderColor: COLORS.red, color: COLORS.red, marginBottom: 24, fontSize: 14 }}>
              {error}
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
              <PulsingCard label="ANALYST" color={COLORS.purple} />
              <PulsingCard label="RISK CONTROLLER" color={COLORS.red} />
              <PulsingCard label="EXECUTOR" color={COLORS.gold} />
            </div>
          )}

          {/* Results */}
          {result && (
            <>
              {/* Three-column agent cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
                {/* ANALYST */}
                <div style={{ ...cardBase, borderLeft: `4px solid ${COLORS.purple}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <Brain size={18} color={COLORS.purple} />
                    <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 2, color: COLORS.purple }}>ANALYST</span>
                  </div>

                  <p style={{ color: COLORS.text, fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>{result.analyst.thesis}</p>

                  <ConvictionBar value={result.analyst.conviction} />

                  <div style={{ marginTop: 16 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: 1 }}>KEY FACTORS</span>
                    <ul style={{ margin: '8px 0 0', padding: '0 0 0 16px', listStyle: 'disc' }}>
                      {result.analyst.keyFactors.map((f, i) => (
                        <li key={i} style={{ color: COLORS.text, fontSize: 12, marginBottom: 4, lineHeight: 1.5 }}>{f}</li>
                      ))}
                    </ul>
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: 1 }}>RISKS</span>
                    <ul style={{ margin: '8px 0 0', padding: '0 0 0 16px', listStyle: 'disc' }}>
                      {result.analyst.risks.map((r, i) => (
                        <li key={i} style={{ color: COLORS.red, fontSize: 12, marginBottom: 4, lineHeight: 1.5 }}>{r}</li>
                      ))}
                    </ul>
                  </div>

                  <div style={{ marginTop: 20, padding: '12px 16px', background: `${COLORS.purple}11`, borderRadius: 8, textAlign: 'center' }}>
                    <span style={{ fontSize: 11, color: COLORS.textDim, fontWeight: 600, display: 'block', marginBottom: 4 }}>PRICE TARGET</span>
                    <span style={{ fontSize: 28, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: COLORS.purple }}>{result.analyst.priceTarget}</span>
                  </div>
                </div>

                {/* RISK CONTROLLER */}
                <div style={{ ...cardBase, borderLeft: `4px solid ${COLORS.red}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <Shield size={18} color={COLORS.red} />
                    <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 2, color: COLORS.red }}>RISK CONTROLLER</span>
                  </div>

                  {/* Approval Badge */}
                  <div style={{
                    display: 'inline-block', padding: '6px 16px', borderRadius: 6, fontWeight: 800, fontSize: 13, letterSpacing: 1,
                    background: result.riskController.approval.toLowerCase().includes('approved')
                      ? `${COLORS.green}22` : `${COLORS.red}22`,
                    color: result.riskController.approval.toLowerCase().includes('approved')
                      ? COLORS.green : COLORS.red,
                    marginBottom: 16,
                  }}>
                    {result.riskController.approval.toUpperCase()}
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: 1 }}>CONCERNS</span>
                    <ol style={{ margin: '8px 0 0', padding: '0 0 0 20px' }}>
                      {result.riskController.concerns.map((c, i) => (
                        <li key={i} style={{ color: COLORS.text, fontSize: 12, marginBottom: 4, lineHeight: 1.5 }}>{c}</li>
                      ))}
                    </ol>
                  </div>

                  {/* Risk Rating Badge */}
                  <div style={{ marginBottom: 16 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: 1, display: 'block', marginBottom: 6 }}>RISK RATING</span>
                    <span style={{
                      display: 'inline-block', padding: '4px 12px', borderRadius: 4,
                      fontWeight: 800, fontSize: 12, letterSpacing: 1,
                      background: `${getRiskColor(result.riskController.riskRating)}22`,
                      color: getRiskColor(result.riskController.riskRating),
                    }}>
                      {result.riskController.riskRating.toUpperCase()}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[
                      { label: 'MAX POSITION SIZE', value: result.riskController.maxPositionSize },
                      { label: 'STOP LOSS', value: result.riskController.stopLoss },
                      { label: 'HEDGE SUGGESTION', value: result.riskController.hedge },
                    ].map(item => (
                      <div key={item.label} style={{ padding: '10px 14px', background: `${COLORS.red}08`, borderRadius: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.textDim, letterSpacing: 1, display: 'block', marginBottom: 4 }}>{item.label}</span>
                        <span style={{ fontSize: 13, color: COLORS.text, fontFamily: "'JetBrains Mono', monospace" }}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* EXECUTOR */}
                <div style={{ ...cardBase, borderLeft: `4px solid ${COLORS.gold}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <Zap size={18} color={COLORS.gold} />
                    <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 2, color: COLORS.gold }}>EXECUTOR</span>
                  </div>

                  {/* Recommendation Badge */}
                  <div style={{
                    display: 'inline-block', padding: '6px 16px', borderRadius: 6, fontWeight: 800, fontSize: 13, letterSpacing: 1,
                    background: `${getRecommendationColor(result.executor.recommendation)}22`,
                    color: getRecommendationColor(result.executor.recommendation),
                    marginBottom: 16,
                  }}>
                    {result.executor.recommendation.toUpperCase()}
                  </div>

                  {/* Execution Plan */}
                  <div style={{ marginBottom: 16 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: 1, display: 'block', marginBottom: 8 }}>EXECUTION PLAN</span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {[
                        { label: 'Order Type', value: result.executor.executionPlan.orderType },
                        { label: 'Entry', value: result.executor.executionPlan.entryPrice },
                        { label: 'Stop Loss', value: result.executor.executionPlan.stopLoss },
                        { label: 'Take Profit', value: result.executor.executionPlan.takeProfit },
                        { label: 'Timeframe', value: result.executor.executionPlan.timeframe },
                      ].map(item => (
                        <div key={item.label} style={{ padding: '8px 10px', background: `${COLORS.gold}08`, borderRadius: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.textDim, letterSpacing: 1, display: 'block', marginBottom: 2 }}>{item.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, fontFamily: "'JetBrains Mono', monospace" }}>{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Kelly Size */}
                  <div style={{ marginBottom: 16 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, letterSpacing: 1, display: 'block', marginBottom: 8 }}>KELLY SIZING</span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <div style={{ textAlign: 'center', padding: '10px 6px', background: `${COLORS.gold}11`, borderRadius: 8 }}>
                        <span style={{ fontSize: 10, color: COLORS.textDim, fontWeight: 600, display: 'block', marginBottom: 4 }}>SHARES</span>
                        <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: COLORS.gold }}>
                          {result.executor.kellySize.shares}
                        </span>
                      </div>
                      <div style={{ textAlign: 'center', padding: '10px 6px', background: `${COLORS.gold}11`, borderRadius: 8 }}>
                        <span style={{ fontSize: 10, color: COLORS.textDim, fontWeight: 600, display: 'block', marginBottom: 4 }}>DOLLARS</span>
                        <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: COLORS.gold }}>
                          ${result.executor.kellySize.dollars.toLocaleString()}
                        </span>
                      </div>
                      <div style={{ textAlign: 'center', padding: '10px 6px', background: `${COLORS.gold}11`, borderRadius: 8 }}>
                        <span style={{ fontSize: 10, color: COLORS.textDim, fontWeight: 600, display: 'block', marginBottom: 4 }}>% PORT</span>
                        <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: COLORS.gold }}>
                          {result.executor.kellySize.pctOfPortfolio}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Alternative Strategy */}
                  <div style={{ padding: '10px 14px', background: `${COLORS.gold}08`, borderRadius: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.textDim, letterSpacing: 1, display: 'block', marginBottom: 4 }}>ALTERNATIVE STRATEGY</span>
                    <span style={{ fontSize: 12, color: COLORS.text, lineHeight: 1.5 }}>{result.executor.alternativeStrategy}</span>
                  </div>
                </div>
              </div>

              {/* Consensus Banner */}
              {(() => {
                const cs = CONSENSUS_STYLES[result.consensus] || CONSENSUS_STYLES.split;
                const isDark = result.consensus === 'unanimous_go' || result.consensus === 'unanimous_stop';
                return (
                  <div style={{
                    background: cs.bg, borderRadius: 12, padding: '20px 32px', marginBottom: 24,
                    textAlign: 'center',
                  }}>
                    <span style={{
                      fontSize: 24, fontWeight: 900, letterSpacing: 4,
                      color: isDark ? '#0a0a1a' : '#0a0a1a',
                    }}>
                      {cs.label}
                    </span>
                  </div>
                );
              })()}

              {/* Final Verdict */}
              <div style={{
                ...cardBase, borderColor: COLORS.purple, padding: 28,
                background: `linear-gradient(135deg, ${COLORS.surface}, ${COLORS.purple}11)`,
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.purple, letterSpacing: 2, display: 'block', marginBottom: 12 }}>FINAL VERDICT</span>
                <p style={{ color: COLORS.text, fontSize: 15, lineHeight: 1.7, margin: 0, fontWeight: 500 }}>{result.finalVerdict}</p>
                <div style={{ marginTop: 12, fontSize: 11, color: COLORS.textDim }}>
                  {result.symbol} {result.proposedAction?.toUpperCase()} &mdash; {new Date(result.timestamp).toLocaleString()}
                </div>
              </div>
            </>
          )}
        </div>

        {/* History Sidebar */}
        {showHistory && (
          <div style={{ width: 240, flexShrink: 0 }}>
            <div style={{ ...cardBase, position: 'sticky', top: 80 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.textDim, letterSpacing: 1 }}>HISTORY</span>
                {history.length > 0 && (
                  <button
                    onClick={clearHistory}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.textDim, padding: 4 }}
                    title="Clear history"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <p style={{ color: COLORS.textDim, fontSize: 12, margin: 0 }}>No sessions yet</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {history.map((h, i) => {
                    const cs = CONSENSUS_STYLES[h.consensus];
                    return (
                      <button
                        key={i}
                        onClick={() => { setSymbol(h.symbol); setAction(h.action as 'buy' | 'sell'); }}
                        style={{
                          background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8,
                          padding: '10px 12px', cursor: 'pointer', textAlign: 'left', width: '100%',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 14, color: COLORS.text }}>
                            {h.symbol}
                          </span>
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                            background: h.action === 'buy' ? `${COLORS.green}22` : `${COLORS.red}22`,
                            color: h.action === 'buy' ? COLORS.green : COLORS.red,
                          }}>
                            {h.action.toUpperCase()}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: cs?.bg || COLORS.textDim }}>
                            {cs?.label || h.consensus}
                          </span>
                          <span style={{ fontSize: 9, color: COLORS.textDim }}>
                            {new Date(h.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </ErrorBoundary>
    </AppShell>
  );
}
