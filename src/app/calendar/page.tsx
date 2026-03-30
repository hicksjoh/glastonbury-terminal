'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';

interface EconEvent {
  event: string;
  date: string;
  country: string;
  actual: string | null;
  previous: string | null;
  consensus: string | null;
  impact: string;
}

export default function CalendarPage() {
  const [events, setEvents] = useState<EconEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await fetch('/api/economic-calendar');
        if (res.ok) {
          const data = await res.json();
          setEvents(data.events || []);
        }
      } catch (err) {
        console.error('Calendar fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, []);

  const impactColor: Record<string, string> = {
    High: '#f87171',
    Medium: '#f0c674',
    Low: '#4ade80',
  };

  const filtered = events.filter(e => {
    if (filter === 'all') return true;
    if (filter === 'high') return e.impact === 'High';
    if (filter === 'us') return e.country === 'US';
    return true;
  });

  const grouped = filtered.reduce((acc: Record<string, EconEvent[]>, e) => {
    const d = e.date.split('T')[0];
    if (!acc[d]) acc[d] = [];
    acc[d].push(e);
    return acc;
  }, {});

  const formatDate = (d: string) => {
    const date = new Date(d + 'T12:00:00');
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const diff = date.getTime() - today.getTime();
    const days = Math.round(diff / (1000 * 60 * 60 * 24));

    const label = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    if (days === 0) return `Today \u2014 ${label}`;
    if (days === 1) return `Tomorrow \u2014 ${label}`;
    if (days === -1) return `Yesterday \u2014 ${label}`;
    return label;
  };

  return (
    <AppShell>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Economic Calendar</h1>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 24px' }}>Upcoming macro events that move markets</p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {[
            { label: 'All Events', value: 'all' },
            { label: 'High Impact', value: 'high' },
            { label: 'US Only', value: 'us' },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                border: filter === f.value ? '1px solid #f0c674' : '1px solid rgba(255,255,255,0.1)',
                background: filter === f.value ? 'rgba(240, 198, 116, 0.15)' : 'rgba(255,255,255,0.03)',
                color: filter === f.value ? '#f0c674' : '#888',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>Loading calendar...</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>No upcoming events</div>
        ) : (
          Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([date, evts]) => (
            <div key={date} style={{ marginBottom: 24 }}>
              <div style={{
                color: '#f0c674',
                fontSize: 13,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '8px 0',
                borderBottom: '1px solid rgba(240, 198, 116, 0.2)',
                marginBottom: 8,
              }}>
                {formatDate(date)}
              </div>
              <div style={{ overflowX: 'auto' }}>
                {/* Column headers */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '60px 6px 1fr 80px 80px 80px',
                  alignItems: 'center',
                  gap: 12,
                  padding: '6px 8px',
                  fontSize: 10,
                  color: '#555',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}>
                  <span>Country</span>
                  <span></span>
                  <span>Event</span>
                  <span style={{ textAlign: 'right' }}>Forecast</span>
                  <span style={{ textAlign: 'right' }}>Previous</span>
                  <span style={{ textAlign: 'right' }}>Actual</span>
                </div>
                {evts.map((e, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '60px 6px 1fr 80px 80px 80px',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 8px',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                    }}
                  >
                    <span style={{ color: '#888', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                      {e.country}
                    </span>
                    <div style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: impactColor[e.impact] || '#555',
                    }} />
                    <span style={{ color: '#d0d0e0', fontSize: 13, fontWeight: 500 }}>
                      {e.event}
                    </span>
                    <span style={{ color: '#888', fontSize: 12, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                      {e.consensus || '-'}
                    </span>
                    <span style={{ color: '#888', fontSize: 12, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                      {e.previous || '-'}
                    </span>
                    <span style={{
                      color: e.actual ? '#fff' : '#555',
                      fontSize: 12,
                      textAlign: 'right',
                      fontWeight: e.actual ? 600 : 400,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {e.actual || 'Pending'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
