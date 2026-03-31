'use client';
import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { MOCK_STRATEGIES, MOCK_AUDIT_LOG } from '@/lib/data';
import { Strategy, AuditLogEntry } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, Settings } from 'lucide-react';
import WheelTracker from '@/components/options/WheelTracker';
import WheelSettings from '@/components/options/WheelSettings';

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  paused: '#f59e0b',
  paper: '#38bdf8',
};

const TYPE_LABELS: Record<string, string> = {
  covered_call_wheel: 'Covered Call Wheel',
  tax_loss_harvest: 'Tax-Loss Harvest',
  auto_rebalance: 'Auto Rebalance',
  rsu_diversification: 'RSU Diversification',
};

function StrategyCard({ strategy, onToggle }: { strategy: Strategy; onToggle: (id: string) => void }) {
  return (
    <div className="terminal-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8', marginBottom: 6 }}>{strategy.name}</div>
          <span style={{
            fontSize: 11,
            backgroundColor: 'rgba(201,168,76,0.1)',
            color: '#c9a84c',
            padding: '2px 8px',
            borderRadius: 4,
          }}>{TYPE_LABELS[strategy.type]}</span>
        </div>
        <span style={{
          fontSize: 12,
          backgroundColor: `${STATUS_COLORS[strategy.status]}20`,
          color: STATUS_COLORS[strategy.status],
          padding: '4px 10px',
          borderRadius: 20,
          fontWeight: 600,
          textTransform: 'capitalize',
        }}>{strategy.status}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: '#6b6b80', marginBottom: 2 }}>Total Return</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: strategy.performance.totalReturnPct > 0 ? '#22c55e' : '#ef4444' }}>
            +${strategy.performance.totalReturn.toLocaleString()} ({strategy.performance.totalReturnPct}%)
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#6b6b80', marginBottom: 2 }}>Trades Executed</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{strategy.performance.tradesExecuted}</div>
        </div>
      </div>
      <button
        onClick={() => onToggle(strategy.id)}
        style={{
          width: '100%',
          padding: '8px 0',
          backgroundColor: strategy.status === 'paused' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
          color: strategy.status === 'paused' ? '#22c55e' : '#f59e0b',
          border: `1px solid ${strategy.status === 'paused' ? '#22c55e33' : '#f59e0b33'}`,
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {strategy.status === 'paused' ? 'Resume Strategy' : 'Pause Strategy'}
      </button>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  const statusColors: Record<string, string> = { success: '#22c55e', failed: '#ef4444', pending: '#c9a84c' };
  const statusBg: Record<string, string> = { success: '#22c55e20', failed: '#ef444420', pending: '#c9a84c20' };
  const reason = entry.reason || (entry.metadata as Record<string, unknown>)?.reason as string | undefined;
  return (
    <tr style={{ borderBottom: '1px solid #1a1a24' }}>
      <td style={{ padding: '10px 12px', fontSize: 12, color: '#6b6b80' }}>
        {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
      </td>
      <td style={{ padding: '10px 12px', fontSize: 13, color: '#c9a84c', fontWeight: 600 }}>{entry.agent}</td>
      <td style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 13 }}>{entry.action}</div>
        {reason && (
          <div style={{ fontSize: 11, color: '#6b6b80', marginTop: 3, fontStyle: 'italic', lineHeight: 1.4 }}>
            {reason}
          </div>
        )}
      </td>
      <td style={{ padding: '10px 12px', fontSize: 12, color: '#6b6b80' }}>{entry.details}</td>
      <td style={{ padding: '10px 12px' }}>
        <span style={{
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 4,
          backgroundColor: statusBg[entry.status],
          color: statusColors[entry.status],
        }}>{entry.status}</span>
      </td>
    </tr>
  );
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>(MOCK_STRATEGIES);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>(MOCK_AUDIT_LOG);
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [showWheelSettings, setShowWheelSettings] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [stratRes, auditRes] = await Promise.all([
          fetch('/api/strategies'),
          fetch('/api/audit-log'),
        ]);
        if (stratRes.ok) {
          const data = await stratRes.json();
          if (Array.isArray(data) && data.length > 0) setStrategies(data);
        }
        if (auditRes.ok) {
          const data = await auditRes.json();
          if (Array.isArray(data) && data.length > 0) setAuditEntries(data);
        }
      } catch {
        // Fall back to mock data
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  function handleToggle(id: string) {
    setStrategies(prev =>
      prev.map(s =>
        s.id === id
          ? { ...s, status: (s.status === 'paused' ? 'active' : 'paused') as Strategy['status'] }
          : s
      )
    );
  }

  function handleKillSwitch() {
    setKillSwitchActive(true);
    setStrategies(prev => prev.map(s => ({ ...s, status: 'paused' as Strategy['status'] })));
    setTimeout(() => setKillSwitchActive(false), 3000);
  }

  return (
    <AppShell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#e8e8e8', margin: 0 }}>Strategies</h1>
          <p style={{ color: '#6b6b80', fontSize: 13, marginTop: 4 }}>
            Automated wealth-building strategies
            {loading && <span style={{ marginLeft: 8, color: '#c9a84c' }}>&#8226; Loading...</span>}
          </p>
        </div>
        <button
          onClick={handleKillSwitch}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            backgroundColor: killSwitchActive ? '#ef444420' : '#ef444410',
            color: '#ef4444',
            border: '1px solid #ef444440',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          <AlertTriangle size={14} />
          {killSwitchActive ? 'All Strategies Paused' : 'Kill Switch — Pause All'}
        </button>
      </div>

      {/* Strategy Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20, marginBottom: 40 }}>
        {strategies.map(s => (
          <StrategyCard key={s.id} strategy={s} onToggle={handleToggle} />
        ))}
      </div>

      {/* Covered Call Wheel Section */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#e8e8e8', margin: 0 }}>Covered Call Wheel</h2>
            <p style={{ color: '#6b6b80', fontSize: 12, marginTop: 4 }}>Track your wheel strategy cycles</p>
          </div>
          <button
            onClick={() => setShowWheelSettings(s => !s)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', backgroundColor: '#1a1a24',
              border: '1px solid #2a2a3a', borderRadius: 8,
              color: '#6b6b80', cursor: 'pointer', fontSize: 12,
            }}
          >
            <Settings size={14} />
            Wheel Settings
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: showWheelSettings ? '1fr 320px' : '1fr', gap: 20 }}>
          <div className="terminal-card">
            <WheelTracker />
          </div>
          {showWheelSettings && (
            <div className="terminal-card">
              <div style={{ fontSize: 12, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
                Wheel Parameters
              </div>
              <WheelSettings />
            </div>
          )}
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="terminal-card">
        <div style={{ fontSize: 12, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Full Audit Log</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a3a' }}>
                {['Timestamp', 'Agent', 'Action', 'Details', 'Status'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left',
                    padding: '8px 12px',
                    fontSize: 11,
                    color: '#6b6b80',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {auditEntries.map(entry => (
                <AuditRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
