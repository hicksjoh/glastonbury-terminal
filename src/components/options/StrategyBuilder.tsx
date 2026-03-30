'use client';

import { useState, useEffect, useCallback } from 'react';
import { STRATEGY_TEMPLATES, buildStrategy } from '@/lib/options/strategies';
import type { StrategyTemplate, OptionLeg } from '@/lib/options/types';
import { formatOptionShort, daysToExpiration, nextMonthlyExpiration } from '@/lib/options/symbols';
import PayoffDiagram from './PayoffDiagram';

interface StrategyBuilderProps {
  initialSymbol?: string;
  onPlaceOrder?: (legs: OptionLeg[]) => void;
}

interface LegEditorState {
  action: 'buy' | 'sell';
  type: 'call' | 'put' | 'stock';
  strike: string;
  expiration: string;
  quantity: string;
  premium: string;
}

export default function StrategyBuilder({ initialSymbol, onPlaceOrder }: StrategyBuilderProps) {
  const [symbol, setSymbol] = useState(initialSymbol || '');
  const [stockPrice, setStockPrice] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<StrategyTemplate | null>(null);
  const [legs, setLegs] = useState<LegEditorState[]>([]);
  const [defaultExp, setDefaultExp] = useState(nextMonthlyExpiration());
  const [availableExpirations, setAvailableExpirations] = useState<string[]>([]);

  // Fetch stock price
  const fetchPrice = useCallback(async (sym: string) => {
    if (!sym) return;
    try {
      const res = await fetch(`/api/alpaca/market-data?symbol=${sym}`);
      const data = await res.json();
      if (data.quote) {
        const price = ((data.quote.ap || 0) + (data.quote.bp || 0)) / 2;
        if (price > 0) setStockPrice(price);
      }
    } catch { /* ignore */ }
  }, []);

  // Fetch expirations
  useEffect(() => {
    if (!symbol) return;
    fetchPrice(symbol);
    fetch(`/api/options/expirations/${symbol}`)
      .then(r => r.json())
      .then(data => {
        const exps = (data.expirations || []).map((e: { date: string }) => e.date);
        setAvailableExpirations(exps);
        if (exps.length > 0) {
          const ideal = exps.find((e: string) => {
            const dte = daysToExpiration(e);
            return dte >= 25 && dte <= 50;
          }) || exps[0];
          setDefaultExp(ideal);
        }
      })
      .catch(() => {});
  }, [symbol, fetchPrice]);

  // When template is selected, auto-populate legs
  function handleTemplateSelect(template: StrategyTemplate) {
    setSelectedTemplate(template);
    if (!stockPrice || !symbol) return;

    const built = buildStrategy(template, symbol, stockPrice, defaultExp);
    const newLegs: LegEditorState[] = built.legs.map(leg => ({
      action: leg.action.includes('buy') ? 'buy' : 'sell',
      type: leg.type,
      strike: leg.strike.toString(),
      expiration: leg.expiration,
      quantity: leg.quantity.toString(),
      premium: (leg.premium || 0).toFixed(2),
    }));
    setLegs(newLegs);
  }

  function addLeg() {
    setLegs([...legs, {
      action: 'buy',
      type: 'call',
      strike: stockPrice ? Math.round(stockPrice).toString() : '0',
      expiration: defaultExp,
      quantity: '1',
      premium: '0.00',
    }]);
  }

  function addStockLeg() {
    setLegs([...legs, {
      action: 'buy',
      type: 'stock',
      strike: stockPrice.toFixed(2),
      expiration: '',
      quantity: '100',
      premium: stockPrice.toFixed(2),
    }]);
  }

  function removeLeg(index: number) {
    setLegs(legs.filter((_, i) => i !== index));
  }

  function updateLeg(index: number, field: keyof LegEditorState, value: string) {
    setLegs(prev => prev.map((leg, i) => i === index ? { ...leg, [field]: value } : leg));
  }

  // Convert legs to payoff diagram format
  const payoffLegs = legs
    .filter(l => l.type !== 'stock')
    .map(l => ({
      type: l.type as 'call' | 'put',
      strike: parseFloat(l.strike) || 0,
      premium: parseFloat(l.premium) || 0,
      quantity: parseInt(l.quantity) || 1,
      isLong: l.action === 'buy',
      expiration: l.expiration,
    }));

  // Calculate net premium
  const netPremium = legs.reduce((sum, leg) => {
    if (leg.type === 'stock') return sum;
    const prem = (parseFloat(leg.premium) || 0) * (parseInt(leg.quantity) || 1) * 100;
    return sum + (leg.action === 'sell' ? prem : -prem);
  }, 0);

  function handlePlaceOrder() {
    const optionLegs: OptionLeg[] = legs
      .filter(l => l.type !== 'stock')
      .map(l => ({
        action: l.action === 'buy' ? 'buy_to_open' as const : 'sell_to_open' as const,
        type: l.type as 'call' | 'put',
        strike: parseFloat(l.strike),
        expiration: l.expiration,
        quantity: parseInt(l.quantity) || 1,
        premium: parseFloat(l.premium) || 0,
      }));
    onPlaceOrder?.(optionLegs);
  }

  const inputStyle: React.CSSProperties = {
    padding: '7px 10px',
    backgroundColor: '#08080d',
    border: '1px solid #2a2a3a',
    borderRadius: 6,
    color: '#e8e8e8',
    fontSize: 12,
    outline: 'none',
    fontFamily: "'JetBrains Mono', monospace",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b6b80' d='M3 4.5l3 3 3-3'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
    paddingRight: 24,
  };

  // Strategy categories
  const categories = [
    { label: 'Income', templates: STRATEGY_TEMPLATES.filter(t => t.category === 'income') },
    { label: 'Directional', templates: STRATEGY_TEMPLATES.filter(t => t.category === 'directional') },
    { label: 'Volatility', templates: STRATEGY_TEMPLATES.filter(t => t.category === 'volatility') },
    { label: 'Hedging', templates: STRATEGY_TEMPLATES.filter(t => t.category === 'hedging') },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 20, minHeight: 600 }}>
      {/* Left Panel: Leg Editor */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Underlying */}
        <div className="terminal-card" style={{ padding: 16 }}>
          <label style={{ fontSize: 11, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Underlying</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              onBlur={() => fetchPrice(symbol)}
              onKeyDown={e => { if (e.key === 'Enter') fetchPrice(symbol); }}
              placeholder="AAPL"
              style={{ ...inputStyle, flex: 1, fontSize: 14, fontWeight: 700 }}
            />
            {stockPrice > 0 && (
              <div style={{
                padding: '7px 12px',
                background: 'rgba(201, 168, 76, 0.08)',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 700,
                color: '#c9a84c',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                ${stockPrice.toFixed(2)}
              </div>
            )}
          </div>
        </div>

        {/* Template Selector */}
        <div className="terminal-card" style={{ padding: 16 }}>
          <label style={{ fontSize: 11, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'block' }}>
            Strategy Template
          </label>
          {categories.map(cat => (
            <div key={cat.label} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: '#555', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4, letterSpacing: '0.05em' }}>
                {cat.label}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {cat.templates.map(t => (
                  <button
                    key={t.slug}
                    onClick={() => handleTemplateSelect(t)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 5,
                      border: selectedTemplate?.slug === t.slug ? '1px solid #c9a84c' : '1px solid #2a2a3a',
                      background: selectedTemplate?.slug === t.slug ? 'rgba(201, 168, 76, 0.12)' : '#1a1a2e',
                      color: selectedTemplate?.slug === t.slug ? '#c9a84c' : '#888',
                      fontSize: 11,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Leg Editor */}
        <div className="terminal-card" style={{ padding: 16, flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Legs ({legs.length})
            </label>
            {netPremium !== 0 && (
              <span style={{
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                color: netPremium > 0 ? '#4ade80' : '#ef4444',
              }}>
                Net {netPremium > 0 ? 'Credit' : 'Debit'}: ${Math.abs(netPremium).toFixed(0)}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {legs.map((leg, i) => (
              <div key={i} style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                padding: '8px 10px',
                background: '#08080d',
                borderRadius: 8,
                borderLeft: `3px solid ${leg.action === 'buy' ? '#4ade80' : '#ef4444'}`,
              }}>
                <span style={{ fontSize: 10, color: '#555', fontWeight: 700, width: 10 }}>{i + 1}</span>
                <select value={leg.action} onChange={e => updateLeg(i, 'action', e.target.value)} style={{ ...selectStyle, width: 68, color: leg.action === 'buy' ? '#4ade80' : '#ef4444' }}>
                  <option value="buy">BUY</option>
                  <option value="sell">SELL</option>
                </select>
                {leg.type !== 'stock' ? (
                  <>
                    <select value={leg.type} onChange={e => updateLeg(i, 'type', e.target.value)} style={{ ...selectStyle, width: 68 }}>
                      <option value="call">CALL</option>
                      <option value="put">PUT</option>
                    </select>
                    <input value={leg.strike} onChange={e => updateLeg(i, 'strike', e.target.value)}
                      placeholder="Strike" style={{ ...inputStyle, width: 60, textAlign: 'right' }} />
                    <select value={leg.expiration} onChange={e => updateLeg(i, 'expiration', e.target.value)}
                      style={{ ...selectStyle, width: 80, fontSize: 10 }}>
                      {availableExpirations.length > 0 ? (
                        availableExpirations.map(exp => (
                          <option key={exp} value={exp}>{formatExpShort(exp)}</option>
                        ))
                      ) : (
                        <option value={leg.expiration}>{formatExpShort(leg.expiration)}</option>
                      )}
                    </select>
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: '#6b6b80', flex: 1 }}>100 shares @ ${stockPrice.toFixed(2)}</span>
                )}
                <input value={leg.quantity} onChange={e => updateLeg(i, 'quantity', e.target.value)}
                  placeholder="Qty" style={{ ...inputStyle, width: 36, textAlign: 'center' }} />
                <button
                  onClick={() => removeLeg(i)}
                  style={{
                    width: 22, height: 22, borderRadius: 4,
                    background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef444430',
                    color: '#ef4444', fontSize: 12, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >×</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={addLeg} style={{
              flex: 1, padding: '8px 0', borderRadius: 6,
              background: 'rgba(138, 92, 246, 0.08)', border: '1px solid #8a5cf630',
              color: '#c4a6ff', fontSize: 12, cursor: 'pointer', fontWeight: 600,
            }}>+ Add Leg</button>
            <button onClick={addStockLeg} style={{
              flex: 1, padding: '8px 0', borderRadius: 6,
              background: 'rgba(201, 168, 76, 0.08)', border: '1px solid #c9a84c30',
              color: '#c9a84c', fontSize: 12, cursor: 'pointer', fontWeight: 600,
            }}>+ Stock Leg</button>
          </div>
        </div>

        {/* Place Order Button */}
        {legs.length >= 2 && (
          <button
            onClick={handlePlaceOrder}
            style={{
              padding: '14px 0', borderRadius: 10,
              background: '#4ade80', border: 'none',
              color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Place Multi-Leg Order
          </button>
        )}
      </div>

      {/* Right Panel: Payoff Diagram */}
      <div className="terminal-card" style={{ padding: 20 }}>
        {payoffLegs.length > 0 && stockPrice > 0 ? (
          <PayoffDiagram
            legs={payoffLegs}
            currentPrice={stockPrice}
            templateName={selectedTemplate?.name}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b6b80', fontSize: 13 }}>
            {!symbol ? 'Enter a symbol and select a strategy to see the payoff diagram' :
             stockPrice === 0 ? 'Loading stock price...' :
             'Add option legs to see the payoff diagram'}
          </div>
        )}
      </div>
    </div>
  );
}

function formatExpShort(dateStr: string): string {
  if (!dateStr) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(dateStr + 'T12:00:00');
  return `${months[d.getMonth()]} ${d.getDate()}`;
}
