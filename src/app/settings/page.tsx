'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { CheckCircle, XCircle, RefreshCw, Shield, Sliders, Bell, Palette, Zap } from 'lucide-react';

interface ConnectionStatus {
  name: string;
  status: 'connected' | 'disconnected' | 'testing';
  detail?: string;
}

export default function SettingsPage() {
  const [connections, setConnections] = useState<ConnectionStatus[]>([
    { name: 'Alpaca (Paper)', status: 'connected', detail: 'Paper trading active' },
    { name: 'FMP (Market Data)', status: 'connected', detail: 'Free tier' },
    { name: 'Supabase', status: 'connected', detail: 'Connected' },
    { name: 'Claude AI (Keisha)', status: 'connected', detail: 'claude-sonnet-4' },
  ]);
  const [riskTolerance, setRiskTolerance] = useState(50);
  const [commStyle, setCommStyle] = useState<'brief' | 'detailed'>('detailed');
  const [pushNotifs, setPushNotifs] = useState(false);
  const [paperMode, setPaperMode] = useState(true);

  const testConnection = (name: string) => {
    setConnections(prev => prev.map(c => c.name === name ? { ...c, status: 'testing' } : c));
    setTimeout(() => {
      setConnections(prev => prev.map(c => c.name === name ? { ...c, status: 'connected' } : c));
    }, 1500);
  };

  const Section = ({ title, icon: Icon, children }: { title: string; icon: typeof Shield; children: React.ReactNode }) => (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35',
      borderRadius: 14, padding: 20, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Icon size={16} color="#8a5cf6" />
        <span style={{ color: '#8a5cf6', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
          {title}
        </span>
      </div>
      {children}
    </div>
  );

  return (
    <AppShell>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Settings</h1>
        <p style={{ color: '#8888a8', fontSize: 14, margin: '0 0 28px' }}>Terminal configuration & connections</p>

        {/* Connections */}
        <Section title="Connections" icon={Zap}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {connections.map(c => (
              <div key={c.name} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.02)',
                border: '1px solid #1e1e35',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {c.status === 'connected' && <CheckCircle size={16} color="#4ade80" />}
                  {c.status === 'disconnected' && <XCircle size={16} color="#f87171" />}
                  {c.status === 'testing' && <RefreshCw size={16} color="#f0c674" className="animate-spin" />}
                  <div>
                    <div style={{ color: '#e8e8f0', fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                    <div style={{ color: '#555570', fontSize: 11 }}>{c.detail}</div>
                  </div>
                </div>
                <button
                  onClick={() => testConnection(c.name)}
                  style={{
                    background: 'none', border: '1px solid #1e1e35', borderRadius: 6,
                    padding: '4px 10px', cursor: 'pointer', color: '#8888a8', fontSize: 10,
                  }}
                >
                  Test
                </button>
              </div>
            ))}
          </div>
        </Section>

        {/* Keisha Preferences */}
        <Section title="Keisha Preferences" icon={Sliders}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ color: '#8888a8', fontSize: 12, display: 'block', marginBottom: 6 }}>
              Risk Tolerance: {riskTolerance < 33 ? 'Conservative' : riskTolerance < 66 ? 'Moderate' : 'Aggressive'}
            </label>
            <input
              type="range" min="0" max="100" value={riskTolerance}
              onChange={e => setRiskTolerance(Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555570', fontSize: 10 }}>
              <span>Conservative</span><span>Moderate</span><span>Aggressive</span>
            </div>
          </div>

          <div>
            <label style={{ color: '#8888a8', fontSize: 12, display: 'block', marginBottom: 6 }}>Communication Style</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['brief', 'detailed'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setCommStyle(s)}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 8, cursor: 'pointer', textTransform: 'capitalize',
                    background: commStyle === s ? 'rgba(138,92,246,0.1)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${commStyle === s ? '#8a5cf6' : '#1e1e35'}`,
                    color: commStyle === s ? '#8a5cf6' : '#8888a8', fontSize: 13,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </Section>

        {/* Notifications */}
        <Section title="Notifications" icon={Bell}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
            <div>
              <div style={{ color: '#e8e8f0', fontSize: 13 }}>Browser Push Notifications</div>
              <div style={{ color: '#555570', fontSize: 11 }}>Get notified for P0 events</div>
            </div>
            <button
              onClick={() => {
                if (!pushNotifs && typeof Notification !== 'undefined') {
                  Notification.requestPermission().then(p => setPushNotifs(p === 'granted'));
                } else {
                  setPushNotifs(!pushNotifs);
                }
              }}
              style={{
                width: 48, height: 26, borderRadius: 13, cursor: 'pointer', border: 'none',
                background: pushNotifs ? '#4ade80' : '#1e1e35',
                position: 'relative', transition: 'background 0.2s',
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: '50%', background: '#fff',
                position: 'absolute', top: 3,
                left: pushNotifs ? 25 : 3, transition: 'left 0.2s',
              }} />
            </button>
          </div>
        </Section>

        {/* Paper/Live Toggle */}
        <Section title="Trading Mode" icon={Shield}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ color: '#e8e8f0', fontSize: 13, fontWeight: 600 }}>
                {paperMode ? 'Paper Trading' : 'Live Trading'}
              </div>
              <div style={{ color: '#555570', fontSize: 11 }}>
                {paperMode ? 'Simulated trades — no real money at risk' : 'Real money — trades execute against your brokerage'}
              </div>
            </div>
            <div style={{
              padding: '6px 14px', borderRadius: 8,
              background: paperMode ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
              border: `1px solid ${paperMode ? '#4ade80' : '#f87171'}`,
              color: paperMode ? '#4ade80' : '#f87171', fontSize: 12, fontWeight: 600,
            }}>
              {paperMode ? 'PAPER' : 'LIVE'}
            </div>
          </div>
        </Section>

        {/* Version Info */}
        <div style={{ textAlign: 'center', padding: 16, color: '#555570', fontSize: 11 }}>
          Glastonbury Terminal v1.0 &bull; The Glastonbury Group &bull; 2026
        </div>
      </div>
    </AppShell>
  );
}
