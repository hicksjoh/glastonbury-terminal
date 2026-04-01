'use client';
import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import TradeGuard from '@/components/TradeGuard';
import { ShieldCheck, Beaker, Play } from 'lucide-react';

interface Scenario {
  name: string;
  description: string;
  params: { symbol: string; side: 'buy' | 'sell'; quantity: number; price: number };
  expectedOutcome: string;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'Normal Buy — Small Position',
    description: 'Buying 10 shares of AAPL. Should pass cleanly.',
    params: { symbol: 'AAPL', side: 'buy', quantity: 10, price: 190 },
    expectedOutcome: 'CLEAR — small position relative to portfolio',
  },
  {
    name: 'Oversized Position',
    description: 'Buying 200 shares of NVDA at $870. Way over Kelly.',
    params: { symbol: 'NVDA', side: 'buy', quantity: 200, price: 870 },
    expectedOutcome: 'CAUTION — exceeds Kelly criterion, concentration warning',
  },
  {
    name: 'Performance Chasing',
    description: 'Buying a meme stock that ran up 30% in 5 days.',
    params: { symbol: 'GME', side: 'buy', quantity: 50, price: 25 },
    expectedOutcome: 'CAUTION — performance chasing detection if 5D change >20%',
  },
  {
    name: 'Moderate Sell',
    description: 'Selling 5 shares of VTI. Normal rebalance.',
    params: { symbol: 'VTI', side: 'sell', quantity: 5, price: 247 },
    expectedOutcome: 'CLEAR — standard portfolio rebalance',
  },
  {
    name: 'Large Concentrated Bet',
    description: 'Going all-in on TSLA with 50% of portfolio.',
    params: { symbol: 'TSLA', side: 'buy', quantity: 300, price: 175 },
    expectedOutcome: 'CAUTION/STOP — massive concentration + way over Kelly',
  },
  {
    name: 'Penny Stock Gamble',
    description: 'Buying 5000 shares of a sub-$2 stock.',
    params: { symbol: 'SNDL', side: 'buy', quantity: 5000, price: 1.5 },
    expectedOutcome: 'CAUTION — sizing and volatility flags',
  },
];

export default function GuardTestPage() {
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);
  const [customForm, setCustomForm] = useState({ symbol: '', side: 'buy' as 'buy' | 'sell', quantity: '', price: '' });
  const [showCustomGuard, setShowCustomGuard] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});

  function runCustom() {
    if (!customForm.symbol || !customForm.quantity || !customForm.price) return;
    setShowCustomGuard(true);
    setActiveScenario(null);
  }

  function logResult(name: string, verdict: string) {
    setResults(prev => ({ ...prev, [name]: verdict }));
  }

  return (
    <AppShell>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <Beaker size={24} color="#8a5cf6" />
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Trade Guard Test Lab</h1>
        </div>
        <p style={{ color: '#6b6b80', fontSize: 13, margin: 0 }}>
          Validate behavioral guards, Kelly sizing, and regime detection in paper mode before going live.
          Each scenario runs the full guard pipeline against your real Alpaca portfolio data.
        </p>
      </div>

      {/* Warning Banner */}
      <div style={{ backgroundColor: '#8a5cf610', border: '1px solid #8a5cf630', borderRadius: 8, padding: '12px 16px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
        <ShieldCheck size={16} color="#8a5cf6" />
        <span style={{ fontSize: 13, color: '#8a5cf6' }}>
          SANDBOX MODE — No orders will be placed. This page only runs the guard analysis.
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Left: Scenarios */}
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: '#e8e8e8' }}>Pre-Built Scenarios</div>
          {SCENARIOS.map((scenario, i) => (
            <div
              key={i}
              style={{
                backgroundColor: activeScenario?.name === scenario.name ? '#8a5cf615' : '#1a1a24',
                border: `1px solid ${activeScenario?.name === scenario.name ? '#8a5cf640' : '#2a2a3a'}`,
                borderRadius: 10, padding: 14, marginBottom: 10, cursor: 'pointer', transition: 'all 0.15s',
              }}
              onClick={() => { setActiveScenario(scenario); setShowCustomGuard(false); }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e8e8e8', marginBottom: 4 }}>{scenario.name}</div>
                  <div style={{ fontSize: 12, color: '#6b6b80' }}>{scenario.description}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {results[scenario.name] && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                      backgroundColor: results[scenario.name] === 'CLEAR' ? '#4ade8020' : results[scenario.name] === 'STOP' ? '#f8717120' : '#f0c67420',
                      color: results[scenario.name] === 'CLEAR' ? '#4ade80' : results[scenario.name] === 'STOP' ? '#f87171' : '#f0c674',
                    }}>{results[scenario.name]}</span>
                  )}
                  <Play size={14} color="#8a5cf6" />
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 6, fontStyle: 'italic' }}>
                Expected: {scenario.expectedOutcome}
              </div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
                {scenario.params.side.toUpperCase()} {scenario.params.quantity} {scenario.params.symbol} @ ${scenario.params.price}
              </div>
            </div>
          ))}

          {/* Custom Trade Form */}
          <div style={{ marginTop: 20, fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#e8e8e8' }}>Custom Trade</div>
          <div style={{ backgroundColor: '#1a1a24', borderRadius: 10, padding: 16, border: '1px solid #2a2a3a' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <input value={customForm.symbol} onChange={e => setCustomForm(p => ({ ...p, symbol: e.target.value.toUpperCase() }))} placeholder="Symbol" style={{ padding: '10px 12px', backgroundColor: '#08080d', border: '1px solid #2a2a3a', borderRadius: 8, color: '#e8e8e8', fontSize: 13, outline: 'none' }} />
              <select value={customForm.side} onChange={e => setCustomForm(p => ({ ...p, side: e.target.value as 'buy' | 'sell' }))} style={{ padding: '10px 12px', backgroundColor: '#08080d', border: '1px solid #2a2a3a', borderRadius: 8, color: '#e8e8e8', fontSize: 13, outline: 'none' }}>
                <option value="buy">BUY</option>
                <option value="sell">SELL</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <input value={customForm.quantity} onChange={e => setCustomForm(p => ({ ...p, quantity: e.target.value }))} placeholder="Quantity" type="number" style={{ padding: '10px 12px', backgroundColor: '#08080d', border: '1px solid #2a2a3a', borderRadius: 8, color: '#e8e8e8', fontSize: 13, outline: 'none' }} />
              <input value={customForm.price} onChange={e => setCustomForm(p => ({ ...p, price: e.target.value }))} placeholder="Price" type="number" style={{ padding: '10px 12px', backgroundColor: '#08080d', border: '1px solid #2a2a3a', borderRadius: 8, color: '#e8e8e8', fontSize: 13, outline: 'none' }} />
            </div>
            <button onClick={runCustom} disabled={!customForm.symbol || !customForm.quantity || !customForm.price} style={{ width: '100%', padding: '10px 0', backgroundColor: '#8a5cf6', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13, opacity: !customForm.symbol ? 0.5 : 1 }}>
              Run Guard Check
            </button>
          </div>
        </div>

        {/* Right: Guard Result */}
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: '#e8e8e8' }}>Guard Analysis</div>
          <div style={{ backgroundColor: '#1a1a24', borderRadius: 10, border: '1px solid #2a2a3a', minHeight: 400 }}>
            {activeScenario ? (
              <div style={{ padding: 16 }}>
                <div style={{ fontSize: 13, color: '#6b6b80', marginBottom: 12 }}>
                  Scenario: <span style={{ color: '#e8e8e8', fontWeight: 600 }}>{activeScenario.name}</span>
                </div>
                <TradeGuard
                  symbol={activeScenario.params.symbol}
                  side={activeScenario.params.side}
                  quantity={activeScenario.params.quantity}
                  price={activeScenario.params.price}
                  onProceed={() => logResult(activeScenario.name, 'PROCEEDED')}
                  onCancel={() => setActiveScenario(null)}
                />
              </div>
            ) : showCustomGuard && customForm.symbol ? (
              <div style={{ padding: 16 }}>
                <div style={{ fontSize: 13, color: '#6b6b80', marginBottom: 12 }}>
                  Custom: <span style={{ color: '#e8e8e8', fontWeight: 600 }}>{customForm.side.toUpperCase()} {customForm.quantity} {customForm.symbol} @ ${customForm.price}</span>
                </div>
                <TradeGuard
                  symbol={customForm.symbol}
                  side={customForm.side}
                  quantity={parseInt(customForm.quantity)}
                  price={parseFloat(customForm.price)}
                  onProceed={() => logResult('custom', 'PROCEEDED')}
                  onCancel={() => setShowCustomGuard(false)}
                />
              </div>
            ) : (
              <div style={{ padding: 60, textAlign: 'center' }}>
                <ShieldCheck size={40} color="#2a2a3a" />
                <div style={{ color: '#6b6b80', fontSize: 13, marginTop: 16 }}>Select a scenario or enter a custom trade to run the guard analysis</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
