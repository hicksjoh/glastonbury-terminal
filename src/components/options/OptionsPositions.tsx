'use client';

import { useState, useEffect } from 'react';
import type { OptionPosition, PortfolioGreeks } from '@/lib/options/types';
import { formatOptionParts } from '@/lib/options/symbols';
import GreeksSummary from './GreeksSummary';

interface OptionsPositionsProps {
  onClose?: (position: OptionPosition) => void;
}

export default function OptionsPositions({ onClose }: OptionsPositionsProps) {
  const [positions, setPositions] = useState<OptionPosition[]>([]);
  const [greeks, setGreeks] = useState<PortfolioGreeks | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/options/positions')
      .then(r => r.json())
      .then(data => {
        setPositions(data.positions || []);
        setGreeks(data.greeks || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <GreeksSummary greeks={null} loading />
        <div className="terminal-card" style={{ textAlign: 'center', padding: 40, color: '#6b6b80' }}>
          Loading options positions...
        </div>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div>
        <GreeksSummary greeks={greeks} />
        <div className="terminal-card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ color: '#6b6b80', fontSize: 13 }}>No open options positions</div>
          <div style={{ color: '#555', fontSize: 11, marginTop: 8 }}>
            Trade options from the Options tab to see positions here
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <GreeksSummary greeks={greeks} />

      <div className="terminal-card">
        <div style={{
          fontSize: 12, color: '#6b6b80', textTransform: 'uppercase',
          letterSpacing: '0.08em', marginBottom: 16,
        }}>
          Options Positions ({positions.length})
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a3a' }}>
                {['Contract', 'Type', 'Qty', 'Avg Cost', 'Current', 'P&L', 'P&L %', 'DTE', 'Delta', 'Theta'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '8px 10px',
                    fontSize: 10, color: '#6b6b80', textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}>{h}</th>
                ))}
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {positions.map(pos => {
                const isExpanded = expandedId === pos.id;
                return (
                  <>
                    <tr key={pos.id} style={{
                      borderBottom: isExpanded ? 'none' : '1px solid #1a1a24',
                      cursor: 'pointer',
                    }}
                    onClick={() => setExpandedId(isExpanded ? null : pos.id)}
                    >
                      <td style={{
                        padding: '10px 10px', fontSize: 13, fontWeight: 600, color: '#c9a84c',
                        whiteSpace: 'nowrap',
                      }}>
                        {formatOptionParts(pos.underlying, pos.expiration, pos.strike, pos.contractType)}
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                          background: pos.direction === 'long' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                          color: pos.direction === 'long' ? '#4ade80' : '#ef4444',
                          textTransform: 'uppercase',
                        }}>
                          {pos.direction}
                        </span>
                      </td>
                      <td style={{ padding: '10px 10px', fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>{pos.quantity}</td>
                      <td style={{ padding: '10px 10px', fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>${pos.avgCost.toFixed(2)}</td>
                      <td style={{ padding: '10px 10px', fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>${pos.currentPrice.toFixed(2)}</td>
                      <td style={{
                        padding: '10px 10px', fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                        color: pos.pnl >= 0 ? '#4ade80' : '#ef4444',
                      }}>
                        {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(0)}
                      </td>
                      <td style={{
                        padding: '10px 10px', fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                        color: pos.pnlPercent >= 0 ? '#4ade80' : '#ef4444',
                      }}>
                        {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(1)}%
                      </td>
                      <td style={{
                        padding: '10px 10px', fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                        color: pos.dte <= 7 ? '#f59e0b' : '#c8c8d0',
                        fontWeight: pos.dte <= 7 ? 700 : 400,
                      }}>
                        {pos.dte}
                      </td>
                      <td style={{
                        padding: '10px 10px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                        color: pos.delta >= 0 ? '#4ade80' : '#ef4444',
                      }}>
                        {pos.delta >= 0 ? '+' : ''}{pos.delta.toFixed(2)}
                      </td>
                      <td style={{
                        padding: '10px 10px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                        color: pos.theta >= 0 ? '#4ade80' : '#ef4444',
                      }}>
                        ${pos.theta.toFixed(2)}
                      </td>
                      <td style={{ padding: '10px 6px' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); onClose?.(pos); }}
                            style={{
                              padding: '3px 8px', borderRadius: 4, fontSize: 10,
                              background: 'rgba(239, 68, 68, 0.08)', border: '1px solid #ef444430',
                              color: '#ef4444', cursor: 'pointer', fontWeight: 600,
                            }}
                          >Close</button>
                        </div>
                      </td>
                    </tr>
                    {/* Expanded details row */}
                    {isExpanded && (
                      <tr key={`${pos.id}-expanded`} style={{ borderBottom: '1px solid #1a1a24' }}>
                        <td colSpan={11} style={{ padding: '0 10px 12px' }}>
                          <div style={{
                            display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12,
                            background: '#08080d', borderRadius: 8, padding: 12,
                          }}>
                            <MiniStat label="Delta" value={pos.delta.toFixed(3)} />
                            <MiniStat label="Gamma" value={pos.gamma.toFixed(4)} />
                            <MiniStat label="Theta" value={`$${pos.theta.toFixed(2)}/day`} />
                            <MiniStat label="Vega" value={pos.vega.toFixed(3)} />
                            <MiniStat label="OCC Symbol" value={pos.optionSymbol} small />
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase' }}>{label}</div>
      <div style={{
        fontSize: small ? 10 : 12, color: '#c8c8d0',
        fontFamily: "'JetBrains Mono', monospace", marginTop: 2,
        overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{value}</div>
    </div>
  );
}
