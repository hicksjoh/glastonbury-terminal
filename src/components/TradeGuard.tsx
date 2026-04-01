'use client';
import { useState, useEffect } from 'react';
import { ShieldCheck, ShieldAlert, AlertTriangle, TrendingUp, Brain, Target, Loader2 } from 'lucide-react';

interface TradeGuardProps {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  onProceed: () => void;
  onCancel: () => void;
  onAdjustSize?: (newQty: number) => void;
}

interface GuardResponse {
  success: boolean;
  verdict: 'CLEAR' | 'CAUTION' | 'STOP';
  verdictMessage: string;
  behavioral: {
    alerts: { type: string; severity: string; title: string; message: string; recommendation: string }[];
    alertCount: number;
    hasCritical: boolean;
  };
  sizing: {
    portfolioEquity: number;
    proposedShares: number;
    proposedDollars: number;
    proposedPct: string;
    kelly: {
      recommendation: string;
      fullKellyPct: string;
      halfKellyPct: string;
      halfKellyDollars: number;
      halfKellyShares: number;
      regimeAdjustedPct: string;
      regimeAdjustedDollars: number;
      regimeAdjustedShares: number;
    };
    verdict: string;
    verdictMessage: string;
  };
  regime: {
    state: string;
    label: string;
    confidence: number;
    advice: string;
    vix: number | null;
    regimeMultiplier: number;
  };
  concentration: {
    currentExposure: number;
    afterTradeExposure: number;
    concentrationPct: string;
    warning: string | null;
  };
}

const VERDICT_CONFIG = {
  CLEAR: { color: '#4ade80', bg: '#4ade8010', border: '#4ade8030', icon: ShieldCheck, label: 'CLEAR TO TRADE' },
  CAUTION: { color: '#f0c674', bg: '#f0c67410', border: '#f0c67430', icon: ShieldAlert, label: 'PROCEED WITH CAUTION' },
  STOP: { color: '#f87171', bg: '#f8717110', border: '#f8717130', icon: AlertTriangle, label: 'REVIEW REQUIRED' },
};

export default function TradeGuard({ symbol, side, quantity, price, onProceed, onCancel, onAdjustSize }: TradeGuardProps) {
  const [data, setData] = useState<GuardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch('/api/trade-guard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, side, quantity, price }),
    })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [symbol, side, quantity, price]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Loader2 size={24} color="#8a5cf6" style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ color: '#6b6b80', fontSize: 13, marginTop: 12 }}>Keisha is analyzing this trade...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>Guard check failed: {error || 'Unknown error'}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '10px 0', backgroundColor: '#2a2a3a', border: 'none', borderRadius: 8, color: '#e8e8e8', cursor: 'pointer', fontWeight: 600 }}>Back</button>
          <button onClick={onProceed} style={{ flex: 2, padding: '10px 0', backgroundColor: '#f59e0b', border: 'none', borderRadius: 8, color: '#08080d', cursor: 'pointer', fontWeight: 700 }}>Proceed Anyway</button>
        </div>
      </div>
    );
  }

  const v = VERDICT_CONFIG[data.verdict];
  const VerdictIcon = v.icon;
  const needsAck = data.verdict !== 'CLEAR';

  return (
    <div>
      {/* Verdict Banner */}
      <div style={{ backgroundColor: v.bg, border: `1px solid ${v.border}`, borderRadius: 10, padding: '14px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <VerdictIcon size={22} color={v.color} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: v.color, letterSpacing: '0.05em' }}>{v.label}</div>
          <div style={{ fontSize: 12, color: '#a0a0b0', marginTop: 2 }}>{data.verdictMessage}</div>
        </div>
      </div>

      {/* Behavioral Alerts */}
      {data.behavioral.alertCount > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Brain size={12} /> Behavioral Analysis
          </div>
          {data.behavioral.alerts.map((alert, i) => (
            <div key={i} style={{ backgroundColor: alert.severity === 'critical' ? '#f8717108' : '#f0c67408', border: `1px solid ${alert.severity === 'critical' ? '#f8717125' : '#f0c67425'}`, borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: alert.severity === 'critical' ? '#f87171' : '#f0c674', marginBottom: 4 }}>{alert.title}</div>
              <div style={{ fontSize: 12, color: '#a0a0b0', lineHeight: 1.5, marginBottom: 8 }}>{alert.message}</div>
              <div style={{ fontSize: 11, color: '#8a5cf6', fontStyle: 'italic' }}>{alert.recommendation}</div>
            </div>
          ))}
        </div>
      )}

      {/* Kelly Position Sizing */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Target size={12} /> Kelly Criterion Sizing
        </div>
        <div style={{ backgroundColor: '#1a1a24', borderRadius: 8, padding: 12, border: '1px solid #2a2a3a' }}>
          {/* Sizing comparison */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: '#6b6b80', marginBottom: 2 }}>YOUR SIZE</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: data.sizing.verdict === 'way_oversized' ? '#f87171' : data.sizing.verdict === 'optimal' ? '#4ade80' : '#e8e8e8' }}>
                {data.sizing.proposedShares} shares
              </div>
              <div style={{ fontSize: 11, color: '#6b6b80' }}>${data.sizing.proposedDollars.toLocaleString()} ({data.sizing.proposedPct}%)</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#6b6b80', marginBottom: 2 }}>KELLY RECOMMENDS</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#8a5cf6' }}>
                {data.sizing.kelly.regimeAdjustedShares} shares
              </div>
              <div style={{ fontSize: 11, color: '#6b6b80' }}>${data.sizing.kelly.regimeAdjustedDollars.toLocaleString()} ({data.sizing.kelly.regimeAdjustedPct}%)</div>
            </div>
          </div>

          {/* Sizing bar visual */}
          <div style={{ position: 'relative', height: 6, backgroundColor: '#2a2a3a', borderRadius: 3, marginBottom: 8 }}>
            <div style={{ position: 'absolute', height: '100%', width: `${Math.min(100, parseFloat(data.sizing.kelly.regimeAdjustedPct) * 4)}%`, backgroundColor: '#8a5cf620', borderRadius: 3 }} />
            <div style={{ position: 'absolute', height: '100%', width: `${Math.min(100, parseFloat(data.sizing.proposedPct) * 4)}%`, backgroundColor: data.sizing.verdict === 'way_oversized' ? '#f87171' : data.sizing.verdict === 'optimal' ? '#4ade80' : '#f0c674', borderRadius: 3 }} />
          </div>

          <div style={{ fontSize: 12, color: '#a0a0b0', lineHeight: 1.4 }}>{data.sizing.verdictMessage}</div>
          <div style={{ fontSize: 11, color: '#6b6b80', marginTop: 4 }}>{data.sizing.kelly.recommendation}</div>

          {/* Adjust button if oversized */}
          {(data.sizing.verdict === 'oversized' || data.sizing.verdict === 'way_oversized') && onAdjustSize && (
            <button
              onClick={() => onAdjustSize(data.sizing.kelly.regimeAdjustedShares)}
              style={{ marginTop: 10, padding: '8px 16px', backgroundColor: '#8a5cf620', border: '1px solid #8a5cf640', borderRadius: 8, color: '#8a5cf6', fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%' }}
            >
              Adjust to {data.sizing.kelly.regimeAdjustedShares} shares (regime-adjusted Kelly)
            </button>
          )}
        </div>
      </div>

      {/* Market Regime */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <TrendingUp size={12} /> Market Regime
        </div>
        <div style={{ backgroundColor: '#1a1a24', borderRadius: 8, padding: 12, border: '1px solid #2a2a3a' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: data.regime.state.includes('bull') ? '#4ade80' : '#f87171' }}>{data.regime.label}</span>
            <span style={{ fontSize: 11, color: '#6b6b80' }}>
              {(data.regime.confidence * 100).toFixed(0)}% confidence
              {data.regime.vix && ` · VIX ${data.regime.vix.toFixed(1)}`}
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#a0a0b0', lineHeight: 1.4 }}>{data.regime.advice}</div>
          <div style={{ fontSize: 11, color: '#6b6b80', marginTop: 6 }}>
            Kelly multiplier: {data.regime.regimeMultiplier}x (sizing scaled {data.regime.regimeMultiplier < 1 ? 'down' : 'at full'} for current regime)
          </div>
        </div>
      </div>

      {/* Concentration Warning */}
      {data.concentration.warning && (
        <div style={{ backgroundColor: '#f59e0b08', border: '1px solid #f59e0b25', borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#f0c674', lineHeight: 1.4 }}>{data.concentration.warning}</div>
        </div>
      )}

      {/* Acknowledge checkbox for non-CLEAR verdicts */}
      {needsAck && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} style={{ accentColor: '#8a5cf6' }} />
          <span style={{ fontSize: 12, color: '#a0a0b0' }}>I&apos;ve reviewed Keisha&apos;s analysis and want to proceed</span>
        </label>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: '12px 0', backgroundColor: '#2a2a3a', border: 'none', borderRadius: 8, color: '#e8e8e8', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
          Back
        </button>
        <button
          onClick={onProceed}
          disabled={needsAck && !acknowledged}
          style={{
            flex: 2, padding: '12px 0', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 14,
            backgroundColor: side === 'buy' ? '#22c55e' : '#ef4444',
            color: '#fff',
            cursor: needsAck && !acknowledged ? 'not-allowed' : 'pointer',
            opacity: needsAck && !acknowledged ? 0.4 : 1,
          }}
        >
          {data.verdict === 'STOP' ? 'Proceed Anyway' : `Confirm ${side.toUpperCase()}`}
        </button>
      </div>
    </div>
  );
}
