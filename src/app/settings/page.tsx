'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CheckCircle, XCircle, RefreshCw, Shield, Sliders, Bell, Zap, Info } from 'lucide-react';

interface ConnectionStatus {
  name: string;
  key: string;
  status: 'connected' | 'disconnected' | 'testing';
  detail?: string;
}

const STORAGE_KEY = 'glastonbury-settings';

interface SavedSettings {
  riskTolerance: number;
  commStyle: 'brief' | 'detailed';
  pushNotifs: boolean;
  paperMode: boolean;
}

const DEFAULT_SETTINGS: SavedSettings = {
  riskTolerance: 50,
  commStyle: 'detailed',
  pushNotifs: false,
  paperMode: true,
};

export default function SettingsPage() {
  const [connections, setConnections] = useState<ConnectionStatus[]>([
    { name: 'Alpaca (Paper)', key: 'alpaca', status: 'testing', detail: 'Testing...' },
    { name: 'FMP (Market Data)', key: 'fmp', status: 'testing', detail: 'Testing...' },
    { name: 'Supabase', key: 'supabase', status: 'testing', detail: 'Testing...' },
    { name: 'Claude AI (Keisha)', key: 'keisha', status: 'testing', detail: 'Testing...' },
  ]);
  const [riskTolerance, setRiskTolerance] = useState(DEFAULT_SETTINGS.riskTolerance);
  const [commStyle, setCommStyle] = useState<'brief' | 'detailed'>(DEFAULT_SETTINGS.commStyle);
  const [pushNotifs, setPushNotifs] = useState(DEFAULT_SETTINGS.pushNotifs);
  const [paperMode, setPaperMode] = useState(DEFAULT_SETTINGS.paperMode);
  const [envVars, setEnvVars] = useState<Record<string, boolean>>({});
  const [isPaperEnv, setIsPaperEnv] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // ── Load settings from localStorage on mount ──────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: SavedSettings = JSON.parse(saved);
        setRiskTolerance(parsed.riskTolerance ?? DEFAULT_SETTINGS.riskTolerance);
        setCommStyle(parsed.commStyle ?? DEFAULT_SETTINGS.commStyle);
        setPushNotifs(parsed.pushNotifs ?? DEFAULT_SETTINGS.pushNotifs);
        setPaperMode(parsed.paperMode ?? DEFAULT_SETTINGS.paperMode);
      }
    } catch {
      // ignore corrupt localStorage
    }
    setSettingsLoaded(true);
  }, []);

  // ── Persist settings to localStorage whenever they change ─────────────────
  useEffect(() => {
    if (!settingsLoaded) return;
    const settings: SavedSettings = { riskTolerance, commStyle, pushNotifs, paperMode };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [riskTolerance, commStyle, pushNotifs, paperMode, settingsLoaded]);

  // ── Connection test logic ─────────────────────────────────────────────────
  const updateConnection = useCallback((key: string, status: 'connected' | 'disconnected', detail: string) => {
    setConnections(prev => prev.map(c => c.key === key ? { ...c, status, detail } : c));
  }, []);

  const setTesting = useCallback((key: string) => {
    setConnections(prev => prev.map(c => c.key === key ? { ...c, status: 'testing', detail: 'Testing...' } : c));
  }, []);

  const testAlpaca = useCallback(async () => {
    setTesting('alpaca');
    try {
      const res = await fetch('/api/alpaca/account');
      if (res.ok) {
        const data = await res.json();
        const label = data.account_number
          ? `Account ${data.account_number}`
          : 'Paper trading active';
        updateConnection('alpaca', 'connected', label);
      } else {
        updateConnection('alpaca', 'disconnected', `HTTP ${res.status}`);
      }
    } catch (e: unknown) {
      updateConnection('alpaca', 'disconnected', e instanceof Error ? e.message : 'Network error');
    }
  }, [setTesting, updateConnection]);

  const testFMP = useCallback(async () => {
    setTesting('fmp');
    try {
      const res = await fetch('/api/sectors');
      if (res.ok) {
        updateConnection('fmp', 'connected', 'Sector data OK');
      } else {
        updateConnection('fmp', 'disconnected', `HTTP ${res.status}`);
      }
    } catch (e: unknown) {
      updateConnection('fmp', 'disconnected', e instanceof Error ? e.message : 'Network error');
    }
  }, [setTesting, updateConnection]);

  const testSupabase = useCallback(async () => {
    setTesting('supabase');
    try {
      const res = await fetch('/api/watchlist');
      if (res.ok) {
        updateConnection('supabase', 'connected', 'Connected');
      } else {
        updateConnection('supabase', 'disconnected', `HTTP ${res.status}`);
      }
    } catch (e: unknown) {
      updateConnection('supabase', 'disconnected', e instanceof Error ? e.message : 'Network error');
    }
  }, [setTesting, updateConnection]);

  const testKeisha = useCallback(async () => {
    setTesting('keisha');
    try {
      const res = await fetch('/api/keisha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }], mode: 'general' }),
      });
      if (res.ok) {
        updateConnection('keisha', 'connected', process.env.NEXT_PUBLIC_CLAUDE_MODEL_LABEL || 'claude-opus-4-7');
      } else {
        updateConnection('keisha', 'disconnected', `HTTP ${res.status}`);
      }
    } catch (e: unknown) {
      updateConnection('keisha', 'disconnected', e instanceof Error ? e.message : 'Network error');
    }
  }, [setTesting, updateConnection]);

  const testConnection = useCallback((key: string) => {
    switch (key) {
      case 'alpaca': testAlpaca(); break;
      case 'fmp': testFMP(); break;
      case 'supabase': testSupabase(); break;
      case 'keisha': testKeisha(); break;
    }
  }, [testAlpaca, testFMP, testSupabase, testKeisha]);

  const testAll = useCallback(() => {
    testAlpaca();
    testFMP();
    testSupabase();
    testKeisha();
  }, [testAlpaca, testFMP, testSupabase, testKeisha]);

  // ── Fetch env var status ──────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/env-check')
      .then(res => res.json())
      .then(data => {
        setEnvVars(data.vars || {});
        setIsPaperEnv(data.isPaper ?? true);
      })
      .catch(() => {});
  }, []);

  // ── Auto-test all connections on mount ────────────────────────────────────
  useEffect(() => {
    testAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Section component ─────────────────────────────────────────────────────
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

  const buildTimestamp = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });

  return (
    <AppShell>
      <ErrorBoundary label="settings">
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Settings</h1>
        <p style={{ color: '#8888a8', fontSize: 14, margin: '0 0 28px' }}>Terminal configuration & connections</p>

        {/* Connections */}
        <Section title="Connections" icon={Zap}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <button
              onClick={testAll}
              style={{
                background: 'none', border: '1px solid #1e1e35', borderRadius: 6,
                padding: '4px 12px', cursor: 'pointer', color: '#8a5cf6', fontSize: 10,
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <RefreshCw size={10} /> Test All
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {connections.map(c => (
              <div key={c.key} style={{
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
                  onClick={() => testConnection(c.key)}
                  disabled={c.status === 'testing'}
                  style={{
                    background: 'none', border: '1px solid #1e1e35', borderRadius: 6,
                    padding: '4px 10px', cursor: c.status === 'testing' ? 'not-allowed' : 'pointer',
                    color: '#8888a8', fontSize: 10,
                    opacity: c.status === 'testing' ? 0.5 : 1,
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
                {paperMode ? 'Simulated trades -- no real money at risk' : 'Real money -- trades execute against your brokerage'}
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

        {/* Environment & Version Info */}
        <Section title="System Info" icon={Info}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35' }}>
              <div style={{ color: '#555570', fontSize: 10, marginBottom: 2 }}>APP VERSION</div>
              <div style={{ color: '#e8e8f0', fontSize: 13, fontWeight: 600 }}>v1.0</div>
            </div>
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35' }}>
              <div style={{ color: '#555570', fontSize: 10, marginBottom: 2 }}>ENVIRONMENT</div>
              <div style={{
                color: isPaperEnv ? '#4ade80' : '#f87171', fontSize: 13, fontWeight: 600,
              }}>
                {isPaperEnv ? 'Paper Trading' : 'Live Trading'}
              </div>
            </div>
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35', gridColumn: 'span 2' }}>
              <div style={{ color: '#555570', fontSize: 10, marginBottom: 2 }}>LAST BUILD</div>
              <div style={{ color: '#e8e8f0', fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>{buildTimestamp}</div>
            </div>
          </div>

          {/* Env Var Status */}
          <div style={{ color: '#555570', fontSize: 10, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Environment Variables
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {Object.entries(envVars).map(([name, isSet]) => (
              <div key={name} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 6,
                background: 'rgba(255,255,255,0.02)',
              }}>
                {isSet
                  ? <CheckCircle size={12} color="#4ade80" />
                  : <XCircle size={12} color="#f87171" />
                }
                <span style={{
                  color: isSet ? '#8888a8' : '#f87171',
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {name}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* Version Info */}
        <div style={{ textAlign: 'center', padding: 16, color: '#555570', fontSize: 11 }}>
          Glastonbury Terminal v1.0 &bull; The Glastonbury Group &bull; 2026
        </div>
      </div>
      </ErrorBoundary>
    </AppShell>
  );
}
