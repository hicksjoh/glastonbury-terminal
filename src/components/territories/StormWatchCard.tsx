'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type ThreatLevel = 'clear' | 'watch' | 'warning' | 'direct_hit';

type StormAlert = {
  id: string;
  storm_id: string;
  storm_name: string;
  category: string | null;
  threat_level: ThreatLevel;
  impacted_territory_ids: string[];
  impacted_zips: string[];
  recommended_long_basket: string[];
  recommended_short_basket: string[];
  suggested_sizing_notes: string | null;
  created_at: string;
};

type Territory = { territory_id: string; region: string | null; county: string | null; zip_codes: string[] };

const THREAT_COLOR: Record<ThreatLevel, string> = {
  clear: '#8888a8',
  watch: '#f0c674',
  warning: '#f97316',
  direct_hit: '#f87171',
};

const THREAT_LABEL: Record<ThreatLevel, string> = {
  clear: 'Clear',
  watch: 'Watch',
  warning: 'Warning',
  direct_hit: 'Direct Hit',
};

export function StormWatchCard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<StormAlert[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [threatMap, setThreatMap] = useState<Record<string, ThreatLevel>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/storm/status');
      if (!res.ok) return;
      const body = await res.json();
      setAlerts(body.alerts ?? []);
      setTerritories(body.territories ?? []);
      setThreatMap(body.territoryThreat ?? {});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);

  const activeAlert = alerts.find(a => a.threat_level !== 'clear');
  const activeStorms = alerts.filter(a => a.threat_level !== 'clear').length;

  const openTradeTicket = (ticker: string) => {
    router.push(`/trading?ticker=${encodeURIComponent(ticker)}&source=storm-watch`);
  };

  const runMockTest = async () => {
    if (!confirm('Trigger the mock Miami-bound storm (for QA only)?')) return;
    await fetch('/api/cron/storm-watch?mock=miami').catch(() => {});
    setTimeout(load, 800);
  };

  return (
    <div style={{
      padding: 18,
      background: activeAlert
        ? `linear-gradient(135deg, ${THREAT_COLOR[activeAlert.threat_level]}18, rgba(255,255,255,0.02))`
        : 'rgba(255,255,255,0.03)',
      border: `2px solid ${activeAlert ? THREAT_COLOR[activeAlert.threat_level] : 'rgba(138,92,246,0.15)'}`,
      borderRadius: 14, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: activeAlert ? THREAT_COLOR[activeAlert.threat_level] : '#888', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Storm Watch — NOAA NHC
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8', marginTop: 4 }}>
            {loading ? 'Loading…' : activeAlert
              ? `${activeAlert.storm_name} — ${THREAT_LABEL[activeAlert.threat_level]} on ${activeAlert.impacted_territory_ids.length} territory(ies)`
              : `All clear · ${territories.length} Seacoast FL territories monitored`}
          </div>
        </div>
        <button
          onClick={runMockTest}
          style={{ background: 'none', border: '1px solid #333', color: '#888', padding: '4px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer' }}
          title="QA: fire a synthetic Miami-bound storm"
        >
          Fire mock
        </button>
      </div>

      {/* Heatmap grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 6, marginBottom: 10,
      }}>
        {territories.map(t => {
          const threat = threatMap[t.territory_id] ?? 'clear';
          return (
            <div key={t.territory_id} style={{
              padding: '8px 10px', borderRadius: 8,
              background: threat === 'clear' ? 'rgba(255,255,255,0.02)' : `${THREAT_COLOR[threat]}18`,
              border: `1px solid ${threat === 'clear' ? '#222' : THREAT_COLOR[threat]}`,
            }}>
              <div style={{ fontSize: 9, color: THREAT_COLOR[threat], textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
                {THREAT_LABEL[threat]}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#e8e8e8', fontFamily: "'JetBrains Mono', monospace" }}>
                {t.territory_id}
              </div>
              <div style={{ fontSize: 10, color: '#888' }}>
                {t.county ?? '—'} · {t.zip_codes.length} ZIPs
              </div>
            </div>
          );
        })}
      </div>

      {/* Active alert details */}
      {activeAlert && (
        <div style={{ padding: 12, background: 'rgba(0,0,0,0.3)', borderRadius: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#d0d0e0', lineHeight: 1.5, marginBottom: 10 }}>
            {activeAlert.suggested_sizing_notes}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 9, color: '#4ade80', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Long basket</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {activeAlert.recommended_long_basket.map(t => (
                  <button key={t} onClick={() => openTradeTicket(t)}
                    style={{ padding: '3px 8px', fontSize: 11, fontWeight: 700, background: 'rgba(74,222,128,0.12)', border: '1px solid #4ade80', borderRadius: 4, color: '#4ade80', cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace" }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#f87171', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Short basket</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {activeAlert.recommended_short_basket.map(t => (
                  <button key={t} onClick={() => openTradeTicket(t)}
                    style={{ padding: '3px 8px', fontSize: 11, fontWeight: 700, background: 'rgba(248,113,113,0.12)', border: '1px solid #f87171', borderRadius: 4, color: '#f87171', cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace" }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Live NHC cone embed */}
      <details style={{ fontSize: 11, color: '#666' }}>
        <summary style={{ cursor: 'pointer' }}>Live NHC outlook (Atlantic basin)</summary>
        <div style={{ marginTop: 8 }}>
          <iframe
            src="https://www.nhc.noaa.gov/xgtwo/two_atl_5d0.png"
            sandbox=""
            style={{ width: '100%', height: 360, border: '1px solid #222', borderRadius: 8, background: '#0a0a1a' }}
            title="NHC 5-day tropical weather outlook"
          />
        </div>
      </details>
    </div>
  );
}
