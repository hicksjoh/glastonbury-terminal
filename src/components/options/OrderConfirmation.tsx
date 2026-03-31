'use client';

import { useState } from 'react';
import type { OrderPreview } from './OptionsOrderForm';
import { daysToExpiration } from '@/lib/options/symbols';

interface OrderConfirmationProps {
  order: OrderPreview;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function OrderConfirmation({ order, onConfirm, onCancel }: OrderConfirmationProps) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const isBuy = order.action.startsWith('buy');
  const dte = daysToExpiration(order.expiration);

  // Warnings
  const warnings: string[] = [];
  if (order.action === 'sell_to_open' && order.maxLoss === -1) {
    warnings.push('This is a naked short — requires margin and carries unlimited risk.');
  }
  if (dte <= 7) {
    warnings.push(`Only ${dte} days to expiration — accelerated time decay.`);
  }
  if (order.premium > 0) {
    const spread = order.limitPrice
      ? Math.abs(order.limitPrice - order.premium) / order.premium
      : 0;
    if (spread > 0.1) {
      warnings.push('Wide bid/ask spread detected — consider a limit order closer to mid.');
    }
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const side = order.action.startsWith('buy') ? 'buy' : 'sell';
      const body: Record<string, unknown> = {
        symbol: order.optionSymbol,
        qty: order.contracts,
        side,
        type: order.orderType,
        time_in_force: 'day',
      };
      if (order.limitPrice) body.limit_price = order.limitPrice;
      if (order.stopPrice) body.stop_price = order.stopPrice;

      const res = await fetch('/api/options/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setResult('success');
        setTimeout(() => onConfirm(), 1500);
      } else {
        const data = await res.json();
        setResult('error');
        setErrorMsg(data.error || 'Order failed');
      }
    } catch {
      setResult('error');
      setErrorMsg('Network error — check connection');
    }
    setSubmitting(false);
  }

  if (result === 'success') {
    return (
      <ModalOverlay onClose={onCancel}>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 12, color: '#4ade80' }}>&#10003;</div>
          <div style={{ color: '#4ade80', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
            Order Submitted
          </div>
          <div style={{ color: '#6b6b80', fontSize: 12 }}>
            {order.contracts} × {order.displayName}
          </div>
        </div>
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay onClose={onCancel}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8', marginBottom: 20 }}>
        Confirm Options Order
      </div>

      {/* Order Details */}
      <div style={{
        background: '#08080d',
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#c9a84c', marginBottom: 4 }}>
          {order.contracts} × {order.displayName}
        </div>
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          color: isBuy ? '#4ade80' : '#ef4444',
          marginBottom: 12,
        }}>
          {order.actionLabel}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { label: 'Order Type', value: order.orderType.toUpperCase() },
            ...(order.limitPrice ? [{ label: 'Limit Price', value: `$${Number(order.limitPrice).toFixed(2)}` }] : []),
            ...(order.stopPrice ? [{ label: 'Stop Price', value: `$${Number(order.stopPrice).toFixed(2)}` }] : []),
            { label: 'Total Premium', value: `$${Number(order.totalCost).toLocaleString()}` },
            { label: 'Max Loss', value: order.maxLoss === -1 ? 'Unlimited' : `$${Number(order.maxLoss).toLocaleString()}` },
            { label: 'Break Even', value: `$${Number(order.breakEven).toFixed(2)}` },
            { label: 'DTE', value: `${dte} days` },
            { label: 'P(Profit)', value: `~${Number(order.probOfProfit).toFixed(0)}%` },
          ].map(({ label, value }) => (
            <div key={label} style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              <span style={{ color: '#6b6b80' }}>{label}</span>
              <span style={{ color: '#e8e8e8' }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
        }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: '#f87171', marginBottom: i < warnings.length - 1 ? 6 : 0 }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {result === 'error' && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid #ef4444',
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
          fontSize: 12,
          color: '#ef4444',
        }}>
          {errorMsg}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '12px 0',
            background: '#2a2a3a',
            border: 'none',
            borderRadius: 8,
            color: '#e8e8e8',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={submitting}
          style={{
            flex: 2,
            padding: '12px 0',
            background: isBuy ? '#4ade80' : '#ef4444',
            border: 'none',
            borderRadius: 8,
            color: '#000',
            cursor: submitting ? 'wait' : 'pointer',
            fontWeight: 700,
            fontSize: 14,
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? 'Submitting...' : `Confirm ${order.actionLabel}`}
        </button>
      </div>
    </ModalOverlay>
  );
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={{
        background: '#1a1a2e',
        border: '1px solid #2a2a3e',
        borderRadius: 12,
        padding: 24,
        maxWidth: 440,
        width: '90%',
        maxHeight: '80vh',
        overflowY: 'auto',
      }}>
        {children}
      </div>
    </div>
  );
}
