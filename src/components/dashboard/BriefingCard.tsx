'use client';
import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import MarkdownRenderer from '@/components/MarkdownRenderer';

export function BriefingCard() {
  const [briefing, setBriefing] = useState('');
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [, setTick] = useState(0);

  async function fetchBriefing() {
    setLoading(true);
    try {
      // Check for today's pre-generated briefing first
      const cachedRes = await fetch('/api/briefing/today').then(r => r.ok ? r.json() : null).catch(() => null);
      if (cachedRes?.briefing) {
        setBriefing(cachedRes.briefing);
        setFetchedAt(new Date());
        setLoading(false);
        return;
      }
      // No cached briefing — generate fresh
      const res = await fetch('/api/briefing');
      const data = await res.json();
      setBriefing(data.briefing || 'Unable to generate briefing — check API configuration.');
      setFetchedAt(new Date());
    } catch {
      setBriefing('Briefing service unavailable. Configure ANTHROPIC_API_KEY in environment.');
      setFetchedAt(new Date());
    }
    setLoading(false);
  }

  useEffect(() => { fetchBriefing(); }, []);

  // Update relative timestamp every 30s
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const briefTitle = isWeekend ? 'Weekend Brief' : `${now.toLocaleDateString('en-US', { weekday: 'long' })} Brief`;

  function briefingTimeAgo(): string {
    if (!fetchedAt) return 'Loading...';
    const diffMs = Date.now() - fetchedAt.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  }

  return (
    <div className="terminal-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: '#c9a84c', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Keisha — {briefTitle}</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#e8e8e8' }}>{greeting}, Wes</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{dateStr}</div>
          <div style={{ fontSize: 10, color: '#666', marginTop: 1 }}>{briefingTimeAgo()}</div>
        </div>
        <button
          onClick={fetchBriefing}
          style={{ background: 'none', border: 'none', color: '#6b6b80', cursor: 'pointer', padding: 4 }}
        >
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>
      {loading ? (
        <div style={{ display: 'flex', gap: 4 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#c9a84c', opacity: 0.6 }} />
          ))}
        </div>
      ) : (
        <MarkdownRenderer content={briefing} compact={true} />
      )}
    </div>
  );
}
