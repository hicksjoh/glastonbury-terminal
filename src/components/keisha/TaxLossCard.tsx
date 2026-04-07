'use client';

import React, { useState, useEffect } from 'react';
import { TAX_DISCLAIMER } from '@/lib/tax-engine';
import type { HarvestCandidate, HarvestSummary } from '@/lib/tax-loss-harvester';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TaxLossCardData {
  summary: HarvestSummary;
  onHarvest?: (ticker: string) => void;
}

// ─── Keyframe Injection ─────────────────────────────────────────────────────

const KF_ID = 'tax-loss-card-kf';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KF_ID)) return;
  const style = document.createElement('style');
  style.id = KF_ID;
  style.textContent = `
    @keyframes taxLossIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Format Helpers ─────────────────────────────────────────────────────────

function fmtDollars(n: number, showSign = false): string {
  const abs = Math.abs(n);
  const str = abs >= 1000
    ? abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : abs.toFixed(2);
  if (showSign) return n >= 0 ? `+$${str}` : `-$${str}`;
  return n < 0 ? `-$${str}` : `$${str}`;
}

// ─── Replacement Pill ───────────────────────────────────────────────────────

function ReplacementPill({ ticker, name, correlation, reason }: {
  ticker: string; name: string; correlation: number; reason: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <span
      title={`${name} — ${reason} (corr: ${(correlation * 100).toFixed(0)}%)`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: 'default',
        border: '1px solid #2a2a3a',
        background: hovered ? 'rgba(138,92,246,0.1)' : 'rgba(255,255,255,0.02)',
        color: hovered ? '#c4a6ff' : '#8888a8',
        transition: 'all 150ms ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{ticker}</span>
      <span style={{ fontSize: 9, color: '#555' }}>{(correlation * 100).toFixed(0)}%</span>
    </span>
  );
}

// ─── Candidate Row ──────────────────────────────────────────────────────────

function CandidateRow({ candidate, onHarvest }: {
  candidate: HarvestCandidate;
  onHarvest?: (ticker: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        padding: '10px 12px', borderRadius: 8,
        border: '1px solid #1a1a3a',
        background: hovered ? 'rgba(255,255,255,0.02)' : 'transparent',
        marginBottom: 8,
        transition: 'background 150ms ease',
        opacity: candidate.washSaleRisk ? 0.6 : 1,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          {/* Ticker */}
          <div>
            <div style={{
              fontSize: 14, fontWeight: 700, color: '#e8e8e8',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {candidate.ticker}
            </div>
            <div style={{ fontSize: 10, color: '#666' }}>
              {candidate.quantity} shares · {candidate.holdingPeriod === 'long_term' ? 'LT' : 'ST'} · {candidate.daysHeld}d
            </div>
          </div>

          {/* Loss */}
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: '#f87171',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {fmtDollars(candidate.unrealizedLoss, true)}
            </div>
            <div style={{ fontSize: 10, color: '#f87171' }}>
              {candidate.unrealizedLossPct.toFixed(1)}%
            </div>
          </div>

          {/* Tax Savings */}
          <div style={{
            padding: '4px 8px', borderRadius: 6,
            background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 10, color: '#4ade80', fontWeight: 600 }}>SAVINGS</div>
            <div style={{
              fontSize: 13, fontWeight: 700, color: '#4ade80',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {fmtDollars(candidate.taxSavings)}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {candidate.washSaleRisk && (
            <span title={candidate.washSaleNote} style={{
              padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
              background: 'rgba(248,113,113,0.1)', color: '#f87171',
              border: '1px solid rgba(248,113,113,0.2)',
            }}>
              WASH RISK
            </span>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? 'Collapse details' : 'Expand details'}
            style={{
              padding: '3px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
              border: '1px solid #2a2a3a', background: 'transparent', color: '#8888a8',
              transition: 'color 150ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#c4a6ff'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#8888a8'; }}
          >
            {expanded ? '▲' : '▼'}
          </button>
          {onHarvest && !candidate.washSaleRisk && (
            <button
              onClick={() => onHarvest(candidate.ticker)}
              aria-label={`Harvest ${candidate.ticker}`}
              style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                border: '1px solid rgba(74,222,128,0.3)',
                background: 'rgba(74,222,128,0.08)', color: '#4ade80',
                transition: 'all 150ms ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(74,222,128,0.15)';
                e.currentTarget.style.borderColor = '#4ade80';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(74,222,128,0.08)';
                e.currentTarget.style.borderColor = 'rgba(74,222,128,0.3)';
              }}
            >
              Harvest
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #1a1a3a' }}>
          {/* Wash sale note */}
          {candidate.washSaleNote && (
            <div style={{
              fontSize: 11, color: candidate.washSaleRisk ? '#f87171' : '#666',
              marginBottom: 6, fontStyle: 'italic',
            }}>
              {candidate.washSaleNote}
            </div>
          )}

          {/* Price info */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
            <div>
              <span style={{ fontSize: 10, color: '#666' }}>Cost Basis: </span>
              <span style={{ fontSize: 12, color: '#b0b0c0', fontFamily: "'JetBrains Mono', monospace" }}>
                ${candidate.costBasis.toFixed(2)}
              </span>
            </div>
            <div>
              <span style={{ fontSize: 10, color: '#666' }}>Current: </span>
              <span style={{ fontSize: 12, color: '#b0b0c0', fontFamily: "'JetBrains Mono', monospace" }}>
                ${candidate.currentPrice.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Replacements */}
          <div>
            <div style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, marginBottom: 4 }}>
              REPLACEMENT IDEAS
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {candidate.replacements.map(r => (
                <ReplacementPill key={r.ticker} {...r} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

function TaxLossCardInner({ data }: { data: TaxLossCardData }) {
  const [hovered, setHovered] = useState(false);

  useEffect(() => { ensureKeyframes(); }, []);

  const { summary, onHarvest } = data;
  const hasActionable = summary.candidates.filter(c => !c.washSaleRisk).length > 0;

  return (
    <div
      style={{
        borderRadius: 12,
        padding: 16,
        marginTop: 12,
        marginBottom: 4,
        maxWidth: '100%',
        background: hasActionable ? 'rgba(74,222,128,0.04)' : 'rgba(136,136,168,0.04)',
        border: `1px solid ${hasActionable ? 'rgba(74,222,128,0.2)' : 'rgba(136,136,168,0.15)'}`,
        borderLeftWidth: 4,
        borderLeftColor: hasActionable ? '#4ade80' : '#8888a8',
        animation: 'taxLossIn 200ms ease forwards',
        transition: 'transform 150ms ease, box-shadow 150ms ease',
        ...(hovered ? { transform: 'translateY(-1px)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' } : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🌾</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: hasActionable ? '#4ade80' : '#8888a8' }}>
              Tax-Loss Harvest {summary.candidates.length > 0 ? 'Opportunities' : 'Scan'}
            </div>
            <div style={{ fontSize: 12, color: '#8888a8' }}>
              {summary.candidates.length} position{summary.candidates.length !== 1 ? 's' : ''} with harvestable losses
            </div>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{
          padding: '6px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.2)', minWidth: 90,
        }}>
          <div style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, textTransform: 'uppercase' }}>Unrealized Losses</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>
            {fmtDollars(summary.totalUnrealizedLosses)}
          </div>
        </div>
        <div style={{
          padding: '6px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.2)', minWidth: 90,
        }}>
          <div style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, textTransform: 'uppercase' }}>Tax Savings</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>
            {fmtDollars(summary.totalPotentialSavings)}
          </div>
        </div>
        <div style={{
          padding: '6px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.2)', minWidth: 90,
        }}>
          <div style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, textTransform: 'uppercase' }}>YTD Gains</div>
          <div style={{
            fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
            color: summary.ytdRealizedGains >= 0 ? '#4ade80' : '#f87171',
          }}>
            {fmtDollars(summary.ytdRealizedGains, true)}
          </div>
        </div>
      </div>

      {/* Net Position */}
      <div style={{
        fontSize: 12, color: '#b0b0c0', lineHeight: 1.6, marginBottom: 12,
        padding: '8px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.15)',
        borderLeft: '2px solid #8a5cf6',
      }}>
        {summary.netTaxPosition}
      </div>

      {/* Candidates */}
      {summary.candidates.length > 0 ? (
        <div>
          {summary.candidates.map(c => (
            <CandidateRow key={c.ticker} candidate={c} onHarvest={onHarvest} />
          ))}
        </div>
      ) : (
        <div style={{
          padding: 20, textAlign: 'center', color: '#666', fontSize: 13,
          border: '1px dashed #2a2a3a', borderRadius: 8,
        }}>
          No harvest candidates found. All positions are at a gain or below the minimum loss threshold.
        </div>
      )}

      {/* Recommendation */}
      {summary.candidates.length > 0 && (
        <div style={{
          fontSize: 12, color: '#b0b0c0', lineHeight: 1.6, marginTop: 10,
          padding: '8px 10px', borderRadius: 6, background: 'rgba(240,198,116,0.04)',
          border: '1px solid rgba(240,198,116,0.15)',
        }}>
          <strong style={{ color: '#f0c674' }}>Recommendation:</strong> {summary.recommendation}
        </div>
      )}

      {/* Disclaimer */}
      <div style={{ fontSize: 10, color: '#555', marginTop: 10, lineHeight: 1.4, fontStyle: 'italic' }}>
        {TAX_DISCLAIMER}
      </div>
    </div>
  );
}

export default React.memo(TaxLossCardInner);
