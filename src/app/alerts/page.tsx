'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Bell, Plus, Trash2, Zap, Eye, MessageSquare } from 'lucide-react';

interface AlertCondition {
  symbol: string;
  metric: string;
  operator: string;
  value: number;
}

interface Alert {
  id: string;
  name: string;
  conditions: AlertCondition[];
  logic: string;
  action: string;
  is_active: boolean;
  last_triggered: string | null;
  created_at: string;
}

const METRICS = [
  { value: 'price', label: 'Price' },
  { value: 'changePercent', label: '% Change' },
  { value: 'volume', label: 'Volume' },
  { value: 'rsi', label: 'RSI' },
];

const OPERATORS = [
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
];

const ACTION_ICONS: Record<string, React.ReactNode> = {
  notify: <Bell size={14} />,
  log: <Eye size={14} />,
  analyze: <MessageSquare size={14} />,
};

const TEMPLATES = [
  {
    name: 'Dip Buy Alert',
    conditions: [
      { symbol: 'AAPL', metric: 'price', operator: '<', value: 170 },
      { symbol: 'AAPL', metric: 'rsi', operator: '<', value: 30 },
    ],
    logic: 'AND',
    action: 'notify',
  },
  {
    name: 'Volatility Spike',
    conditions: [
      { symbol: 'VIX', metric: 'price', operator: '>', value: 25 },
    ],
    logic: 'AND',
    action: 'notify',
  },
  {
    name: 'Earnings Play',
    conditions: [
      { symbol: 'NVDA', metric: 'changePercent', operator: '>', value: 3 },
      { symbol: 'NVDA', metric: 'volume', operator: '>', value: 30000000 },
    ],
    logic: 'AND',
    action: 'analyze',
  },
];

let condId = 100;

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [newName, setNewName] = useState('');
  const [newConditions, setNewConditions] = useState<(AlertCondition & { id: number })[]>([
    { id: 1, symbol: '', metric: 'price', operator: '>', value: 0 },
  ]);
  const [newLogic, setNewLogic] = useState<'AND' | 'OR'>('AND');
  const [newAction, setNewAction] = useState('notify');

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const res = await fetch('/api/alerts');
        if (res.ok) {
          const data = await res.json();
          setAlerts(data.alerts || []);
        }
      } catch {
        // Use empty
      } finally {
        setLoading(false);
      }
    };
    fetchAlerts();
  }, []);

  const addCondition = () => {
    condId++;
    setNewConditions(prev => [...prev, { id: condId, symbol: '', metric: 'price', operator: '>', value: 0 }]);
  };

  const removeCondition = (id: number) => {
    setNewConditions(prev => prev.filter(c => c.id !== id));
  };

  const updateCondition = (id: number, field: string, value: string | number) => {
    setNewConditions(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const loadTemplate = (template: typeof TEMPLATES[0]) => {
    setNewName(template.name);
    setNewConditions(template.conditions.map((c, i) => ({ ...c, id: 200 + i })));
    setNewLogic(template.logic as 'AND' | 'OR');
    setNewAction(template.action);
    setShowBuilder(true);
  };

  const createAlert = async () => {
    if (!newName) return;
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          conditions: newConditions.map(({ symbol, metric, operator, value }) => ({ symbol, metric, operator, value })),
          logic: newLogic,
          action: newAction,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAlerts(prev => [data.alert, ...prev]);
        setShowBuilder(false);
        setNewName('');
        setNewConditions([{ id: 1, symbol: '', metric: 'price', operator: '>', value: 0 }]);
      }
    } catch (err) {
      console.error('Create alert error:', err);
    }
  };

  const toggleAlert = async (id: string, active: boolean) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_active: active } : a));
    try {
      await fetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: active }),
      });
    } catch { /* best effort */ }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <AppShell>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <Bell size={24} color="#c9a84c" />
              <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Custom Alerts</h1>
            </div>
            <p style={{ color: '#888', fontSize: 14, margin: 0 }}>Define compound alert conditions &bull; {alerts.filter(a => a.is_active).length} active</p>
          </div>
          <button
            onClick={() => setShowBuilder(!showBuilder)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 8,
              background: 'rgba(240, 198, 116, 0.15)',
              border: '1px solid rgba(240, 198, 116, 0.3)',
              color: '#f0c674', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Plus size={16} /> New Alert
          </button>
        </div>

        {/* Templates */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {TEMPLATES.map(t => (
            <button
              key={t.name}
              onClick={() => loadTemplate(t)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 20,
                border: '1px solid rgba(138, 92, 246, 0.2)',
                background: 'rgba(138, 92, 246, 0.06)',
                color: '#c4a6ff', fontSize: 11, cursor: 'pointer',
              }}
            >
              <Zap size={11} /> {t.name}
            </button>
          ))}
        </div>

        {/* Alert Builder */}
        {showBuilder && (
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(240, 198, 116, 0.2)',
            borderRadius: 12, padding: 24, marginBottom: 24,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e8e8e8', marginBottom: 16 }}>Create Alert Rule</div>

            <input
              type="text"
              placeholder="Alert name..."
              value={newName}
              onChange={e => setNewName(e.target.value)}
              style={{ ...inputStyle, width: '100%', marginBottom: 16, fontSize: 14 }}
            />

            <div style={{ fontSize: 11, color: '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Conditions ({newLogic})
            </div>

            {newConditions.map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Symbol"
                  value={c.symbol}
                  onChange={e => updateCondition(c.id, 'symbol', e.target.value.toUpperCase())}
                  style={{ ...inputStyle, width: 80 }}
                />
                <select value={c.metric} onChange={e => updateCondition(c.id, 'metric', e.target.value)} style={selectStyle}>
                  {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <select value={c.operator} onChange={e => updateCondition(c.id, 'operator', e.target.value)} style={{ ...selectStyle, width: 60 }}>
                  {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input
                  type="number"
                  value={c.value || ''}
                  onChange={e => updateCondition(c.id, 'value', Number(e.target.value))}
                  style={{ ...inputStyle, width: 100 }}
                />
                <button onClick={() => removeCondition(c.id)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 4 }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 12, marginTop: 16, alignItems: 'center' }}>
              <button onClick={addCondition} style={addBtnStyle}><Plus size={14} /> Add Condition</button>

              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                <button onClick={() => setNewLogic('AND')} style={{ ...logicBtnStyle, ...(newLogic === 'AND' ? activeLogic : {}) }}>ALL (AND)</button>
                <button onClick={() => setNewLogic('OR')} style={{ ...logicBtnStyle, ...(newLogic === 'OR' ? activeLogic : {}) }}>ANY (OR)</button>
              </div>
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#666' }}>Action:</span>
              {[
                { value: 'notify', label: 'Notify Me' },
                { value: 'log', label: 'Log to Audit' },
                { value: 'analyze', label: 'Ask Keisha' },
              ].map(a => (
                <button key={a.value} onClick={() => setNewAction(a.value)} style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 11,
                  border: newAction === a.value ? '1px solid #c9a84c' : '1px solid rgba(255,255,255,0.1)',
                  background: newAction === a.value ? 'rgba(201, 168, 76, 0.1)' : 'transparent',
                  color: newAction === a.value ? '#c9a84c' : '#666', cursor: 'pointer',
                }}>
                  {a.label}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
              <button onClick={createAlert} style={saveBtnStyle}>Create Alert</button>
              <button onClick={() => setShowBuilder(false)} style={{ ...addBtnStyle, color: '#555' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Alert List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>Loading alerts...</div>
        ) : alerts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#555' }}>
            No alerts configured yet. Create one above or use a template.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.map(alert => (
              <div key={alert.id} style={{
                background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${alert.is_active ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'}`,
                borderRadius: 10,
                padding: '16px 20px',
                opacity: alert.is_active ? 1 : 0.5,
                transition: 'all 0.2s',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: alert.is_active ? '#f0c674' : '#555' }}>{ACTION_ICONS[alert.action] || <Bell size={14} />}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: '#e8e8e8' }}>{alert.name}</span>
                    <span style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 4,
                      background: alert.is_active ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255,255,255,0.05)',
                      color: alert.is_active ? '#4ade80' : '#555',
                    }}>
                      {alert.is_active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <button
                    onClick={() => toggleAlert(alert.id, !alert.is_active)}
                    style={{
                      padding: '4px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(255,255,255,0.03)',
                      color: '#888',
                    }}
                  >
                    {alert.is_active ? 'Pause' : 'Enable'}
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {alert.conditions.map((c, i) => (
                    <span key={i} style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 4,
                      background: 'rgba(138, 92, 246, 0.08)',
                      border: '1px solid rgba(138, 92, 246, 0.15)',
                      color: '#c4a6ff',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {c.symbol} {c.metric} {c.operator} {c.value}
                    </span>
                  ))}
                  <span style={{ fontSize: 10, color: '#555', alignSelf: 'center' }}>({alert.logic})</span>
                </div>
                <div style={{ fontSize: 11, color: '#555' }}>
                  Created {timeAgo(alert.created_at)}
                  {alert.last_triggered && <> &bull; Last triggered {timeAgo(alert.last_triggered)}</>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
  color: '#fff', fontSize: 12, outline: 'none',
  fontFamily: "'JetBrains Mono', monospace",
};

const selectStyle: React.CSSProperties = {
  padding: '8px 10px', background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
  color: '#ccc', fontSize: 12, outline: 'none',
};

const addBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.03)',
  color: '#888', fontSize: 12, cursor: 'pointer',
};

const saveBtnStyle: React.CSSProperties = {
  padding: '10px 24px', borderRadius: 8,
  background: 'rgba(240, 198, 116, 0.15)',
  border: '1px solid rgba(240, 198, 116, 0.3)',
  color: '#f0c674', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

const logicBtnStyle: React.CSSProperties = {
  padding: '5px 12px', borderRadius: 6, fontSize: 11,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'transparent', color: '#666', cursor: 'pointer',
};

const activeLogic: React.CSSProperties = {
  border: '1px solid #c9a84c',
  background: 'rgba(201, 168, 76, 0.1)',
  color: '#c9a84c',
};
