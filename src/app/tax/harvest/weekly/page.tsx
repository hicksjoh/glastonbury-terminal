'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';

const FEATURE = process.env.NEXT_PUBLIC_FEATURE_TAX_HARVEST === 'true';

type Suggestion = {
  id: string;
  week_of: string;
  position_ticker: string;
  position_cost_basis: number | null;
  position_market_value: number | null;
  unrealized_loss: number | null;
  suggested_harvest_qty: number | null;
  swap_candidate_ticker: string | null;
  swap_correlation: number | null;
  wash_sale_safe: boolean;
  estimated_tax_savings_usd: number | null;
  status: 'suggested' | 'queued' | 'executed' | 'rejected';
  notes: string | null;
  created_at: string;
};

const STATUS_COLOR: Record<Suggestion['status'], string> = {
  suggested: '#f0c674',
  queued: '#8a5cf6',
  executed: '#4ade80',
  rejected: '#8888a8',
};

function TaxHarvestPage() {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tax/harvest/list');
      const body = await res.json();
      setSuggestions(body.suggestions ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch('/api/tax/harvest/scan', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? 'Scan failed');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const queueAll = async () => {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    if (ids.length === 0) return;
    if (!confirm(`Queue ${ids.length} suggestion(s) as trade drafts? (Does not execute — drafts land in /trading)`)) return;
    const res = await fetch('/api/tax/harvest/queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status: 'queued' }),
    });
    const body = await res.json();
    if (!res.ok) { setError(body.error ?? 'Queue failed'); return; }
    setSelected({});
    await load();
    if (ids.length === 1) {
      const s = suggestions.find(x => x.id === ids[0]);
      if (s) router.push(`/trading?ticker=${s.position_ticker}&side=sell&qty=${s.suggested_harvest_qty ?? 0}&source=tax-harvest`);
    }
  };

  const reject = async (id: string) => {
    await fetch('/api/tax/harvest/queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], status: 'rejected' }),
    });
    await load();
  };

  // Group by week_of
  const byWeek = suggestions.reduce<Record<string, Suggestion[]>>((acc, s) => {
    (acc[s.week_of] ??= []).push(s);
    return acc;
  }, {});
  const weeks = Object.keys(byWeek).sort().reverse();
  const currentWeek = weeks[0];
  const current = byWeek[currentWeek] ?? [];
  const currentSelectedCount = current.filter(s => selected[s.id] && s.status === 'suggested').length;
  const totalSavings = current.filter(s => s.status === 'suggested').reduce((sum, s) => sum + (s.estimated_tax_savings_usd ?? 0), 0);

  return (
    <AppShell>
      <div style={{ minHeight: '100vh', padding: '16px 0', color: '#e8e8e8' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 6 }}>Weekly Tax-Loss Harvester</h1>
        <p style={{ fontSize: 13, color: '#888', margin: 0, marginBottom: 20 }}>
          Scans Alpaca for unrealized losses. Flags wash-sale-safe correlated ETF swaps. Never auto-executes.
        </p>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
          <button
            onClick={runScan}
            disabled={scanning}
            style={{
              padding: '10px 20px', fontSize: 14, fontWeight: 700,
              background: scanning ? 'rgba(138,92,246,0.2)' : 'linear-gradient(135deg, #8a5cf6, #6b3fc4)',
              border: 'none', borderRadius: 8, color: '#fff', cursor: scanning ? 'wait' : 'pointer',
              opacity: scanning ? 0.7 : 1,
            }}
          >
            {scanning ? 'Scanning…' : 'Run Scan Now'}
          </button>
          {currentSelectedCount > 0 && (
            <button onClick={queueAll} style={{ padding: '10px 20px', fontSize: 14, fontWeight: 700, background: 'linear-gradient(135deg, #4ade80, #2fa860)', border: 'none', borderRadius: 8, color: '#080b14', cursor: 'pointer' }}>
              Queue {currentSelectedCount} as trade drafts
            </button>
          )}
          {current.length > 0 && (
            <span style={{ fontSize: 12, color: '#888', marginLeft: 'auto' }}>
              Week of {currentWeek} · ${totalSavings.toFixed(0)} potential savings on {current.length} positions
            </span>
          )}
        </div>

        {error && (
          <div style={{ padding: 12, background: '#2a1010', color: '#f87171', border: '1px solid #f87171', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, color: '#666', textAlign: 'center' }}>Loading…</div>
        ) : weeks.length === 0 ? (
          <div style={{ padding: 40, color: '#666', textAlign: 'center', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(138,92,246,0.1)', borderRadius: 12 }}>
            No suggestions yet. Click Run Scan Now to look for harvestable losses in your Alpaca portfolio.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {weeks.map(week => (
              <div key={week} style={{ padding: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(138,92,246,0.1)', borderRadius: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                  Week of {week} — {byWeek[week].length} suggestions
                </div>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: '#555', textAlign: 'left' }}>
                      <th style={{ padding: '6px 6px', width: 24 }}></th>
                      <th style={{ padding: '6px 6px' }}>Ticker</th>
                      <th style={{ padding: '6px 6px' }}>Loss</th>
                      <th style={{ padding: '6px 6px' }}>Qty</th>
                      <th style={{ padding: '6px 6px' }}>Swap</th>
                      <th style={{ padding: '6px 6px' }}>Corr</th>
                      <th style={{ padding: '6px 6px' }}>Wash</th>
                      <th style={{ padding: '6px 6px' }}>Tax Savings</th>
                      <th style={{ padding: '6px 6px' }}>Status</th>
                      <th style={{ padding: '6px 6px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {byWeek[week].map(s => (
                      <tr key={s.id} style={{ borderTop: '1px solid #1a1a2a' }}>
                        <td style={{ padding: '8px 6px' }}>
                          {s.status === 'suggested' && (
                            <input
                              type="checkbox"
                              checked={!!selected[s.id]}
                              onChange={e => setSelected(p => ({ ...p, [s.id]: e.target.checked }))}
                            />
                          )}
                        </td>
                        <td style={{ padding: '8px 6px', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{s.position_ticker}</td>
                        <td style={{ padding: '8px 6px', color: '#f87171' }}>${Math.abs(s.unrealized_loss ?? 0).toFixed(0)}</td>
                        <td style={{ padding: '8px 6px', color: '#aaa' }}>{s.suggested_harvest_qty ?? '—'}</td>
                        <td style={{ padding: '8px 6px', fontFamily: "'JetBrains Mono', monospace", color: '#8a5cf6' }}>
                          {s.swap_candidate_ticker ?? '—'}
                        </td>
                        <td style={{ padding: '8px 6px', color: '#aaa' }}>
                          {s.swap_correlation != null ? s.swap_correlation.toFixed(3) : '—'}
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <span style={{
                            padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                            background: s.wash_sale_safe ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
                            color: s.wash_sale_safe ? '#4ade80' : '#f87171',
                          }}>
                            {s.wash_sale_safe ? 'SAFE' : 'RISK'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 6px', color: '#4ade80', fontWeight: 700 }}>
                          ${(s.estimated_tax_savings_usd ?? 0).toFixed(0)}
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <span style={{
                            padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                            background: `${STATUS_COLOR[s.status]}20`, color: STATUS_COLOR[s.status], textTransform: 'uppercase',
                          }}>
                            {s.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                          {s.status === 'suggested' && (
                            <button onClick={() => reject(s.id)} style={{ background: 'none', border: '1px solid #333', color: '#888', padding: '3px 8px', fontSize: 10, borderRadius: 4, cursor: 'pointer' }}>
                              Reject
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {byWeek[week].some(s => s.notes) && (
                  <div style={{ marginTop: 10, padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 6, fontSize: 11, color: '#888', lineHeight: 1.5 }}>
                    {byWeek[week].filter(s => s.notes).slice(0, 3).map(s => (
                      <div key={s.id} style={{ marginBottom: 4 }}>• {s.notes}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function DisabledNotice() {
  return <AppShell><div style={{ padding: 40, color: '#888' }}>Tax harvester disabled. Set NEXT_PUBLIC_FEATURE_TAX_HARVEST=true.</div></AppShell>;
}

export default function Page() {
  return FEATURE ? <TaxHarvestPage /> : <DisabledNotice />;
}
