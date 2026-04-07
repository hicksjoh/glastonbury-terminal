'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, X } from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────

function isBeforeFourPM(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getHours() < 16;
}

function getDismissKey(): string {
  const d = new Date();
  return `briefing-dismissed-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function formatGreetingDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

function MorningBriefingInner() {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(true); // default hidden until checked
  const [briefing, setBriefing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check dismissal + time
    const wasDismissed = typeof window !== 'undefined' && localStorage.getItem(getDismissKey()) === 'true';
    if (wasDismissed || !isBeforeFourPM()) {
      setDismissed(true);
      setLoading(false);
      return;
    }
    setDismissed(false);

    // Fetch briefing
    (async () => {
      try {
        const res = await fetch('/api/briefing/today', { signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          const data = await res.json();
          if (data.briefing) {
            setBriefing(data.briefing);
          }
        }
      } catch { /* silent */ }
      setLoading(false);
    })();
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(getDismissKey(), 'true');
    }
  }, []);

  if (dismissed || loading || !briefing) return null;

  // Try to extract "Keisha's Take" from the briefing if formatted
  const keishaTakeMatch = briefing.match(/Keisha['s]*\s*Take[:\-\s]+([^\n]+)/i);
  const keishaTake = keishaTakeMatch ? keishaTakeMatch[1].trim() : null;

  return (
    <div style={{
      padding: 20,
      background: '#12122a',
      border: '1px solid #1a1a3a',
      borderRadius: 16,
      marginBottom: 20,
      position: 'relative',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e8e8e8' }}>
            Good Morning, Wes
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
            {formatGreetingDate()}
          </div>
        </div>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss briefing"
          style={{
            padding: 4, borderRadius: 4, border: 'none',
            background: 'rgba(255,255,255,0.05)', cursor: 'pointer',
            display: 'flex', alignItems: 'center',
          }}
        >
          <X size={14} color="#666" />
        </button>
      </div>

      {/* Briefing content (truncated preview) */}
      <div style={{
        fontSize: 13, color: '#bbb', lineHeight: 1.6, marginBottom: 12,
        maxHeight: 120, overflow: 'hidden',
        maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
      }}>
        {briefing.slice(0, 400)}
      </div>

      {/* Keisha's Take callout */}
      {keishaTake && (
        <div style={{
          padding: '10px 12px', borderRadius: 8, marginBottom: 12,
          borderLeft: '3px solid #f0c674',
          background: 'rgba(240,198,116,0.06)',
        }}>
          <div style={{ fontSize: 10, color: '#f0c674', fontWeight: 700, marginBottom: 3, textTransform: 'uppercase' }}>
            Keisha&apos;s Take
          </div>
          <div style={{ fontSize: 13, color: '#d0d0e0', lineHeight: 1.5 }}>
            {keishaTake}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => router.push('/keisha')}
          aria-label="Ask Keisha more about the briefing"
          style={{
            padding: '6px 14px', borderRadius: 8, border: '1px solid #8a5cf6',
            background: 'rgba(138,92,246,0.08)', color: '#8a5cf6',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
            transition: 'background 150ms ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(138,92,246,0.15)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(138,92,246,0.08)'; }}
        >
          <MessageSquare size={12} /> Ask Keisha More
        </button>
      </div>
    </div>
  );
}

export const MorningBriefing = React.memo(MorningBriefingInner);
export default MorningBriefing;
