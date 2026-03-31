'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';

interface CalendarEvent {
  title: string;
  date: string;
  layer: 'economic' | 'earnings' | 'options' | 'personal' | 'keisha';
  detail?: string;
  impact?: string;
}

const LAYER_CONFIG: Record<string, { label: string; color: string }> = {
  economic: { label: 'Economic Events', color: '#3b82f6' },
  earnings: { label: 'Earnings', color: '#f97316' },
  options: { label: 'Options Expiry', color: '#8a5cf6' },
  personal: { label: 'Personal Finance', color: '#f0c674' },
  keisha: { label: 'Keisha Actions', color: '#4ade80' },
};

// Hardcoded key dates for 2026
const STATIC_EVENTS: CalendarEvent[] = [
  // FOMC
  { title: 'FOMC Meeting', date: '2026-01-28', layer: 'economic', impact: 'High' },
  { title: 'FOMC Meeting', date: '2026-03-18', layer: 'economic', impact: 'High' },
  { title: 'FOMC Meeting', date: '2026-05-06', layer: 'economic', impact: 'High' },
  { title: 'FOMC Meeting', date: '2026-06-17', layer: 'economic', impact: 'High' },
  { title: 'FOMC Meeting', date: '2026-07-29', layer: 'economic', impact: 'High' },
  { title: 'FOMC Meeting', date: '2026-09-16', layer: 'economic', impact: 'High' },
  { title: 'FOMC Meeting', date: '2026-11-04', layer: 'economic', impact: 'High' },
  { title: 'FOMC Meeting', date: '2026-12-16', layer: 'economic', impact: 'High' },
  // Tax deadlines
  { title: 'Q1 Estimated Tax Due', date: '2026-04-15', layer: 'personal', detail: 'Federal + CA estimated payment' },
  { title: 'Q2 Estimated Tax Due', date: '2026-06-15', layer: 'personal', detail: 'Federal + CA estimated payment' },
  { title: 'Q3 Estimated Tax Due', date: '2026-09-15', layer: 'personal', detail: 'Federal + CA estimated payment' },
  { title: 'Q4 Estimated Tax Due', date: '2027-01-15', layer: 'personal', detail: 'Federal + CA estimated payment' },
  // RSU vests (quarterly)
  { title: 'Anthropic RSU Vest (Q1)', date: '2026-04-01', layer: 'personal', detail: '~1,437 shares vest' },
  { title: 'Anthropic RSU Vest (Q2)', date: '2026-07-01', layer: 'personal', detail: '~1,437 shares vest' },
  { title: 'Anthropic RSU Vest (Q3)', date: '2026-10-01', layer: 'personal', detail: '~1,437 shares vest' },
  { title: 'Anthropic RSU Vest (Q4)', date: '2027-01-01', layer: 'personal', detail: '~1,437 shares vest' },
  // CPI
  { title: 'CPI Report', date: '2026-04-10', layer: 'economic', impact: 'High' },
  { title: 'CPI Report', date: '2026-05-13', layer: 'economic', impact: 'High' },
  { title: 'CPI Report', date: '2026-06-10', layer: 'economic', impact: 'High' },
  // Jobs
  { title: 'Jobs Report (NFP)', date: '2026-04-03', layer: 'economic', impact: 'High' },
  { title: 'Jobs Report (NFP)', date: '2026-05-01', layer: 'economic', impact: 'High' },
  { title: 'Jobs Report (NFP)', date: '2026-06-05', layer: 'economic', impact: 'High' },
];

type ViewMode = 'month' | 'agenda';

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>(STATIC_EVENTS);
  const [layers, setLayers] = useState<Record<string, boolean>>({
    economic: true, earnings: true, options: true, personal: true, keisha: true,
  });
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(false);

  // Fetch economic calendar events from API
  useEffect(() => {
    const fetchEcon = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/economic-calendar');
        if (res.ok) {
          const data = await res.json();
          const econEvents: CalendarEvent[] = (data.events || []).map((e: { event: string; date: string; impact: string }) => ({
            title: e.event,
            date: e.date?.split('T')[0],
            layer: 'economic' as const,
            impact: e.impact,
          }));
          setEvents(prev => [...prev, ...econEvents.filter(e => e.date)]);
        }
      } catch {}
      setLoading(false);
    };
    fetchEcon();
  }, []);

  const toggleLayer = (key: string) => setLayers(prev => ({ ...prev, [key]: !prev[key] }));

  const filteredEvents = events.filter(e => layers[e.layer]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const eventsForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return filteredEvents.filter(e => e.date === dateStr);
  };

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const agendaEvents = filteredEvents
    .filter(e => e.date >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 30);

  return (
    <AppShell>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Financial Calendar</h1>
        <p style={{ color: '#8888a8', fontSize: 14, margin: '0 0 24px' }}>Multi-layer financial event tracking</p>

        {/* Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          {/* Layer toggles */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(LAYER_CONFIG).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => toggleLayer(key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
                  background: layers[key] ? `${cfg.color}18` : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${layers[key] ? cfg.color : '#1e1e35'}`,
                  color: layers[key] ? cfg.color : '#555570',
                }}
              >
                <div style={{
                  width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${layers[key] ? cfg.color : '#555570'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: layers[key] ? cfg.color : 'transparent',
                }}>
                  {layers[key] && <Check size={9} color="#08080d" />}
                </div>
                {cfg.label}
              </button>
            ))}
          </div>

          {/* View toggle */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['month', 'agenda'] as const).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                style={{
                  padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 11, textTransform: 'capitalize',
                  background: viewMode === v ? 'rgba(138,92,246,0.15)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${viewMode === v ? '#8a5cf6' : '#1e1e35'}`,
                  color: viewMode === v ? '#8a5cf6' : '#8888a8',
                }}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {loading && <div style={{ color: '#555570', fontSize: 12, marginBottom: 8 }}>Loading events...</div>}

        {viewMode === 'month' ? (
          <>
            {/* Month Navigation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <button onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8888a8' }}>
                <ChevronLeft size={20} />
              </button>
              <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 600, margin: 0, minWidth: 200, textAlign: 'center' }}>
                {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </h2>
              <button onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8888a8' }}>
                <ChevronRight size={20} />
              </button>
            </div>

            {/* Calendar Grid */}
            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', overflow: 'hidden' }}>
              {/* Day headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #1e1e35' }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} style={{
                    padding: '10px', textAlign: 'center', color: '#555570', fontSize: 11,
                    textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: "'JetBrains Mono', monospace",
                  }}>{d}</div>
                ))}
              </div>
              {/* Day cells */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {Array.from({ length: firstDay }, (_, i) => (
                  <div key={`empty-${i}`} style={{ minHeight: 80, borderBottom: '1px solid rgba(30,30,53,0.5)', borderRight: '1px solid rgba(30,30,53,0.3)' }} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const dayEvents = eventsForDay(day);
                  const today = new Date();
                  const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

                  return (
                    <div key={day} style={{
                      minHeight: 80, padding: 6,
                      borderBottom: '1px solid rgba(30,30,53,0.5)',
                      borderRight: '1px solid rgba(30,30,53,0.3)',
                      background: isToday ? 'rgba(138,92,246,0.05)' : 'transparent',
                    }}>
                      <div style={{
                        fontSize: 12, fontWeight: isToday ? 700 : 400,
                        color: isToday ? '#8a5cf6' : '#8888a8',
                        fontFamily: "'JetBrains Mono', monospace", marginBottom: 4,
                      }}>
                        {day}
                      </div>
                      {dayEvents.slice(0, 3).map((e, ei) => (
                        <div key={ei} title={e.detail || e.title} style={{
                          fontSize: 9, padding: '2px 4px', marginBottom: 2, borderRadius: 3,
                          background: `${LAYER_CONFIG[e.layer]?.color || '#8888a8'}20`,
                          color: LAYER_CONFIG[e.layer]?.color || '#8888a8',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {e.title}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <div style={{ fontSize: 9, color: '#555570' }}>+{dayEvents.length - 3} more</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          /* Agenda View */
          <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', overflow: 'hidden' }}>
            {agendaEvents.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center', color: '#555570', fontSize: 13 }}>
                No upcoming events for selected layers
              </div>
            ) : (
              agendaEvents.map((e, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                  borderBottom: '1px solid rgba(30,30,53,0.5)',
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: LAYER_CONFIG[e.layer]?.color || '#8888a8', flexShrink: 0,
                  }} />
                  <div style={{
                    color: '#8888a8', fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                    minWidth: 90, flexShrink: 0,
                  }}>
                    {new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#e8e8f0', fontSize: 13 }}>{e.title}</div>
                    {e.detail && <div style={{ color: '#555570', fontSize: 11 }}>{e.detail}</div>}
                  </div>
                  {e.impact && (
                    <span style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 4,
                      background: e.impact === 'High' ? 'rgba(248,113,113,0.1)' : 'rgba(240,198,116,0.1)',
                      color: e.impact === 'High' ? '#f87171' : '#f0c674',
                    }}>
                      {e.impact}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
