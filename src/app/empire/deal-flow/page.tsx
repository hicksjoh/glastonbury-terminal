'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LoadingState } from '@/components/LoadingState';
import { Briefcase, MapPin, AlertCircle, Activity, ExternalLink } from 'lucide-react';

interface Deal {
  id: string;
  prospect: string;
  territory: string;
  stage: string;
  value: number;
  last_activity: string;
  next_action: string;
  score: number;
  created: string;
  notes: string;
}

interface Territory {
  id: string;
  name: string;
  ar_agreement: string;
  region: string;
  dma: string;
  status: string;
  strategy: string;
  assigned_to: string | null;
  deal_id: string | null;
  key_zips: string[];
}

interface DealFlowData {
  generated_at: string;
  cc: {
    server: string;
    cc_time: string;
    present_files: string[];
  };
  notion?: {
    pipeline_url: string;
    hub_url: string;
  };
  pipeline: {
    total_deals: number;
    total_value: number;
    by_stage: Record<string, Deal[]>;
    deals: Deal[];
  };
  territories: {
    total: number;
    by_status: Record<string, Territory[]>;
    all: Territory[];
  };
}

// Pipeline stage order — mirrors a typical sales kanban.
const STAGE_ORDER = ['lead', 'contacted', 'qualified', 'meeting', 'offer', 'signed', 'cold'];

const STAGE_COLORS: Record<string, { fg: string; bg: string }> = {
  lead:      { fg: '#8888a8', bg: 'rgba(136,136,168,0.10)' },
  contacted: { fg: '#7dd3fc', bg: 'rgba(125,211,252,0.10)' },
  qualified: { fg: '#f0c674', bg: 'rgba(240,198,116,0.10)' },
  meeting:   { fg: '#a78bfa', bg: 'rgba(167,139,250,0.10)' },
  offer:     { fg: '#fbbf24', bg: 'rgba(251,191,36,0.10)' },
  signed:    { fg: '#4ade80', bg: 'rgba(74,222,128,0.10)' },
  cold:      { fg: '#71717a', bg: 'rgba(113,113,122,0.08)' },
};

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  available: { fg: '#4ade80', bg: 'rgba(74,222,128,0.10)' },
  in_play:   { fg: '#f0c674', bg: 'rgba(240,198,116,0.10)' },
  sold:      { fg: '#22d3ee', bg: 'rgba(34,211,238,0.10)' },
};

function formatCurrency(n: number) {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function StatusPill({ status, palette }: { status: string; palette: Record<string, { fg: string; bg: string }> }) {
  const c = palette[status] ?? { fg: '#8888a8', bg: 'rgba(136,136,168,0.10)' };
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 6,
      background: c.bg, color: c.fg,
      fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
      letterSpacing: '0.06em', fontFamily: "'JetBrains Mono', monospace",
    }}>{status.replace('_', ' ')}</span>
  );
}

export default function DealFlowPage() {
  const [data, setData] = useState<DealFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);

  useEffect(() => {
    fetch('/api/empire/deal-flow')
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) {
          setErr(j.message || j.error || `HTTP ${r.status}`);
          return;
        }
        setData(j as DealFlowData);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary label="DealFlow">
      <AppShell>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Deal Flow</h1>
            {data?.notion?.pipeline_url && (
              <a
                href={data.notion.pipeline_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'rgba(138,92,246,0.10)', border: '1px solid #8a5cf6',
                  borderRadius: 8, padding: '6px 12px',
                  color: '#a78bfa', fontSize: 12, fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                Edit in Notion <ExternalLink size={13} />
              </a>
            )}
          </div>
          <p style={{ color: '#8888a8', fontSize: 14, margin: '0 0 28px' }}>
            Live CR3 franchise pipeline from the Command Center.
            {data && (
              <span style={{ marginLeft: 12, fontSize: 12, color: '#555570' }}>
                Synced {new Date(data.generated_at).toLocaleTimeString()}
              </span>
            )}
          </p>

          {err && (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444',
              borderRadius: 12, padding: 16, marginBottom: 20,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <AlertCircle size={18} color="#ef4444" />
              <div>
                <div style={{ color: '#ef4444', fontWeight: 600, fontSize: 13 }}>
                  Command Center unreachable
                </div>
                <div style={{ color: '#a8a8c0', fontSize: 12, marginTop: 2 }}>{err}</div>
              </div>
            </div>
          )}

          {loading ? (
            <LoadingState variant="table" rows={6} cols={5} />
          ) : data ? (
            <>
              {/* Summary cards */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24,
              }}>
                <Card label="Active Deals" value={String(data.pipeline.total_deals)} accent="#fff"
                  sub={data.pipeline.total_deals === 0 ? 'pipeline empty' : 'in motion'}
                  icon={<Briefcase size={14} color="#8888a8" />} />
                <Card label="Pipeline Value" value={formatCurrency(data.pipeline.total_value)} accent="#4ade80"
                  sub={`${formatCurrency(data.pipeline.total_value / Math.max(1, data.pipeline.total_deals))} avg`}
                  icon={<Activity size={14} color="#8888a8" />} />
                <Card label="Territories Open" value={String(data.territories.by_status.available?.length ?? 0)} accent="#4ade80"
                  sub={`of ${data.territories.total} total`}
                  icon={<MapPin size={14} color="#8888a8" />} />
                <Card label="In Play" value={String(data.territories.by_status.in_play?.length ?? 0)} accent="#f0c674"
                  sub={`${data.territories.by_status.sold?.length ?? 0} sold`}
                  icon={<MapPin size={14} color="#8888a8" />} />
              </div>

              {/* Pipeline kanban */}
              <h2 style={{ fontSize: 16, color: '#e8e8f0', margin: '8px 0 12px', fontWeight: 600 }}>Pipeline by stage</h2>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 32,
              }}>
                {STAGE_ORDER.map((stage) => {
                  const stageDeals = data.pipeline.by_stage[stage] ?? [];
                  const stageColor = STAGE_COLORS[stage] ?? STAGE_COLORS.lead;
                  return (
                    <div key={stage} style={{
                      background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35',
                      borderRadius: 10, padding: 10, minHeight: 120,
                    }}>
                      <div style={{
                        color: stageColor.fg, fontSize: 10, fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8,
                        fontFamily: "'JetBrains Mono', monospace",
                        display: 'flex', justifyContent: 'space-between',
                      }}>
                        <span>{stage}</span>
                        <span style={{ color: '#555570' }}>{stageDeals.length}</span>
                      </div>
                      {stageDeals.map((d) => (
                        <button key={d.id} onClick={() => setSelectedDeal(d)} style={{
                          width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid #2a2a40',
                          borderRadius: 6, padding: '6px 8px', marginBottom: 6, cursor: 'pointer',
                          textAlign: 'left',
                        }}>
                          <div style={{ color: '#e8e8f0', fontSize: 12, fontWeight: 600 }}>{d.prospect}</div>
                          <div style={{ color: '#8888a8', fontSize: 10, marginTop: 2 }}>
                            {d.territory || '—'} · {formatCurrency(d.value)}
                          </div>
                        </button>
                      ))}
                      {stageDeals.length === 0 && (
                        <div style={{ color: '#3a3a50', fontSize: 11, textAlign: 'center', marginTop: 16 }}>—</div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Deal detail panel */}
              {selectedDeal && (
                <div style={{
                  background: 'rgba(255,255,255,0.03)', border: '1px solid #2a2a40',
                  borderRadius: 12, padding: 20, marginBottom: 32,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <div style={{ color: '#8888a8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                        Selected deal · {selectedDeal.id}
                      </div>
                      <div style={{ color: '#fff', fontSize: 22, fontWeight: 700 }}>{selectedDeal.prospect}</div>
                    </div>
                    <button onClick={() => setSelectedDeal(null)} style={{
                      background: 'transparent', border: '1px solid #2a2a40', borderRadius: 6,
                      color: '#8888a8', padding: '6px 12px', cursor: 'pointer', fontSize: 12,
                    }}>Close</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
                    <DetailField label="Stage" value={<StatusPill status={selectedDeal.stage} palette={STAGE_COLORS} />} />
                    <DetailField label="Value" value={<span style={{ color: '#4ade80', fontWeight: 700 }}>{formatCurrency(selectedDeal.value)}</span>} />
                    <DetailField label="Territory" value={selectedDeal.territory || '—'} />
                    <DetailField label="Score" value={`${selectedDeal.score}/100`} />
                  </div>
                  <DetailField label="Next action" value={selectedDeal.next_action || '—'} mono />
                  {selectedDeal.notes && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ color: '#8888a8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Notes</div>
                      <pre style={{
                        background: 'rgba(0,0,0,0.3)', border: '1px solid #1e1e35', borderRadius: 8,
                        padding: 12, color: '#c0c0d0', fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
                      }}>{selectedDeal.notes}</pre>
                    </div>
                  )}
                </div>
              )}

              {/* Territory grid */}
              <h2 style={{ fontSize: 16, color: '#e8e8f0', margin: '8px 0 12px', fontWeight: 600 }}>
                Territories <span style={{ color: '#555570', fontSize: 13, fontWeight: 400 }}>· {data.territories.total} total</span>
              </h2>
              <div style={{
                background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35',
                borderRadius: 12, overflow: 'hidden',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1e1e35' }}>
                      {['Territory', 'Name', 'Region', 'AR Agreement', 'Status', 'Deal'].map(h => (
                        <th key={h} style={{
                          padding: '12px 16px', textAlign: 'left', color: '#8888a8',
                          fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                          letterSpacing: '0.08em', fontFamily: "'JetBrains Mono', monospace",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.territories.all.map(t => (
                      <tr key={t.id} style={{ borderBottom: '1px solid #1a1a2a' }}>
                        <td style={{ padding: '10px 16px', color: '#e8e8f0', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{t.id}</td>
                        <td style={{ padding: '10px 16px', color: '#c0c0d0', fontSize: 13 }}>{t.name}</td>
                        <td style={{ padding: '10px 16px', color: '#8888a8', fontSize: 12 }}>{t.region}</td>
                        <td style={{ padding: '10px 16px', color: '#8888a8', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{t.ar_agreement}</td>
                        <td style={{ padding: '10px 16px' }}><StatusPill status={t.status} palette={STATUS_COLORS} /></td>
                        <td style={{ padding: '10px 16px', color: '#8888a8', fontSize: 12 }}>{t.deal_id ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ color: '#3a3a50', fontSize: 11, marginTop: 16, fontFamily: "'JetBrains Mono', monospace" }}>
                CC server · {data.cc.server} · {new Date(data.cc.cc_time).toLocaleString()} · {data.cc.present_files.length} agent files present
              </div>
            </>
          ) : null}
        </div>
      </AppShell>
    </ErrorBoundary>
  );
}

function Card({ label, value, accent, sub, icon }: { label: string; value: string; accent: string; sub: string; icon: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35',
      borderRadius: 14, padding: 16,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6,
      }}>
        <div style={{
          color: '#8888a8', fontSize: 11, textTransform: 'uppercase',
          letterSpacing: '0.08em', fontFamily: "'JetBrains Mono', monospace",
        }}>{label}</div>
        {icon}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      <div style={{ color: '#555570', fontSize: 11, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div style={{ color: '#8888a8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      <div style={{
        color: '#e8e8f0', fontSize: 13,
        fontFamily: mono ? "'JetBrains Mono', monospace" : 'inherit',
      }}>{value}</div>
    </div>
  );
}
