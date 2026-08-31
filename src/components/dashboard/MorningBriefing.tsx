'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, X } from 'lucide-react';
import { Card, EditorialProse } from '@/components/ui';
import { DataAge } from '@/components/ui/DataAge';
import { color, size as sz, weight, tracking, space, radius, motion } from '@/lib/design-tokens';

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
  const [briefingMeta, setBriefingMeta] = useState<{ cached: boolean; createdAt: string | null }>({
    cached: false,
    createdAt: null,
  });
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
            setBriefingMeta({
              cached: data.cached === true,
              createdAt: typeof data.created_at === 'string' ? data.created_at : null,
            });
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
    <Card tone="default" size="lg" style={{ marginBottom: space[5], position: 'relative' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: space[3] }}>
        <div>
          <div style={{ fontSize: sz.subhead.fontSize, fontWeight: weight.bold, color: color.text }}>
            Good Morning, Wes
          </div>
          <div style={{ fontSize: sz.body.fontSize, color: color.textDim, marginTop: space[0.5] }}>
            {formatGreetingDate()}
          </div>
          {briefingMeta.createdAt && (
            <div style={{ display: 'flex', alignItems: 'center', gap: space[1], marginTop: space[1] }}>
              {briefingMeta.cached && (
                <span style={{ fontSize: sz.micro.fontSize, color: color.textDim }}>Cached</span>
              )}
              <DataAge ts={briefingMeta.createdAt} />
            </div>
          )}
        </div>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss briefing"
          style={{
            padding: space[1], borderRadius: radius.chip, border: 'none',
            background: color.glassMd, color: color.textMuted, cursor: 'pointer',
            display: 'flex', alignItems: 'center',
            transition: `color ${motion.duration.fast}ms ${motion.easing.default}`,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = color.text; }}
          onMouseLeave={e => { e.currentTarget.style.color = color.textMuted; }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Briefing content (truncated preview) */}
      <div style={{
        fontSize: sz.bodyLg.fontSize, color: color.textMuted, lineHeight: `${sz.bodyLg.lineHeight}px`,
        marginBottom: space[3], maxHeight: 120, overflow: 'hidden',
        maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
      }}>
        {briefing.slice(0, 400)}
      </div>

      {/* Keisha's Take callout */}
      {keishaTake && (
        <div style={{
          padding: `${space[2]}px ${space[3]}px`, borderRadius: radius.button, marginBottom: space[3],
          background: color.goldSubtle,
          border: `1px solid ${color.gold}30`,
        }}>
          <div style={{
            fontSize: sz.micro.fontSize, color: color.gold, fontWeight: weight.bold,
            marginBottom: space[0.5], textTransform: 'uppercase', letterSpacing: tracking.eyebrow,
          }}>
            Keisha&apos;s Take
          </div>
          <EditorialProse>{keishaTake}</EditorialProse>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: space[2] }}>
        <button
          onClick={() => router.push('/keisha')}
          aria-label="Ask Keisha more about the briefing"
          style={{
            padding: `${space[2]}px ${space[4]}px`, borderRadius: radius.button,
            border: `1px solid ${color.gold}30`,
            background: color.goldSubtle, color: color.gold,
            fontSize: sz.body.fontSize, fontWeight: weight.semibold, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: space[1],
            transition: `background ${motion.duration.fast}ms ${motion.easing.default}`,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = color.goldEmphasis; }}
          onMouseLeave={e => { e.currentTarget.style.background = color.goldSubtle; }}
        >
          <MessageSquare size={12} /> Ask Keisha More
        </button>
      </div>
    </Card>
  );
}

export const MorningBriefing = React.memo(MorningBriefingInner);
export default MorningBriefing;
