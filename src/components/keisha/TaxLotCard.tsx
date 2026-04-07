'use client';

import React, { useState, useEffect } from 'react';
import { TAX_DISCLAIMER } from '@/lib/tax-engine';
import type { TaxLotMethod } from '@/lib/tax-engine';
import type { LotComparisonResult, LotSelectionResult } from '@/lib/tax-lot-optimizer';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TaxLotCardData {
  ticker: string;
  quantityToSell: number;
  comparison: LotComparisonResult;
  onSelectMethod?: (method: TaxLotMethod) => void;
}

// ─── Keyframe Injection ─────────────────────────────────────────────────────

const KF_ID = 'tax-lot-card-kf';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KF_ID)) return;
  const style = document.createElement('style');
  style.id = KF_ID;
  style.textContent = `
    @keyframes taxLotIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Method Labels ──────────────────────────────────────────────────────────

const METHOD_LABELS: Record<TaxLotMethod, { short: string; full: string; description: string }> = {
  fifo: { short: 'FIFO', full: 'First In, First Out', description: 'Sells your oldest shares first. Default method used by most brokers.' },
  lifo: { short: 'LIFO', full: 'Last In, First Out', description: 'Sells your newest shares first. Can maximize short-term losses.' },
  hifo: { short: 'HIFO', full: 'Highest In, First Out', description: 'Sells highest cost basis first. Minimizes taxable gains — usually the best tax strategy.' },
  specific: { short: 'Specific', full: 'Specific Lot Selection', description: 'You choose exactly which lots to sell. Maximum control over tax impact.' },
};

// ─── Format Helpers ─────────────────────────────────────────────────────────

function formatDollars(n: number, showSign = false): string {
  const abs = Math.abs(n);
  const formatted = abs >= 1000 ? abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : abs.toFixed(2);
  if (showSign) {
    return n >= 0 ? `+$${formatted}` : `-$${formatted}`;
  }
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
}

// ─── Method Row ─────────────────────────────────────────────────────────────

function MethodRow({ method, result, isBest, isWorst, bestTax, onSelect }: {
  method: TaxLotMethod;
  result: LotSelectionResult;
  isBest: boolean;
  isWorst: boolean;
  bestTax: number;
  onSelect?: (method: TaxLotMethod) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const labels = METHOD_LABELS[method];
  const savings = Math.round((result.totalTaxEstimate - bestTax) * 100) / 100;
  const gainColor = result.totalGainLoss >= 0 ? '#4ade80' : '#f87171';
  const taxColor = result.totalTaxEstimate >= 0 ? '#f87171' : '#4ade80';

  return (
    <tr
      style={{
        borderBottom: '1px solid #1a1a3a',
        background: isBest ? 'rgba(240,198,116,0.06)' : hovered ? 'rgba(255,255,255,0.02)' : 'transparent',
        transition: 'background 150ms ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Method */}
      <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: isBest ? 700 : 500 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isBest && <span style={{ color: '#f0c674', fontSize: 11 }}>★</span>}
          <span style={{ color: isBest ? '#f0c674' : '#e8e8e8' }}>{labels.short}</span>
        </div>
        <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{labels.full}</div>
      </td>

      {/* Gain/Loss */}
      <td style={{
        padding: '8px 10px', fontSize: 13, fontWeight: 600, color: gainColor,
        fontFamily: "'JetBrains Mono', monospace", textAlign: 'right',
      }}>
        {formatDollars(result.totalGainLoss, true)}
        <div style={{ fontSize: 10, color: '#666', fontWeight: 400 }}>
          {result.shortTermGains !== 0 && <span>ST: {formatDollars(result.shortTermGains, true)} </span>}
          {result.longTermGains !== 0 && <span>LT: {formatDollars(result.longTermGains, true)}</span>}
        </div>
      </td>

      {/* Tax Est */}
      <td style={{
        padding: '8px 10px', fontSize: 13, fontWeight: 600, color: taxColor,
        fontFamily: "'JetBrains Mono', monospace", textAlign: 'right',
      }}>
        {formatDollars(result.totalTaxEstimate)}
      </td>

      {/* Savings */}
      <td style={{
        padding: '8px 10px', fontSize: 13, fontWeight: 600, textAlign: 'right',
        fontFamily: "'JetBrains Mono', monospace",
        color: savings === 0 ? '#4ade80' : '#f87171',
      }}>
        {savings === 0 ? (
          <span style={{ color: '#4ade80' }}>Best</span>
        ) : (
          <span>+{formatDollars(savings)}</span>
        )}
      </td>

      {/* Action */}
      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
        {onSelect && (
          <button
            onClick={() => onSelect(method)}
            aria-label={`Use ${labels.short} method`}
            style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: isBest ? '1px solid #f0c674' : '1px solid #2a2a3a',
              background: isBest ? 'rgba(240,198,116,0.12)' : 'rgba(255,255,255,0.03)',
              color: isBest ? '#f0c674' : '#8888a8',
              transition: 'all 150ms ease',
              ...(hovered && !isBest ? { borderColor: '#8a5cf6', color: '#c4a6ff' } : {}),
            }}
          >
            Use
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Lot Detail Row ─────────────────────────────────────────────────────────

function LotDetailRow({ lot, quantityToSell, gainLoss, gainType, daysHeld }: {
  lot: { id: string; costBasis: number; currentPrice: number; buyDate: Date };
  quantityToSell: number;
  gainLoss: number;
  gainType: string;
  daysHeld: number;
}) {
  const gainColor = gainLoss >= 0 ? '#4ade80' : '#f87171';
  const buyDateStr = new Date(lot.buyDate).toISOString().split('T')[0];

  return (
    <tr style={{ borderBottom: '1px solid rgba(26,26,58,0.5)' }}>
      <td style={{ padding: '4px 8px', fontSize: 11, color: '#8888a8', fontFamily: "'JetBrains Mono', monospace" }}>
        {lot.id}
      </td>
      <td style={{ padding: '4px 8px', fontSize: 11, color: '#b0b0c0' }}>{buyDateStr}</td>
      <td style={{ padding: '4px 8px', fontSize: 11, color: '#e8e8e8', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
        {quantityToSell}
      </td>
      <td style={{ padding: '4px 8px', fontSize: 11, color: '#b0b0c0', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
        ${lot.costBasis.toFixed(2)}
      </td>
      <td style={{ padding: '4px 8px', fontSize: 11, color: gainColor, textAlign: 'right', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
        {formatDollars(gainLoss, true)}
      </td>
      <td style={{ padding: '4px 8px', fontSize: 11, textAlign: 'center' }}>
        <span style={{
          padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
          background: gainType === 'long_term' ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
          color: gainType === 'long_term' ? '#4ade80' : '#f87171',
        }}>
          {gainType === 'long_term' ? 'LT' : 'ST'}
        </span>
      </td>
      <td style={{ padding: '4px 8px', fontSize: 11, color: '#666', textAlign: 'right' }}>{daysHeld}d</td>
    </tr>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

function TaxLotCardInner({ data }: { data: TaxLotCardData }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<TaxLotMethod | null>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => { ensureKeyframes(); }, []);

  const { comparison, ticker, quantityToSell, onSelectMethod } = data;
  const bestResult = comparison.methods[comparison.bestMethod];
  const detailResult = selectedDetail ? comparison.methods[selectedDetail] : null;

  return (
    <div
      style={{
        borderRadius: 12,
        padding: 16,
        marginTop: 12,
        marginBottom: 4,
        maxWidth: '100%',
        background: 'rgba(138,92,246,0.06)',
        border: '1px solid rgba(138,92,246,0.2)',
        borderLeftWidth: 4,
        borderLeftColor: '#8a5cf6',
        animation: 'taxLotIn 200ms ease forwards',
        transition: 'transform 150ms ease, box-shadow 150ms ease',
        ...(hovered ? { transform: 'translateY(-1px)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' } : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>📊</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#8a5cf6' }}>Tax Lot Optimizer</div>
            <div style={{ fontSize: 12, color: '#8888a8' }}>
              Selling {quantityToSell} shares of {ticker}
            </div>
          </div>
        </div>
        {comparison.maxSavings > 0 && (
          <div style={{
            padding: '4px 10px', borderRadius: 8,
            background: 'rgba(240,198,116,0.1)', border: '1px solid rgba(240,198,116,0.3)',
          }}>
            <div style={{ fontSize: 10, color: '#8888a8', fontWeight: 600 }}>POTENTIAL SAVINGS</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f0c674', fontFamily: "'JetBrains Mono', monospace" }}>
              ${comparison.maxSavings.toLocaleString()}
            </div>
          </div>
        )}
      </div>

      {/* Comparison Table */}
      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #1a1a3a' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a3a' }}>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: '#8888a8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Method</th>
              <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 10, fontWeight: 600, color: '#8888a8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Gain/Loss</th>
              <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 10, fontWeight: 600, color: '#8888a8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tax Est</th>
              <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 10, fontWeight: 600, color: '#8888a8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>vs Best</th>
              <th style={{ padding: '6px 10px', textAlign: 'center', fontSize: 10, fontWeight: 600, color: '#8888a8', textTransform: 'uppercase', letterSpacing: '0.5px' }}></th>
            </tr>
          </thead>
          <tbody>
            {(['fifo', 'lifo', 'hifo', 'specific'] as TaxLotMethod[]).map(method => (
              <MethodRow
                key={method}
                method={method}
                result={comparison.methods[method]}
                isBest={method === comparison.bestMethod}
                isWorst={method === comparison.worstMethod}
                bestTax={bestResult.totalTaxEstimate}
                onSelect={onSelectMethod}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Explanation */}
      <div style={{ fontSize: 12, color: '#b0b0c0', lineHeight: 1.6, marginTop: 10 }}>
        {comparison.explanation}
      </div>

      {/* Detail Toggle */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? 'Hide lot details' : 'Show lot details'}
          style={{
            padding: '4px 12px', borderRadius: 6,
            border: '1px solid #2a2a3a', background: 'rgba(255,255,255,0.03)',
            color: '#8888a8', fontSize: 11, cursor: 'pointer',
            transition: 'color 150ms ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#c4a6ff'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#8888a8'; }}
        >
          {expanded ? 'Hide Details' : 'Why?'}
        </button>

        {/* Per-method lot detail buttons */}
        {expanded && (['fifo', 'lifo', 'hifo'] as TaxLotMethod[]).map(m => (
          <button
            key={m}
            onClick={() => setSelectedDetail(selectedDetail === m ? null : m)}
            aria-label={`View ${m.toUpperCase()} lot details`}
            style={{
              padding: '4px 10px', borderRadius: 6,
              border: selectedDetail === m ? '1px solid #8a5cf6' : '1px solid #1a1a3a',
              background: selectedDetail === m ? 'rgba(138,92,246,0.1)' : 'rgba(255,255,255,0.02)',
              color: selectedDetail === m ? '#c4a6ff' : '#666',
              fontSize: 11, cursor: 'pointer', fontWeight: 600,
              transition: 'all 150ms ease',
            }}
          >
            {m.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Expanded: Method Explanations */}
      {expanded && !detailResult && (
        <div style={{
          marginTop: 10, padding: '10px 12px', borderRadius: 8,
          background: 'rgba(0,0,0,0.2)', fontSize: 12, color: '#999', lineHeight: 1.6,
        }}>
          {(['fifo', 'lifo', 'hifo', 'specific'] as TaxLotMethod[]).map(m => (
            <p key={m} style={{ margin: '0 0 6px' }}>
              <strong style={{ color: m === comparison.bestMethod ? '#f0c674' : '#e8e8e8' }}>
                {METHOD_LABELS[m].short}:
              </strong>{' '}
              {METHOD_LABELS[m].description}
            </p>
          ))}
          <p style={{ margin: '8px 0 0', color: '#666', fontStyle: 'italic' }}>
            HIFO typically minimizes taxes when you have gains. For tax-loss harvesting, LIFO may be better if recent purchases are at a higher cost.
          </p>
        </div>
      )}

      {/* Expanded: Specific Lot Breakdown */}
      {expanded && detailResult && (
        <div style={{
          marginTop: 10, borderRadius: 8, border: '1px solid #1a1a3a',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '6px 10px', background: 'rgba(0,0,0,0.2)', fontSize: 11, fontWeight: 600, color: '#8888a8' }}>
            {METHOD_LABELS[detailResult.method].short} — Lot Breakdown
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1a1a3a' }}>
                <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: 9, color: '#666', fontWeight: 600, textTransform: 'uppercase' }}>Lot</th>
                <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: 9, color: '#666', fontWeight: 600, textTransform: 'uppercase' }}>Bought</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', fontSize: 9, color: '#666', fontWeight: 600, textTransform: 'uppercase' }}>Qty</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', fontSize: 9, color: '#666', fontWeight: 600, textTransform: 'uppercase' }}>Basis</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', fontSize: 9, color: '#666', fontWeight: 600, textTransform: 'uppercase' }}>P&L</th>
                <th style={{ padding: '4px 8px', textAlign: 'center', fontSize: 9, color: '#666', fontWeight: 600, textTransform: 'uppercase' }}>Type</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', fontSize: 9, color: '#666', fontWeight: 600, textTransform: 'uppercase' }}>Held</th>
              </tr>
            </thead>
            <tbody>
              {detailResult.selectedLots.map((sel, i) => (
                <LotDetailRow
                  key={`${sel.lot.id}-${i}`}
                  lot={sel.lot}
                  quantityToSell={sel.quantityToSell}
                  gainLoss={sel.gainLoss}
                  gainType={sel.gainType}
                  daysHeld={sel.daysHeld}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Disclaimer */}
      <div style={{ fontSize: 10, color: '#555', marginTop: 10, lineHeight: 1.4, fontStyle: 'italic' }}>
        {TAX_DISCLAIMER}
      </div>
    </div>
  );
}

export default React.memo(TaxLotCardInner);
