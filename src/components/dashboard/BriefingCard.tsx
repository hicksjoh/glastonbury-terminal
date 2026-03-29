'use client';
import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

export function BriefingCard() {
  const [briefing, setBriefing] = useState('');
  const [loading, setLoading] = useState(true);

  async function fetchBriefing() {
    setLoading(true);
    try {
      const res = await fetch('/api/briefing');
      const data = await res.json();
      setBriefing(data.briefing || 'Unable to generate briefing — check API configuration.');
    } catch {
      setBriefing('Briefing service unavailable. Configure ANTHROPIC_API_KEY in environment.');
    }
    setLoading(false);
  }

  useEffect(() => { fetchBriefing(); }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="terminal-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: '#c9a84c', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Keisha — AI Briefing</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#e8e8e8' }}>{greeting}, Wes</div>
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
        <p style={{ color: '#b0b0c0', fontSize: 14, lineHeight: 1.6, margin: 0 }}>{briefing}</p>
      )}
    </div>
  );
}
