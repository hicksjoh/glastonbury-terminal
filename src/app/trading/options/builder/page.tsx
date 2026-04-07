'use client';

import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import StrategyBuilder from '@/components/options/StrategyBuilder';
import type { OptionLeg } from '@/lib/options/types';

export default function StrategyBuilderPage() {
  async function handlePlaceOrder(legs: OptionLeg[]) {
    if (legs.length < 2) return;

    const multiLegOrder = {
      legs: legs.map(leg => ({
        symbol: leg.symbol || '',
        side: leg.action.includes('buy') ? 'buy' : 'sell',
        ratio_qty: leg.quantity,
      })),
      type: 'limit',
      time_in_force: 'day',
    };

    try {
      const res = await fetch('/api/options/order/multi-leg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(multiLegOrder),
      });
      const data = await res.json();
      if (data.success) {
        alert('Multi-leg order submitted!');
      } else {
        alert(`Order failed: ${data.error}`);
      }
    } catch {
      alert('Failed to submit order');
    }
  }

  return (
    <ErrorBoundary label="StrategyBuilder">
    <AppShell>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#e8e8e8', margin: 0 }}>Strategy Builder</h1>
        <p style={{ color: '#6b6b80', fontSize: 13, marginTop: 4 }}>
          Build multi-leg options strategies with real-time payoff visualization
        </p>
      </div>
      <StrategyBuilder onPlaceOrder={handlePlaceOrder} />
    </AppShell>
    </ErrorBoundary>
  );
}
