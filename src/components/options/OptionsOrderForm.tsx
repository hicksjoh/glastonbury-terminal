'use client';

import { useState, useEffect } from 'react';
import type { OptionChainEntry } from '@/lib/options/types';
import { formatOptionParts } from '@/lib/options/symbols';

interface OptionsOrderFormProps {
  selectedOption?: OptionChainEntry | null;
  selectedSide?: 'call' | 'put';
  onOrderSubmitted?: () => void;
  onShowConfirmation?: (order: OrderPreview) => void;
}

export interface OrderPreview {
  underlying: string;
  optionSymbol: string;
  displayName: string;
  contractType: 'call' | 'put';
  strike: number;
  expiration: string;
  action: string;
  actionLabel: string;
  contracts: number;
  orderType: string;
  limitPrice?: number;
  stopPrice?: number;
  premium: number;
  totalCost: number;
  maxLoss: number;
  breakEven: number;
  probOfProfit: number;
}

const ACTIONS = [
  { value: 'buy_to_open', label: 'Buy to Open', short: 'BTO', color: '#4ade80' },
  { value: 'sell_to_open', label: 'Sell to Open', short: 'STO', color: '#ef4444' },
  { value: 'buy_to_close', label: 'Buy to Close', short: 'BTC', color: '#4ade80' },
  { value: 'sell_to_close', label: 'Sell to Close', short: 'STC', color: '#ef4444' },
];

export default function OptionsOrderForm({
  selectedOption,
  selectedSide,
  onShowConfirmation,
}: OptionsOrderFormProps) {
  const [action, setAction] = useState('buy_to_open');
  const [contracts, setContracts] = useState('1');
  const [orderType, setOrderType] = useState('limit');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');

  // Auto-populate when an option is selected from the chain
  useEffect(() => {
    if (selectedOption) {
      setAction('buy_to_open');
      // Set limit to ask for buys
      if (Number(selectedOption.ask) > 0) {
        setLimitPrice(Number(selectedOption.ask).toFixed(2));
      } else if (Number(selectedOption.last) > 0) {
        setLimitPrice(Number(selectedOption.last).toFixed(2));
      }
    }
  }, [selectedOption]);

  const currentAction = ACTIONS.find(a => a.value === action)!;
  const isBuy = action.startsWith('buy');
  const premium = parseFloat(limitPrice) || selectedOption?.last || 0;
  const qty = parseInt(contracts) || 0;
  const totalCost = premium * qty * 100;

  const strike = selectedOption?.strike || 0;
  const type = selectedSide || selectedOption?.type || 'call';

  // Calculate break-even and max loss
  let breakEven = 0;
  let maxLoss = 0;
  let probOfProfit = 0;

  if (isBuy) {
    breakEven = type === 'call' ? strike + premium : strike - premium;
    maxLoss = totalCost;
    probOfProfit = selectedOption?.delta ? Math.abs(selectedOption.delta) * 100 : 50;
  } else {
    breakEven = type === 'call' ? strike + premium : strike - premium;
    maxLoss = type === 'call' ? Infinity : (strike - premium) * qty * 100;
    probOfProfit = selectedOption?.delta ? (1 - Math.abs(selectedOption.delta)) * 100 : 50;
  }

  function handleReviewOrder() {
    if (!selectedOption) return;

    const displayName = formatOptionParts(
      selectedOption.underlying,
      selectedOption.expiration,
      selectedOption.strike,
      type
    );

    onShowConfirmation?.({
      underlying: selectedOption.underlying,
      optionSymbol: selectedOption.symbol,
      displayName,
      contractType: type,
      strike,
      expiration: selectedOption.expiration,
      action,
      actionLabel: currentAction.label,
      contracts: qty,
      orderType,
      limitPrice: orderType !== 'market' ? parseFloat(limitPrice) : undefined,
      stopPrice: orderType === 'stop' || orderType === 'stop_limit' ? parseFloat(stopPrice) : undefined,
      premium,
      totalCost,
      maxLoss: isFinite(maxLoss) ? maxLoss : -1,
      breakEven,
      probOfProfit,
    });
  }

  const inputStyle: React.CSSProperties = {
    padding: '10px 12px',
    backgroundColor: '#08080d',
    border: '1px solid #2a2a3a',
    borderRadius: 8,
    color: '#e8e8e8',
    fontSize: 14,
    outline: 'none',
    fontFamily: "'JetBrains Mono', monospace",
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div className="terminal-card">
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: '#e8e8e8' }}>
        Options Order
      </div>

      {!selectedOption ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#6b6b80', fontSize: 13 }}>
          Select an option from the chain to place an order
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Selected option display */}
          <div style={{
            background: 'rgba(201, 168, 76, 0.08)',
            border: '1px solid rgba(201, 168, 76, 0.2)',
            borderRadius: 8,
            padding: '10px 14px',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#c9a84c' }}>
              {formatOptionParts(selectedOption.underlying, selectedOption.expiration, strike, type)}
            </div>
            <div style={{ fontSize: 11, color: '#6b6b80', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
              Bid: ${Number(selectedOption.bid).toFixed(2)} &bull; Ask: ${Number(selectedOption.ask).toFixed(2)} &bull; Last: ${Number(selectedOption.last).toFixed(2)}
              {' '}&bull; IV: {Number(selectedOption.impliedVolatility).toFixed(0)}%
            </div>
          </div>

          {/* Action selector — 2x2 grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {ACTIONS.map(a => (
              <button
                key={a.value}
                onClick={() => setAction(a.value)}
                style={{
                  padding: '8px 0',
                  borderRadius: 6,
                  border: action === a.value ? `1px solid ${a.color}` : '1px solid #2a2a3a',
                  background: action === a.value ? `${a.color}15` : '#1a1a2e',
                  color: action === a.value ? a.color : '#6b6b80',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {a.short}
              </button>
            ))}
          </div>

          {/* Contracts */}
          <div>
            <label style={{ fontSize: 11, color: '#6b6b80', display: 'block', marginBottom: 4 }}>Contracts</label>
            <input
              type="number"
              min="1"
              value={contracts}
              onChange={e => setContracts(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Order Type */}
          <div style={{ display: 'flex', gap: 6 }}>
            {['market', 'limit', 'stop', 'stop_limit'].map(t => (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                style={{
                  flex: 1,
                  padding: '7px 0',
                  borderRadius: 6,
                  border: orderType === t ? '1px solid #8a5cf6' : '1px solid #2a2a3a',
                  background: orderType === t ? 'rgba(138, 92, 246, 0.12)' : '#1a1a2e',
                  color: orderType === t ? '#c4a6ff' : '#6b6b80',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {t === 'stop_limit' ? 'STP-LMT' : t}
              </button>
            ))}
          </div>

          {/* Limit Price */}
          {(orderType === 'limit' || orderType === 'stop_limit') && (
            <div>
              <label style={{ fontSize: 11, color: '#6b6b80', display: 'block', marginBottom: 4 }}>Limit Price</label>
              <input
                type="number"
                step="0.01"
                value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
                placeholder="0.00"
                style={inputStyle}
              />
            </div>
          )}

          {/* Stop Price */}
          {(orderType === 'stop' || orderType === 'stop_limit') && (
            <div>
              <label style={{ fontSize: 11, color: '#6b6b80', display: 'block', marginBottom: 4 }}>Stop Price</label>
              <input
                type="number"
                step="0.01"
                value={stopPrice}
                onChange={e => setStopPrice(e.target.value)}
                placeholder="0.00"
                style={inputStyle}
              />
            </div>
          )}

          {/* Order Preview */}
          {qty > 0 && premium > 0 && (
            <div style={{
              background: '#08080d',
              borderRadius: 8,
              padding: 14,
              borderLeft: `3px solid ${currentAction.color}`,
            }}>
              <div style={{ fontSize: 11, color: '#6b6b80', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>
                Order Preview
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e8e8e8', marginBottom: 6 }}>
                {qty} {formatOptionParts(selectedOption.underlying, selectedOption.expiration, strike, type)}
              </div>
              <div style={{ fontSize: 12, color: currentAction.color, marginBottom: 8 }}>
                {currentAction.label}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#6b6b80' }}>Premium</span>
                  <span style={{ color: '#e8e8e8' }}>${Number(premium).toFixed(2)} × {qty} × 100 = ${Number(totalCost).toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#6b6b80' }}>Max Loss</span>
                  <span style={{ color: '#ef4444' }}>
                    {isFinite(maxLoss) ? `$${Number(maxLoss).toLocaleString()}` : 'Unlimited'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#6b6b80' }}>Break Even</span>
                  <span style={{ color: '#c9a84c' }}>${Number(breakEven).toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#6b6b80' }}>P(Profit)</span>
                  <span style={{ color: probOfProfit > 50 ? '#4ade80' : '#ef4444' }}>~{Number(probOfProfit).toFixed(0)}%</span>
                </div>
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleReviewOrder}
            disabled={!selectedOption || qty <= 0}
            style={{
              padding: '12px 0',
              backgroundColor: isBuy ? '#4ade80' : '#ef4444',
              border: 'none',
              borderRadius: 8,
              color: '#000',
              fontWeight: 700,
              cursor: !selectedOption || qty <= 0 ? 'not-allowed' : 'pointer',
              fontSize: 14,
              opacity: !selectedOption || qty <= 0 ? 0.5 : 1,
            }}
          >
            Review Order
          </button>
        </div>
      )}
    </div>
  );
}
