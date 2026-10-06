'use client';

import { useState } from 'react';

interface WheelCycle {
  id: string;
  underlying: string;
  phase: 'selling_puts' | 'assigned' | 'selling_calls' | 'called_away' | 'completed';
  roundNumber: number;
  costBasis: number;
  totalPremium: number;
  startedAt: string;
  completedAt?: string;
}

const PHASES = [
  { key: 'selling_puts', label: 'Sell Put', icon: '📉' },
  { key: 'assigned', label: 'Assigned', icon: '📋' },
  { key: 'selling_calls', label: 'Sell Call', icon: '📈' },
  { key: 'called_away', label: 'Called Away', icon: '💰' },
];

interface WheelTrackerProps {
  cycles?: WheelCycle[];
}

export default function WheelTracker({ cycles }: WheelTrackerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // No cycles means no wheels. This used to fall back to built-in demo data,
  // which rendered premium and active wheels for an account that had never
  // run one (QA 2026-10-05, blocker 4).
  const activeCycles = cycles ?? [];

  if (activeCycles.length === 0) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', color: '#6b6b80', fontSize: 13 }}>
        No wheel cycles tracked yet. Cycles appear here once a wheel strategy is running.
      </div>
    );
  }

  const totalPremiumAll = activeCycles.reduce((s, c) => s + c.totalPremium, 0);

  return (
    <div>
      {/* Summary */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #2a2a3a',
      }}>
        <div>
          <div style={{ fontSize: 12, color: '#6b6b80' }}>Total Premium Collected</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>
            ${totalPremiumAll.toLocaleString()}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: '#6b6b80' }}>Active Wheels</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#c9a84c' }}>{activeCycles.length}</div>
        </div>
      </div>

      {/* Wheel Cards */}
      {activeCycles.map(cycle => {
        const phaseIndex = PHASES.findIndex(p => p.key === cycle.phase);
        const isExpanded = expandedId === cycle.id;

        return (
          <div
            key={cycle.id}
            style={{
              background: '#08080d',
              borderRadius: 10,
              padding: 16,
              marginBottom: 12,
              border: '1px solid #2a2a3a',
              cursor: 'pointer',
            }}
            onClick={() => setExpandedId(isExpanded ? null : cycle.id)}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#c9a84c' }}>{cycle.underlying}</span>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 4,
                  background: 'rgba(138, 92, 246, 0.1)', color: '#c4a6ff',
                }}>Round {cycle.roundNumber}</span>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700,
                color: '#4ade80', fontFamily: "'JetBrains Mono', monospace",
              }}>+${cycle.totalPremium}</span>
            </div>

            {/* Phase Progress */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {PHASES.map((phase, i) => {
                const isActive = i === phaseIndex;
                const isComplete = i < phaseIndex;
                return (
                  <div key={phase.key} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                    <div style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      position: 'relative', zIndex: 1,
                    }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12,
                        background: isActive ? '#c9a84c' : isComplete ? 'rgba(74, 222, 128, 0.15)' : '#1a1a2e',
                        border: isActive ? '2px solid #c9a84c' : isComplete ? '2px solid #4ade80' : '2px solid #2a2a3a',
                        color: isActive ? '#000' : isComplete ? '#4ade80' : '#555',
                        fontWeight: 700,
                      }}>
                        {isComplete ? '✓' : phase.icon}
                      </div>
                      <div style={{
                        fontSize: 9, color: isActive ? '#c9a84c' : isComplete ? '#4ade80' : '#555',
                        marginTop: 4, whiteSpace: 'nowrap', fontWeight: isActive ? 700 : 400,
                      }}>
                        {phase.label}
                      </div>
                    </div>
                    {i < PHASES.length - 1 && (
                      <div style={{
                        flex: 1, height: 2, marginTop: -14,
                        background: isComplete ? '#4ade80' : '#2a2a3a',
                      }} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Expanded Details */}
            {isExpanded && (
              <div style={{
                marginTop: 16, paddingTop: 12, borderTop: '1px solid #2a2a3a',
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
              }}>
                <div>
                  <div style={{ fontSize: 10, color: '#555' }}>Cost Basis</div>
                  <div style={{ fontSize: 13, color: '#c8c8d0', fontFamily: "'JetBrains Mono', monospace" }}>
                    ${Number(cycle.costBasis) > 0 ? Number(cycle.costBasis).toFixed(2) : 'N/A'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#555' }}>Effective Basis</div>
                  <div style={{ fontSize: 13, color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>
                    ${Number(cycle.costBasis) > 0 ? (Number(cycle.costBasis) - Number(cycle.totalPremium) / 100).toFixed(2) : 'N/A'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#555' }}>Started</div>
                  <div style={{ fontSize: 13, color: '#c8c8d0' }}>
                    {new Date(cycle.startedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
