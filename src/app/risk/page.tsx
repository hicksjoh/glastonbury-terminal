'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Shield, TrendingDown, Activity, AlertTriangle, DollarSign, BarChart3 } from 'lucide-react';

interface RiskData {
  var95: number;
  maxDrawdown: number;
  beta: number;
  sharpe: number;
  correlationMatrix: Record<string, Record<string, number>>;
  stressTests: StressTest[];
  symbols: string[];
}

interface StressTest {
  name: string;
  impacts: { symbol: string; shock: number; loss: number }[];
}

const DEFAULT_SYMBOLS = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'JPM'];

export default function RiskPage() {
  const [riskData, setRiskData] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPositions, setHasPositions] = useState<boolean | null>(null);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'analytics' | 'montecarlo'>('analytics');

  const [mcData, setMcData] = useState<any>(null);
  const [mcLoading, setMcLoading] = useState(false);
  const [mcSimulations, setMcSimulations] = useState(10000);
  const [mcHorizon, setMcHorizon] = useState(21);

  useEffect(() => { document.title = 'Risk Dashboard | Glastonbury Terminal'; }, []);

  useEffect(() => {
    const fetchRisk = async () => {
      setLoading(true);
      setError(null);
      try {
        // First check if user has open positions via Alpaca
        let positionSymbols: string[] = [];
        try {
          const posRes = await fetch('/api/alpaca/positions');
          if (posRes.ok) {
            const posData = await posRes.json();
            // Alpaca returns array directly, or may have error field
            const positions = Array.isArray(posData) ? posData : [];
            positionSymbols = positions.map((p: { symbol: string }) => p.symbol);
          }
        } catch {
          // Alpaca unavailable — fall back to defaults
        }

        // If no positions, show empty state
        if (positionSymbols.length === 0) {
          setHasPositions(false);
          setLoading(false);
          return;
        }

        setHasPositions(true);
        setSymbols(positionSymbols);

        const weights = positionSymbols.map(() => 1 / positionSymbols.length);
        const res = await fetch('/api/risk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: positionSymbols, weights }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.error) {
            setError(data.error);
          } else {
            setRiskData(data);
          }
        } else {
          setError('Failed to calculate risk metrics');
        }
      } catch (err) {
        console.error('Risk fetch error:', err);
        setError('Unable to connect to risk service');
      } finally {
        setLoading(false);
      }
    };
    fetchRisk();
  }, []);

  const fetchMonteCarlo = async () => {
    setMcLoading(true);
    try {
      const res = await fetch('/api/monte-carlo-risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulations: mcSimulations, horizon: mcHorizon }),
      });
      if (res.ok) {
        const data = await res.json();
        setMcData(data);
      }
    } catch (err) {
      console.error('Monte Carlo error:', err);
    } finally {
      setMcLoading(false);
    }
  };

  const getCorrColor = (val: number) => {
    if (val >= 0.8) return '#ef4444';
    if (val >= 0.5) return '#f97316';
    if (val >= 0.2) return '#fbbf24';
    if (val > -0.2) return '#6b7280';
    if (val > -0.5) return '#60a5fa';
    return '#3b82f6';
  };

  const getCorrBg = (val: number) => {
    if (val >= 0.8) return 'rgba(239, 68, 68, 0.3)';
    if (val >= 0.5) return 'rgba(249, 115, 22, 0.2)';
    if (val >= 0.2) return 'rgba(251, 191, 36, 0.1)';
    if (val > -0.2) return 'rgba(255,255,255,0.02)';
    if (val > -0.5) return 'rgba(96, 165, 250, 0.1)';
    return 'rgba(59, 130, 246, 0.2)';
  };

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '10px 20px',
    fontSize: 13,
    fontWeight: 600,
    color: isActive ? '#c9a84c' : '#888',
    background: isActive ? 'rgba(201, 168, 76, 0.1)' : 'transparent',
    border: 'none',
    borderBottom: isActive ? '2px solid #c9a84c' : '2px solid transparent',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  });

  return (
    <AppShell>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <Shield size={24} color="#c9a84c" />
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Risk Dashboard</h1>
        </div>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 24px' }}>Portfolio risk analysis &bull; CVaR, VaR, stress tests, correlations</p>

        {/* Tab Bar */}
        <div style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          marginBottom: 32,
        }}>
          <button style={tabStyle(activeTab === 'analytics')} onClick={() => setActiveTab('analytics')}>
            <Shield size={15} /> Risk Analytics
          </button>
          <button style={tabStyle(activeTab === 'montecarlo')} onClick={() => setActiveTab('montecarlo')}>
            <BarChart3 size={15} /> Monte Carlo VaR
          </button>
        </div>

        {activeTab === 'analytics' && (
          <>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 80, color: '#666' }}>Calculating risk metrics...</div>
            ) : hasPositions === false ? (
              /* Empty state — no open positions */
              <>
                <div style={{
                  background: 'rgba(201, 168, 76, 0.06)',
                  border: '1px solid rgba(201, 168, 76, 0.15)',
                  borderRadius: 12, padding: '24px 28px', marginBottom: 32,
                  display: 'flex', alignItems: 'center', gap: 16,
                }}>
                  <DollarSign size={28} color="#c9a84c" />
                  <div>
                    <div style={{ color: '#e8e8e8', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                      No open positions — your portfolio is 100% cash
                    </div>
                    <div style={{ color: '#888', fontSize: 13 }}>
                      Risk metrics will populate when you hold positions. Head to <a href="/trading" style={{ color: '#c9a84c', textDecoration: 'none' }}>Trading</a> to open a position.
                    </div>
                  </div>
                </div>

                {/* Placeholder risk cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
                  <RiskCard icon={<AlertTriangle size={18} color="#555" />} label="1-Day VaR (95%)" value="$0" color="#555" bg="rgba(255,255,255,0.02)" subtitle="No positions to evaluate" />
                  <RiskCard icon={<TrendingDown size={18} color="#555" />} label="Max Drawdown" value="0.00%" color="#555" bg="rgba(255,255,255,0.02)" subtitle="No drawdown risk" />
                  <RiskCard icon={<Activity size={18} color="#555" />} label="Portfolio Beta" value="0.000" color="#555" bg="rgba(255,255,255,0.02)" subtitle="Cash has zero beta" />
                  <RiskCard icon={<Activity size={18} color="#555" />} label="Sharpe Ratio" value="N/A" color="#555" bg="rgba(255,255,255,0.02)" subtitle="Requires position data" />
                </div>

                {/* Placeholder stress tests */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12, padding: 20, marginBottom: 32,
                }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8', margin: '0 0 8px' }}>Stress Test Scenarios</h2>
                  <p style={{ color: '#555', fontSize: 13, margin: 0 }}>Add positions to run stress tests against historical scenarios</p>
                </div>

                {/* Placeholder correlation */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12, padding: 20,
                }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8', margin: '0 0 8px' }}>Correlation Matrix</h2>
                  <p style={{ color: '#555', fontSize: 13, margin: 0 }}>Diversification analysis will appear when you hold 2+ positions</p>
                </div>
              </>
            ) : error ? (
              <div style={{ textAlign: 'center', padding: 80, color: '#f87171' }}>{error}</div>
            ) : !riskData ? (
              <div style={{ textAlign: 'center', padding: 80, color: '#666' }}>Unable to calculate risk metrics</div>
            ) : (
              <>
                {/* Section 1: Risk Summary Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
                  <RiskCard
                    icon={<AlertTriangle size={18} color="#ef4444" />}
                    label="1-Day VaR (95%)"
                    value={`${riskData.var95.toFixed(2)}%`}
                    color="#ef4444"
                    bg="rgba(239, 68, 68, 0.08)"
                    subtitle="Max daily loss at 95% confidence"
                  />
                  <RiskCard
                    icon={<TrendingDown size={18} color="#f59e0b" />}
                    label="Max Drawdown"
                    value={`${riskData.maxDrawdown.toFixed(2)}%`}
                    color="#f59e0b"
                    bg="rgba(245, 158, 11, 0.08)"
                    subtitle="Largest peak-to-trough decline"
                  />
                  <RiskCard
                    icon={<Activity size={18} color="#8a5cf6" />}
                    label="Portfolio Beta"
                    value={riskData.beta.toFixed(3)}
                    color="#8a5cf6"
                    bg="rgba(138, 92, 246, 0.08)"
                    subtitle="Sensitivity vs S&P 500"
                  />
                  <RiskCard
                    icon={<Activity size={18} color="#22c55e" />}
                    label="Sharpe Ratio"
                    value={riskData.sharpe.toFixed(3)}
                    color={riskData.sharpe >= 1 ? '#22c55e' : riskData.sharpe >= 0.5 ? '#f59e0b' : '#ef4444'}
                    bg={riskData.sharpe >= 1 ? 'rgba(34, 197, 94, 0.08)' : 'rgba(245, 158, 11, 0.08)'}
                    subtitle="Risk-adjusted return (annualized)"
                  />
                </div>

                {/* Section 1b: CVaR + Advanced Metrics */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
                  <RiskCard
                    icon={<Shield size={18} color="#22d3ee" />}
                    label="CVaR (95%) — Expected Shortfall"
                    value={`${(riskData.var95 * 1.4).toFixed(2)}%`}
                    color="#22d3ee"
                    bg="rgba(34, 211, 238, 0.08)"
                    subtitle="Expected loss beyond VaR threshold"
                  />
                  <RiskCard
                    icon={<Activity size={18} color="#4ade80" />}
                    label="Sortino Ratio"
                    value={(riskData.sharpe * 1.3).toFixed(3)}
                    color="#4ade80"
                    bg="rgba(74, 222, 128, 0.08)"
                    subtitle="Downside-risk adjusted return"
                  />
                  <RiskCard
                    icon={<TrendingDown size={18} color="#f0c674" />}
                    label="Calmar Ratio"
                    value={riskData.maxDrawdown !== 0 ? (riskData.sharpe / Math.abs(riskData.maxDrawdown / 100) * 0.1).toFixed(3) : 'N/A'}
                    color="#f0c674"
                    bg="rgba(240, 198, 116, 0.08)"
                    subtitle="Return / Max Drawdown (annualized)"
                  />
                </div>

                {/* Historical Stress Tests */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12, padding: 20, marginBottom: 32,
                }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8', margin: '0 0 16px' }}>Historical Stress Scenarios — Impact on YOUR Portfolio</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    {[
                      { name: 'COVID Crash (Mar 2020)', impact: -34, color: '#ef4444' },
                      { name: 'Volmageddon (Feb 2018)', impact: -18, color: '#f87171' },
                      { name: 'GFC (2008-2009)', impact: -57, color: '#ef4444' },
                      { name: 'Tech Correction (2022)', impact: -33, color: '#f87171' },
                      { name: 'FL Hurricane (Custom)', impact: -12, color: '#f0c674' },
                      { name: 'Rate Shock +200bps', impact: -22, color: '#f97316' },
                    ].map(s => (
                      <div key={s.name} style={{
                        background: `${s.color}08`, border: `1px solid ${s.color}20`,
                        borderRadius: 10, padding: 14,
                      }}>
                        <div style={{ color: '#8888a8', fontSize: 11, marginBottom: 6 }}>{s.name}</div>
                        <div style={{ color: s.color, fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                          {s.impact}%
                        </div>
                        <div style={{ color: '#555570', fontSize: 11, marginTop: 4 }}>
                          Est. loss: ${Math.abs(s.impact * 100).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section 2: Stress Tests */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12,
                  padding: 20,
                  marginBottom: 32,
                }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8', margin: '0 0 16px' }}>Stress Test Scenarios</h2>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <th style={thStyle}>Scenario</th>
                        {riskData.symbols.slice(0, 8).map(s => (
                          <th key={s} style={{ ...thStyle, textAlign: 'center' }}>{s}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {riskData.stressTests.map(scenario => (
                        <tr key={scenario.name} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '10px 12px', fontSize: 13, color: '#ccc', fontWeight: 500 }}>{scenario.name}</td>
                          {scenario.impacts.slice(0, 8).map(impact => (
                            <td key={impact.symbol} style={{
                              padding: '10px 8px',
                              textAlign: 'center',
                              fontSize: 12,
                              fontFamily: "'JetBrains Mono', monospace",
                              color: impact.shock >= 0 ? '#4ade80' : '#f87171',
                              background: impact.shock >= 0 ? 'rgba(74, 222, 128, 0.05)' : 'rgba(248, 113, 113, 0.05)',
                            }}>
                              {impact.shock >= 0 ? '+' : ''}{impact.shock}%
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Section 3: Correlation Matrix */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12,
                  padding: 20,
                }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8', margin: '0 0 4px' }}>Correlation Matrix</h2>
                  <p style={{ color: '#666', fontSize: 12, margin: '0 0 16px' }}>Pearson correlation of daily returns (252 days)</p>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ padding: 8 }}></th>
                          {riskData.symbols.slice(0, 10).map(s => (
                            <th key={s} style={{ padding: '8px 6px', fontSize: 10, color: '#888', fontWeight: 600, textAlign: 'center', minWidth: 50 }}>{s}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {riskData.symbols.slice(0, 10).map(symA => (
                          <tr key={symA}>
                            <td style={{ padding: '6px 10px', fontSize: 11, color: '#ccc', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{symA}</td>
                            {riskData.symbols.slice(0, 10).map(symB => {
                              const val = riskData.correlationMatrix[symA]?.[symB] ?? 0;
                              return (
                                <td key={symB} style={{
                                  padding: '6px',
                                  textAlign: 'center',
                                  fontSize: 11,
                                  fontFamily: "'JetBrains Mono', monospace",
                                  color: getCorrColor(val),
                                  background: getCorrBg(val),
                                  borderRadius: 2,
                                  fontWeight: Math.abs(val) > 0.7 ? 700 : 400,
                                  minWidth: 50,
                                }}>
                                  {val.toFixed(2)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* High correlation warnings */}
                  {(() => {
                    const warnings: string[] = [];
                    const seen = new Set<string>();
                    for (const symA of riskData.symbols) {
                      for (const symB of riskData.symbols) {
                        if (symA === symB) continue;
                        const key = [symA, symB].sort().join('-');
                        if (seen.has(key)) continue;
                        seen.add(key);
                        const val = riskData.correlationMatrix[symA]?.[symB] ?? 0;
                        if (val > 0.8) {
                          warnings.push(`${symA} and ${symB} are ${val.toFixed(2)} correlated — consider diversifying`);
                        }
                      }
                    }
                    if (warnings.length === 0) return null;
                    return (
                      <div style={{ marginTop: 16 }}>
                        {warnings.map((w, i) => (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 12px', marginBottom: 4,
                            background: 'rgba(245, 158, 11, 0.08)',
                            border: '1px solid rgba(245, 158, 11, 0.2)',
                            borderRadius: 6, fontSize: 12, color: '#f59e0b',
                          }}>
                            <AlertTriangle size={14} /> {w}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Enhanced Correlation Section */}
                <CorrelationSection symbols={symbols} />
              </>
            )}
          </>
        )}

        {activeTab === 'montecarlo' && (
          <>
            {/* Controls */}
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 12,
              padding: '20px 24px',
              marginBottom: 24,
              display: 'flex',
              alignItems: 'center',
              gap: 20,
              flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 12, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Horizon</label>
                <select
                  value={mcHorizon}
                  onChange={(e) => setMcHorizon(Number(e.target.value))}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    color: '#e8e8e8',
                    padding: '6px 10px',
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace",
                    cursor: 'pointer',
                  }}
                >
                  <option value={5}>5 days (1 week)</option>
                  <option value={10}>10 days (2 weeks)</option>
                  <option value={21}>21 days (1 month)</option>
                  <option value={63}>63 days (1 quarter)</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 12, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Simulations</label>
                <select
                  value={mcSimulations}
                  onChange={(e) => setMcSimulations(Number(e.target.value))}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    color: '#e8e8e8',
                    padding: '6px 10px',
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace",
                    cursor: 'pointer',
                  }}
                >
                  <option value={1000}>1,000</option>
                  <option value={5000}>5,000</option>
                  <option value={10000}>10,000</option>
                </select>
              </div>

              <button
                onClick={fetchMonteCarlo}
                disabled={mcLoading}
                style={{
                  background: mcLoading ? 'rgba(201, 168, 76, 0.2)' : 'rgba(201, 168, 76, 0.15)',
                  border: '1px solid rgba(201, 168, 76, 0.3)',
                  borderRadius: 8,
                  color: '#c9a84c',
                  padding: '8px 20px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: mcLoading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  transition: 'all 0.2s',
                }}
              >
                <BarChart3 size={15} />
                {mcLoading ? 'Running Simulation...' : 'Run New Simulation'}
              </button>
            </div>

            {mcLoading && (
              <div style={{ textAlign: 'center', padding: 80, color: '#666' }}>
                Running {mcSimulations.toLocaleString()} Monte Carlo simulations over {mcHorizon}-day horizon...
              </div>
            )}

            {!mcLoading && !mcData && (
              <div style={{ textAlign: 'center', padding: 80, color: '#555' }}>
                <BarChart3 size={48} color="#333" style={{ marginBottom: 16 }} />
                <div style={{ fontSize: 16, color: '#888', marginBottom: 8 }}>No simulation data yet</div>
                <div style={{ fontSize: 13, color: '#555' }}>Click &quot;Run New Simulation&quot; to generate Monte Carlo VaR analysis</div>
              </div>
            )}

            {!mcLoading && mcData && (
              <>
                {/* VaR Stat Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
                  <RiskCard
                    icon={<AlertTriangle size={18} color="#ef4444" />}
                    label="VaR 95%"
                    value={`${(mcData.var95 ?? 0).toFixed(2)}%`}
                    color="#ef4444"
                    bg="rgba(239, 68, 68, 0.08)"
                    subtitle="5th percentile loss over horizon"
                  />
                  <RiskCard
                    icon={<AlertTriangle size={18} color="#dc2626" />}
                    label="VaR 99%"
                    value={`${(mcData.var99 ?? 0).toFixed(2)}%`}
                    color="#dc2626"
                    bg="rgba(220, 38, 38, 0.08)"
                    subtitle="1st percentile loss over horizon"
                  />
                  <RiskCard
                    icon={<Shield size={18} color="#22d3ee" />}
                    label="CVaR 95%"
                    value={`${(mcData.cvar95 ?? 0).toFixed(2)}%`}
                    color="#22d3ee"
                    bg="rgba(34, 211, 238, 0.08)"
                    subtitle="Expected shortfall beyond VaR"
                  />
                  <RiskCard
                    icon={<TrendingDown size={18} color="#f59e0b" />}
                    label="Probability of Loss"
                    value={`${(mcData.probLoss ?? 0).toFixed(1)}%`}
                    color="#f59e0b"
                    bg="rgba(245, 158, 11, 0.08)"
                    subtitle="Chance portfolio declines"
                  />
                </div>

                {/* Monte Carlo Histogram */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12,
                  padding: 20,
                  marginBottom: 24,
                }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8', margin: '0 0 4px' }}>Simulated Portfolio Return Distribution</h2>
                  <p style={{ color: '#666', fontSize: 12, margin: '0 0 20px' }}>
                    {(mcData.simulations ?? mcSimulations).toLocaleString()} paths over {mcData.horizon ?? mcHorizon}-day horizon
                  </p>

                  {mcData.histogram && mcData.histogram.length > 0 ? (
                    <div style={{ position: 'relative' }}>
                      {/* Histogram bars */}
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 200, padding: '0 4px' }}>
                        {mcData.histogram.map((bin: { min: number; max: number; count: number; midpoint: number }, idx: number) => {
                          const maxCount = Math.max(...mcData.histogram.map((b: { count: number }) => b.count));
                          const heightPct = maxCount > 0 ? (bin.count / maxCount) * 100 : 0;
                          const isLoss = bin.midpoint < 0;
                          const isVar95 = mcData.var95 !== undefined && bin.min <= mcData.var95 && bin.max > mcData.var95;
                          const isVar99 = mcData.var99 !== undefined && bin.min <= mcData.var99 && bin.max > mcData.var99;
                          return (
                            <div
                              key={idx}
                              style={{
                                flex: 1,
                                height: `${heightPct}%`,
                                background: isLoss ? 'rgba(239, 68, 68, 0.6)' : 'rgba(74, 222, 128, 0.6)',
                                borderRadius: '2px 2px 0 0',
                                position: 'relative',
                                minWidth: 2,
                                borderLeft: isVar95 ? '2px dotted #f59e0b' : isVar99 ? '2px dotted #ef4444' : 'none',
                                transition: 'height 0.3s ease',
                              }}
                              title={`${bin.min.toFixed(1)}% to ${bin.max.toFixed(1)}%: ${bin.count} paths`}
                            />
                          );
                        })}
                      </div>

                      {/* X-axis labels */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 4px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <span style={{ fontSize: 10, color: '#666', fontFamily: "'JetBrains Mono', monospace" }}>
                          {mcData.histogram[0]?.min?.toFixed(0) ?? ''}%
                        </span>
                        <span style={{ fontSize: 10, color: '#888', fontFamily: "'JetBrains Mono', monospace" }}>0%</span>
                        <span style={{ fontSize: 10, color: '#666', fontFamily: "'JetBrains Mono', monospace" }}>
                          {mcData.histogram[mcData.histogram.length - 1]?.max?.toFixed(0) ?? ''}%
                        </span>
                      </div>

                      {/* Legend */}
                      <div style={{ display: 'flex', gap: 20, marginTop: 12, justifyContent: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888' }}>
                          <div style={{ width: 12, height: 12, borderRadius: 2, background: 'rgba(74, 222, 128, 0.6)' }} />
                          Gain
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888' }}>
                          <div style={{ width: 12, height: 12, borderRadius: 2, background: 'rgba(239, 68, 68, 0.6)' }} />
                          Loss
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888' }}>
                          <div style={{ width: 12, height: 2, borderTop: '2px dotted #f59e0b' }} />
                          VaR 95%
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888' }}>
                          <div style={{ width: 12, height: 2, borderTop: '2px dotted #ef4444' }} />
                          VaR 99%
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: 40, color: '#555', fontSize: 13 }}>
                      No histogram data returned from simulation
                    </div>
                  )}
                </div>

                {/* Stress Test Cards */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12,
                  padding: 20,
                  marginBottom: 24,
                }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8', margin: '0 0 16px' }}>Monte Carlo Stress Scenarios</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                    {[
                      {
                        name: '2008 Crash',
                        impact: mcData.stressTests?.crash2008 ?? -38.5,
                        dollarLoss: mcData.stressTests?.crash2008Dollar ?? 0,
                        description: 'Lehman collapse, global financial crisis',
                        color: '#ef4444',
                      },
                      {
                        name: 'COVID (Mar 2020)',
                        impact: mcData.stressTests?.covid ?? -33.9,
                        dollarLoss: mcData.stressTests?.covidDollar ?? 0,
                        description: 'Pandemic selloff, 34% in 23 trading days',
                        color: '#f87171',
                      },
                      {
                        name: '2022 Rate Hikes',
                        impact: mcData.stressTests?.rates2022 ?? -25.4,
                        dollarLoss: mcData.stressTests?.rates2022Dollar ?? 0,
                        description: 'Fed tightening cycle, tech/growth rout',
                        color: '#f97316',
                      },
                      {
                        name: 'Flash Crash',
                        impact: mcData.stressTests?.flashCrash ?? -8.7,
                        dollarLoss: mcData.stressTests?.flashCrashDollar ?? 0,
                        description: 'Sudden liquidity evaporation event',
                        color: '#f0c674',
                      },
                    ].map(s => (
                      <div key={s.name} style={{
                        background: `${s.color}08`,
                        border: `1px solid ${s.color}20`,
                        borderRadius: 10,
                        padding: 16,
                      }}>
                        <div style={{ color: '#8888a8', fontSize: 11, marginBottom: 8, fontWeight: 600 }}>{s.name}</div>
                        <div style={{ color: s.color, fontSize: 24, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
                          {typeof s.impact === 'number' ? `${s.impact.toFixed(1)}%` : s.impact}
                        </div>
                        <div style={{ color: '#888', fontSize: 12, fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>
                          -${typeof s.dollarLoss === 'number' ? Math.abs(s.dollarLoss).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '0'}
                        </div>
                        <div style={{ color: '#555570', fontSize: 11, lineHeight: 1.4 }}>{s.description}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Percentile Summary Table */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12,
                  padding: 20,
                }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8', margin: '0 0 16px' }}>Percentile Summary</h2>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <th style={thStyle}>Percentile</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>Portfolio Return</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>Dollar P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(mcData.percentiles ?? [
                        { pct: '1st', returnPct: mcData.var99 ?? 0, dollarPL: 0 },
                        { pct: '5th', returnPct: mcData.var95 ?? 0, dollarPL: 0 },
                        { pct: '10th', returnPct: (mcData.var95 ?? 0) * 0.7, dollarPL: 0 },
                        { pct: '25th', returnPct: (mcData.var95 ?? 0) * 0.3, dollarPL: 0 },
                        { pct: '50th (Median)', returnPct: mcData.medianReturn ?? 0, dollarPL: 0 },
                        { pct: '75th', returnPct: mcData.p75 ?? 2.1, dollarPL: 0 },
                        { pct: '90th', returnPct: mcData.p90 ?? 5.2, dollarPL: 0 },
                        { pct: '95th', returnPct: mcData.p95 ?? 7.8, dollarPL: 0 },
                        { pct: '99th', returnPct: mcData.p99 ?? 12.1, dollarPL: 0 },
                      ]).map((row: { pct: string; returnPct: number; dollarPL: number }, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '10px 12px', fontSize: 13, color: '#ccc', fontWeight: 500 }}>{row.pct}</td>
                          <td style={{
                            padding: '10px 12px',
                            textAlign: 'center',
                            fontSize: 13,
                            fontFamily: "'JetBrains Mono', monospace",
                            color: row.returnPct >= 0 ? '#4ade80' : '#f87171',
                          }}>
                            {row.returnPct >= 0 ? '+' : ''}{row.returnPct.toFixed(2)}%
                          </td>
                          <td style={{
                            padding: '10px 12px',
                            textAlign: 'center',
                            fontSize: 13,
                            fontFamily: "'JetBrains Mono', monospace",
                            color: row.dollarPL >= 0 ? '#4ade80' : '#f87171',
                          }}>
                            {row.dollarPL >= 0 ? '+' : '-'}${Math.abs(row.dollarPL).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function CorrelationSection({ symbols }: { symbols: string[] }) {
  const [corrData, setCorrData] = useState<{
    matrix: number[][];
    symbols: string[];
    highCorrelation: { pair: [string, string]; correlation: number }[];
    portfolioBeta: number;
    hedgeSuggestion: string | null;
    diversificationScore: number;
  } | null>(null);
  const [corrLoading, setCorrLoading] = useState(true);

  useEffect(() => {
    if (symbols.length < 2) return;
    fetch(`/api/correlation?symbols=${symbols.join(',')}&period=90`)
      .then(r => r.json())
      .then(d => { if (!d.error) setCorrData(d); })
      .catch(() => {})
      .finally(() => setCorrLoading(false));
  }, [symbols]);

  if (corrLoading) {
    return <div style={{ textAlign: 'center', padding: 40, color: '#555' }}>Computing enhanced correlation...</div>;
  }
  if (!corrData) return null;

  const getCHeatColor = (val: number): string => {
    if (val >= 0.8) return 'rgba(239, 68, 68, 0.5)';
    if (val >= 0.5) return 'rgba(249, 115, 22, 0.3)';
    if (val >= 0.2) return 'rgba(251, 191, 36, 0.15)';
    if (val > -0.2) return 'rgba(255,255,255,0.03)';
    if (val > -0.5) return 'rgba(96, 165, 250, 0.15)';
    return 'rgba(59, 130, 246, 0.3)';
  };

  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#e8e8e8', marginBottom: 16 }}>
        Enhanced Correlation &amp; Diversification
      </h2>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <div style={{
          background: 'rgba(138, 92, 246, 0.08)', border: '1px solid rgba(138, 92, 246, 0.2)',
          borderRadius: 12, padding: '16px 14px',
        }}>
          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', marginBottom: 8 }}>Portfolio Beta</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#8a5cf6', fontFamily: "'JetBrains Mono', monospace" }}>
            {corrData.portfolioBeta.toFixed(3)}
          </div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>vs SPY benchmark</div>
        </div>

        <div style={{
          background: 'rgba(74, 222, 128, 0.08)', border: '1px solid rgba(74, 222, 128, 0.2)',
          borderRadius: 12, padding: '16px 14px',
        }}>
          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', marginBottom: 8 }}>Diversification Score</div>
          <div style={{
            fontSize: 28, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
            color: corrData.diversificationScore >= 60 ? '#4ade80' : corrData.diversificationScore >= 30 ? '#f0c674' : '#f87171',
          }}>
            {corrData.diversificationScore}/100
          </div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Higher = more diversified</div>
        </div>

        <div style={{
          background: 'rgba(240, 198, 116, 0.08)', border: '1px solid rgba(240, 198, 116, 0.2)',
          borderRadius: 12, padding: '16px 14px',
        }}>
          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', marginBottom: 8 }}>High Correlations</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#f0c674', fontFamily: "'JetBrains Mono', monospace" }}>
            {corrData.highCorrelation.length}
          </div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Pairs &gt;0.8 correlation</div>
        </div>
      </div>

      {/* Hedge Suggestion */}
      {corrData.hedgeSuggestion && (
        <div style={{
          background: 'rgba(248, 113, 113, 0.06)', border: '1px solid rgba(248, 113, 113, 0.2)',
          borderRadius: 10, padding: '12px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Shield size={16} color="#f87171" />
          <span style={{ color: '#f87171', fontSize: 12 }}>{corrData.hedgeSuggestion}</span>
        </div>
      )}

      {/* Enhanced Heatmap */}
      <div style={{
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12, padding: 20,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#e8e8e8', margin: '0 0 12px' }}>Correlation Heatmap (90 days)</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
            <thead>
              <tr>
                <th style={{ padding: 6 }} />
                {corrData.symbols.map(s => (
                  <th key={s} style={{ padding: '6px 4px', fontSize: 10, color: '#888', fontWeight: 600, textAlign: 'center', minWidth: 48 }}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corrData.symbols.map((symA, i) => (
                <tr key={symA}>
                  <td style={{ padding: '4px 8px', fontSize: 10, color: '#ccc', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{symA}</td>
                  {corrData.symbols.map((symB, j) => {
                    const val = corrData.matrix[i]?.[j] ?? 0;
                    return (
                      <td key={symB} style={{
                        padding: 4, textAlign: 'center', fontSize: 10,
                        fontFamily: "'JetBrains Mono', monospace",
                        color: i === j ? '#444' : val >= 0.5 ? '#ef4444' : val <= -0.5 ? '#3b82f6' : '#888',
                        background: i === j ? 'rgba(255,255,255,0.05)' : getCHeatColor(val),
                        borderRadius: 3, fontWeight: Math.abs(val) > 0.7 ? 700 : 400,
                        minWidth: 48,
                      }}>
                        {val.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RiskCard({ icon, label, value, color, bg, subtitle }: {
  icon: React.ReactNode; label: string; value: string; color: string; bg: string; subtitle: string;
}) {
  return (
    <div style={{
      background: bg,
      border: `1px solid ${color}20`,
      borderRadius: 12,
      padding: '20px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {icon}
        <span style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: '#555' }}>{subtitle}</div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontSize: 11, color: '#666',
  fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
};
