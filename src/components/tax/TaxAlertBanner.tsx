'use client';

import React, { useState, useEffect, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
//  TaxAlertBanner — Proactive tax opportunity alerts
//  Color-coded by severity, dismissible, expandable
// ═══════════════════════════════════════════════════════════════════════════

interface TaxAlert {
  id: string;
  type: string;
  severity: 'urgent' | 'important' | 'info';
  title: string;
  message: string;
  potentialSavings?: number;
  deadline?: string;
  actionUrl?: string;
  dismissed: boolean;
}

interface TaxAlertBannerProps {
  maxAlerts?: number;
  compact?: boolean; // for dashboard embed
}

let keyframesInjected = false;
function ensureKeyframes() {
  if (keyframesInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes taxAlertSlide {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
  keyframesInjected = true;
}

const SEVERITY_CONFIG = {
  urgent: {
    bg: 'rgba(248, 113, 113, 0.06)',
    border: 'rgba(248, 113, 113, 0.25)',
    dot: '#f87171',
    label: 'URGENT',
    labelBg: 'rgba(248, 113, 113, 0.15)',
  },
  important: {
    bg: 'rgba(240, 198, 116, 0.06)',
    border: 'rgba(240, 198, 116, 0.25)',
    dot: '#f0c674',
    label: 'IMPORTANT',
    labelBg: 'rgba(240, 198, 116, 0.15)',
  },
  info: {
    bg: 'rgba(138, 92, 246, 0.04)',
    border: 'rgba(138, 92, 246, 0.15)',
    dot: '#8a5cf6',
    label: 'INFO',
    labelBg: 'rgba(138, 92, 246, 0.1)',
  },
};

function TaxAlertBannerInner({ maxAlerts = 5, compact = false }: TaxAlertBannerProps) {
  const [alerts, setAlerts] = useState<TaxAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => { ensureKeyframes(); }, []);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tax/alerts');
      const json = await res.json();
      if (json.success && json.alerts) {
        setAlerts(json.alerts);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const dismiss = useCallback((id: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const visibleAlerts = alerts
    .filter(a => !dismissed.has(a.id))
    .slice(0, maxAlerts);

  if (loading || visibleAlerts.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 6 : 8 }}>
      {visibleAlerts.map((alert, i) => {
        const cfg = SEVERITY_CONFIG[alert.severity];
        const isExpanded = expanded.has(alert.id);

        return (
          <div
            key={alert.id}
            style={{
              background: cfg.bg,
              border: `1px solid ${cfg.border}`,
              borderRadius: 8,
              padding: compact ? '8px 10px' : '10px 14px',
              animation: 'taxAlertSlide 0.3s ease',
              animationDelay: `${i * 0.05}s`,
              animationFillMode: 'both',
            }}
          >
            {/* Header Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                aria-label={`${alert.title}. ${isExpanded ? 'Click to collapse' : 'Click to expand'}`}
                onClick={() => toggleExpand(alert.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(alert.id); } }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }}
              >
                {/* Severity dot */}
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: cfg.dot, flexShrink: 0,
                }} />

                {/* Badge */}
                <span style={{
                  fontSize: 9, fontWeight: 700, color: cfg.dot,
                  background: cfg.labelBg,
                  padding: '1px 5px', borderRadius: 3,
                  letterSpacing: '0.05em',
                }}>
                  {cfg.label}
                </span>

                {/* Title */}
                <span style={{
                  fontSize: compact ? 11 : 12,
                  fontWeight: 600,
                  color: '#e8e8e8',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {alert.title}
                </span>

                {/* Savings badge */}
                {alert.potentialSavings && alert.potentialSavings > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: '#4ade80',
                    background: 'rgba(74,222,128,0.1)',
                    padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                  }}>
                    Save ${alert.potentialSavings.toLocaleString()}
                  </span>
                )}

                {/* Expand indicator */}
                <span style={{ fontSize: 10, color: '#555', flexShrink: 0 }}>
                  {isExpanded ? '▲' : '▼'}
                </span>
              </div>

              {/* Dismiss */}
              <button
                onClick={() => dismiss(alert.id)}
                aria-label={`Dismiss ${alert.title}`}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#555', fontSize: 14, padding: '0 0 0 8px',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            {/* Expanded Detail */}
            {isExpanded && (
              <div style={{ marginTop: 8, paddingLeft: 16 }}>
                <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.5, marginBottom: 6 }}>
                  {alert.message}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {alert.deadline && (
                    <span style={{ fontSize: 10, color: '#f87171' }}>
                      ⏰ Deadline: {alert.deadline}
                    </span>
                  )}
                  {alert.actionUrl && (
                    <a
                      href={alert.actionUrl}
                      style={{
                        fontSize: 10, color: '#8a5cf6', textDecoration: 'none',
                        fontWeight: 600,
                      }}
                    >
                      View Details →
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const TaxAlertBanner = React.memo(TaxAlertBannerInner);
export default TaxAlertBanner;
