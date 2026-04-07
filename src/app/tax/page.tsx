'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LoadingState } from '@/components/LoadingState';
import {
  Receipt, AlertTriangle, TrendingDown, TrendingUp, Shield, Calculator, Download,
  Clock, ChevronDown, RefreshCw, BarChart3,
} from 'lucide-react';
import { exportToCSV } from '@/lib/export';
import {
  type FilingStatus,
  TAX_2025,
  TAX_DISCLAIMER,
  ACTIVE_TAX_YEAR,
  calculateIncomeTax,
  calculateCapitalGainsTax,
  calculateNIIT,
  classifyHoldingPeriod,
  calculateSection1256Tax,
  estimateQuarterlyPayment,
  getTaxBracketInfo,
} from '@/lib/tax-engine';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer,
  Cell, ReferenceLine,
} from 'recharts';
import type { HarvestSummary } from '@/lib/tax-loss-harvester';
import TaxAlertBanner from '@/components/tax/TaxAlertBanner';
import {
  calculateSection179,
  calculateMileageDeduction,
  calculateHomeOfficeDeduction,
  calculateSEPContribution,
} from '@/lib/tax-engine';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TaxEvent {
  id: string;
  event_type: string;
  tax_character: string;
  amount: number;
  ticker: string;
  description: string;
  date: string;
  wash_sale_flag: boolean;
}

interface TaxData {
  ytd_short_term_gains: number;
  ytd_long_term_gains: number;
  ytd_harvested_losses: number;
  ytd_dividend_income: number;
  ytd_royalty_income: number;
  ytd_rsu_vests: number;
  qbi_deduction: number;
  estimated_quarterly_liability: number;
  estimated_annual_liability: number;
  federal_rate: number;
  state_rate: number;
  niit_rate: number;
  wash_sales: { ticker: string; date: string; wash_sale_expires: string; amount: number }[];
  events: TaxEvent[];
}

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  market_value: string;
  cost_basis: string;
  side: string;
}

interface PortfolioPosition {
  symbol: string;
  qty: number;
  avgEntry: number;
  currentPrice: number;
  unrealizedPL: number;
  unrealizedPLPct: number;
  daysHeld: number;
  holdingType: 'short_term' | 'long_term';
  daysUntilLongTerm: number;
}

type GainsFilter = 'all' | 'short_term' | 'long_term' | 'losses';
type SortCol = 'date' | 'ticker' | 'type' | 'gain_loss' | 'tax_impact';
type SortDir = 'asc' | 'desc';

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtCurrency(n: number, showSign = false): string {
  const abs = Math.abs(n);
  let str: string;
  if (abs >= 1e6) str = `$${(abs / 1e6).toFixed(2)}M`;
  else if (abs >= 1e3) str = `$${(abs / 1e3).toFixed(1)}K`;
  else str = `$${abs.toFixed(0)}`;
  if (showSign) return n >= 0 ? `+${str}` : `-${str}`;
  return n < 0 ? `-${str}` : str;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: 'Single',
  mfj: 'Married Filing Jointly',
  mfs: 'Married Filing Separately',
  hoh: 'Head of Household',
};

// ─── Section Card ───────────────────────────────────────────────────────────

// Lucide icon component type
type LucideIcon = React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number | string; color?: string }>;

function SectionCard({ title, icon: Icon, children, style }: {
  title: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35',
      overflow: 'hidden', ...style,
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #1e1e35',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {Icon && <Icon size={14} color="#8a5cf6" />}
        <span style={{
          color: '#8a5cf6', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em',
          fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
        }}>
          {title}
        </span>
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────────────────

function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          height: 16, borderRadius: 4, background: 'rgba(255,255,255,0.03)',
          marginBottom: 8, width: `${70 + Math.random() * 30}%`,
          animation: 'pulse 1.5s ease infinite',
        }} />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function TaxPage() {
  // ── State ──
  const [data, setData] = useState<TaxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filingStatus, setFilingStatus] = useState<FilingStatus>('single');
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [posLoading, setPosLoading] = useState(true);
  const [harvestData, setHarvestData] = useState<HarvestSummary | null>(null);
  const [harvestLoading, setHarvestLoading] = useState(true);
  const [gainsFilter, setGainsFilter] = useState<GainsFilter>('all');
  const [sortCol, setSortCol] = useState<SortCol>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // ── Estimated Tax Calculator state ──
  const [estIncome, setEstIncome] = useState(100000);
  const [estWithholding, setEstWithholding] = useState(0);

  // ── Business Deductions state ──
  const [bizMiles, setBizMiles] = useState(0);
  const [bizSqFt, setBizSqFt] = useState(0);
  const [bizEquipment, setBizEquipment] = useState(0);
  const [bizNetSE, setBizNetSE] = useState(0);
  const [exportingCPA, setExportingCPA] = useState(false);

  const currentYear = new Date().getFullYear();

  // ── Data Fetching ──
  useEffect(() => {
    fetch('/api/tax')
      .then(r => r.json())
      .then(d => { if (d.success) setData(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/tax/harvest?filing_status=' + filingStatus)
      .then(r => r.json())
      .then(d => { if (d.success) setHarvestData(d.data); })
      .catch(() => {})
      .finally(() => setHarvestLoading(false));
  }, [filingStatus]);

  useEffect(() => {
    fetch('/api/alpaca/positions')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d)) {
          setPositions(d.map((p: AlpacaPosition) => {
            const hp = classifyHoldingPeriod(
              new Date(Date.now() - 180 * 86400000), // estimate if no buy date
              new Date(),
            );
            return {
              symbol: p.symbol,
              qty: parseFloat(p.qty),
              avgEntry: parseFloat(p.avg_entry_price),
              currentPrice: parseFloat(p.current_price),
              unrealizedPL: parseFloat(p.unrealized_pl),
              unrealizedPLPct: parseFloat(p.unrealized_plpc) * 100,
              daysHeld: hp.daysHeld,
              holdingType: hp.type,
              daysUntilLongTerm: hp.daysUntilLongTerm,
            };
          }));
        }
      })
      .catch(() => {})
      .finally(() => setPosLoading(false));
  }, []);

  const refreshHarvest = useCallback(() => {
    setHarvestLoading(true);
    fetch('/api/tax/harvest?filing_status=' + filingStatus + '&_t=' + Date.now())
      .then(r => r.json())
      .then(d => { if (d.success) setHarvestData(d.data); })
      .catch(() => {})
      .finally(() => setHarvestLoading(false));
  }, [filingStatus]);

  // ── Computed Values ──
  const ytdSTGains = data?.ytd_short_term_gains || 0;
  const ytdLTGains = data?.ytd_long_term_gains || 0;
  const ytdLosses = data?.ytd_harvested_losses || 0;

  const taxCalc = useMemo(() => {
    const taxableOrdinary = Math.max(0, estIncome + ytdSTGains - ytdLosses);
    const incomeTax = calculateIncomeTax(taxableOrdinary, filingStatus);
    const capGainsTax = calculateCapitalGainsTax(ytdLTGains, taxableOrdinary, filingStatus);
    const niit = calculateNIIT(taxableOrdinary + ytdLTGains, ytdSTGains + ytdLTGains, filingStatus);
    const totalTax = incomeTax.totalTax + capGainsTax.tax + niit.niit;
    const effectiveRate = (taxableOrdinary + ytdLTGains) > 0
      ? totalTax / (taxableOrdinary + ytdLTGains) : 0;
    const quarterly = estimateQuarterlyPayment(taxableOrdinary + ytdLTGains, estWithholding, estIncome + ytdSTGains + ytdLTGains, filingStatus);
    return { incomeTax, capGainsTax, niit, totalTax, effectiveRate, quarterly };
  }, [estIncome, estWithholding, filingStatus, ytdSTGains, ytdLTGains, ytdLosses]);

  const bracketInfo = useMemo(() => {
    const taxableOrdinary = Math.max(0, estIncome + ytdSTGains - ytdLosses);
    return getTaxBracketInfo(taxableOrdinary, filingStatus);
  }, [estIncome, filingStatus, ytdSTGains, ytdLosses]);

  // ── Gains Table ──
  const filteredEvents = useMemo(() => {
    const events = data?.events || [];
    let filtered = events.filter(e =>
      e.event_type === 'realized_gain' || e.event_type === 'realized_loss',
    );
    if (gainsFilter === 'short_term') filtered = filtered.filter(e => e.tax_character === 'short_term');
    else if (gainsFilter === 'long_term') filtered = filtered.filter(e => e.tax_character === 'long_term');
    else if (gainsFilter === 'losses') filtered = filtered.filter(e => e.event_type === 'realized_loss' || Number(e.amount) < 0);

    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'date') cmp = a.date.localeCompare(b.date);
      else if (sortCol === 'ticker') cmp = (a.ticker || '').localeCompare(b.ticker || '');
      else if (sortCol === 'type') cmp = (a.tax_character || '').localeCompare(b.tax_character || '');
      else if (sortCol === 'gain_loss') cmp = Number(a.amount) - Number(b.amount);
      else if (sortCol === 'tax_impact') cmp = Number(a.amount) - Number(b.amount);
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return filtered;
  }, [data, gainsFilter, sortCol, sortDir]);

  const gainsRunningTotal = useMemo(() =>
    filteredEvents.reduce((sum, e) => sum + Number(e.amount), 0),
  [filteredEvents]);

  // ── Bracket Chart Data ──
  const bracketChartData = useMemo(() => {
    const brackets = TAX_2025.brackets[filingStatus];
    const taxableIncome = Math.max(0, estIncome + ytdSTGains - ytdLosses);
    return brackets.map((b, i) => {
      const rangeTop = b.max === Infinity ? b.min + 200000 : b.max;
      const width = rangeTop - b.min;
      const filled = taxableIncome >= b.min
        ? Math.min(taxableIncome - b.min, width) : 0;
      return {
        label: `${(b.rate * 100).toFixed(0)}%`,
        rate: b.rate * 100,
        min: b.min,
        max: b.max,
        rangeWidth: width,
        filled,
        pctFilled: width > 0 ? (filled / width) * 100 : 0,
        isCurrent: taxableIncome >= b.min && (taxableIncome <= b.max || b.max === Infinity),
        index: i,
      };
    });
  }, [filingStatus, estIncome, ytdSTGains, ytdLosses]);

  // ── Quarterly Dates ──
  const quarterlyDates = ACTIVE_TAX_YEAR.estimatedTaxDates;
  const nextQuarter = useMemo(() => {
    const now = new Date();
    const entries = Object.entries(quarterlyDates);
    for (const [q, dateStr] of entries) {
      if (new Date(dateStr) > now) return { quarter: q.toUpperCase(), date: dateStr };
    }
    return { quarter: 'Q1', date: entries[0][1] };
  }, [quarterlyDates]);

  // ── Holding Period Positions ──
  const holdingPositions = useMemo(() => {
    return positions
      .filter(p => p.holdingType === 'short_term' && p.daysHeld > 300)
      .sort((a, b) => b.daysHeld - a.daysHeld);
  }, [positions]);

  // ── Business Deductions ──
  const bizDeductions = useMemo(() => {
    const mileage = calculateMileageDeduction(bizMiles);
    const homeOffice = calculateHomeOfficeDeduction(bizSqFt, 'simplified');
    const sec179 = calculateSection179(bizEquipment);
    const sep = calculateSEPContribution(bizNetSE, filingStatus);
    const total = mileage.deduction + homeOffice.deduction + sec179.deduction + sep.maxContribution;
    const margRate = taxCalc.incomeTax.marginalRate;
    return { mileage, homeOffice, sec179, sep, total, taxSavings: Math.round(total * margRate * 100) / 100 };
  }, [bizMiles, bizSqFt, bizEquipment, bizNetSE, filingStatus, taxCalc]);

  // ── CPA Export ──
  const handleCPAExport = useCallback(async () => {
    setExportingCPA(true);
    try {
      const res = await fetch(`/api/tax/impact?symbol=__EXPORT__&side=sell&qty=0`);
      // We'll use a simpler approach: generate from events data
      if (!data?.events?.length) {
        alert('No trade events to export.');
        return;
      }
      // Build a simple 8949-style CSV from events
      const headers = 'Description of Property,Date Acquired,Date Sold,Proceeds,Cost or Other Basis,Code(s),Adjustment Amount,Gain or (Loss),Category';
      const rows = data.events
        .filter(e => e.event_type === 'realized_gain' || e.event_type === 'realized_loss')
        .map(e => {
          const isLT = e.tax_character === 'long_term';
          const cat = isLT ? 'D' : 'A';
          const adj = 'wash_sale_flag' in e && (e as any).wash_sale_flag ? 'W' : '';
          return `"${e.ticker || ''}",${e.date || 'Various'},${e.date || ''},${Math.abs(e.amount).toFixed(2)},0.00,${adj},0.00,${e.amount.toFixed(2)},${cat}`;
        });
      const csv = [headers, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Form8949-${currentYear}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
    finally { setExportingCPA(false); }
  }, [data, currentYear]);

  // ── Sort Handler ──
  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <ErrorBoundary label="Tax">
    <AppShell>
      <div>
        {/* ═══ HEADER + DISCLAIMER ═══ */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>
              Tax Center
            </h1>
            <p style={{ color: '#8888a8', fontSize: 14, margin: 0 }}>{currentYear} Tax Intelligence</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* Filing Status Selector */}
            <div style={{ position: 'relative' }}>
              <select
                value={filingStatus}
                onChange={e => setFilingStatus(e.target.value as FilingStatus)}
                aria-label="Filing status"
                style={{
                  appearance: 'none', padding: '7px 28px 7px 12px', borderRadius: 8,
                  background: '#12122a', border: '1px solid #333350', color: '#e8e8e8',
                  fontSize: 12, fontWeight: 500, cursor: 'pointer', minWidth: 180,
                }}
              >
                {Object.entries(FILING_STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#8888a8', pointerEvents: 'none' }} />
            </div>
            {/* Export */}
            <button
              onClick={() => {
                if (!data?.events?.length) return;
                exportToCSV(data.events.map(e => ({
                  date: e.date, symbol: e.ticker || '', type: e.tax_character || '',
                  gain_loss: e.amount, wash_sale: e.wash_sale_flag ? 'Yes' : 'No',
                  description: e.description || '',
                })), `tax-events-${currentYear}`);
              }}
              aria-label="Export tax events to CSV"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
                background: 'transparent', border: '1px solid #333350', color: '#8888a8', fontSize: 11,
              }}
            >
              <Download size={12} /> Export CSV
            </button>
            <button
              onClick={handleCPAExport}
              disabled={exportingCPA}
              aria-label="Export Form 8949 for CPA"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '7px 12px', borderRadius: 8, cursor: exportingCPA ? 'wait' : 'pointer',
                background: 'rgba(138,92,246,0.08)', border: '1px solid #8a5cf6', color: '#8a5cf6', fontSize: 11,
                fontWeight: 600, opacity: exportingCPA ? 0.6 : 1,
              }}
            >
              <Receipt size={12} /> {exportingCPA ? 'Generating...' : 'Export for CPA'}
            </button>
          </div>
        </div>

        {/* Tax Alerts */}
        <div style={{ marginBottom: 16 }}>
          <TaxAlertBanner maxAlerts={3} />
        </div>

        {/* Disclaimer Banner */}
        <div style={{
          padding: '8px 14px', borderRadius: 8, marginBottom: 20,
          background: 'rgba(240,198,116,0.04)', border: '1px solid rgba(240,198,116,0.15)',
          fontSize: 11, color: '#f0c674', lineHeight: 1.5, fontStyle: 'italic',
        }}>
          {TAX_DISCLAIMER}
        </div>

        {loading ? (
          <LoadingState variant="mixed" rows={5} cols={5} />
        ) : (
          <>
            {/* ═══ 1. TAX SUMMARY BANNER ═══ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
              {[
                { label: 'Realized ST Gains', value: ytdSTGains, color: '#f0c674', icon: TrendingUp },
                { label: 'Realized LT Gains', value: ytdLTGains, color: '#4ade80', icon: TrendingUp },
                { label: 'Harvested Losses', value: ytdLosses, color: '#22d3ee', icon: Shield },
                { label: 'Total Tax Est', value: taxCalc.totalTax, color: '#f87171', icon: Receipt },
                { label: 'Effective Rate', value: null, color: '#8a5cf6', icon: Calculator, pct: taxCalc.effectiveRate },
                { label: 'Marginal Rate', value: null, color: '#c4a6ff', icon: BarChart3, pct: bracketInfo.currentBracket },
              ].map(card => (
                <div key={card.label} style={{
                  background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35',
                  borderRadius: 12, padding: 14,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <card.icon size={12} color={card.color} />
                    <span style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: "'JetBrains Mono', monospace" }}>
                      {card.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace" }}>
                    {card.pct !== undefined ? fmtPct(card.pct) : fmtCurrency(card.value || 0)}
                  </div>
                </div>
              ))}
            </div>

            {/* ═══ 2. CAPITAL GAINS TRACKER ═══ */}
            <SectionCard title="Capital Gains Tracker" icon={TrendingUp} style={{ marginBottom: 20 }}>
              {/* Filters */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {(['all', 'short_term', 'long_term', 'losses'] as GainsFilter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setGainsFilter(f)}
                    aria-label={`Filter: ${f}`}
                    style={{
                      padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      border: gainsFilter === f ? '1px solid #8a5cf6' : '1px solid #2a2a3a',
                      background: gainsFilter === f ? 'rgba(138,92,246,0.1)' : 'transparent',
                      color: gainsFilter === f ? '#c4a6ff' : '#666',
                      textTransform: 'capitalize',
                    }}
                  >
                    {f.replace('_', ' ')}
                  </button>
                ))}
              </div>

              {filteredEvents.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#555', fontSize: 13 }}>
                  No realized trades for {currentYear} yet. Events appear as trades are executed.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1e1e35' }}>
                        {[
                          { key: 'date' as SortCol, label: 'Date' },
                          { key: 'ticker' as SortCol, label: 'Ticker' },
                          { key: 'type' as SortCol, label: 'Type' },
                          { key: 'gain_loss' as SortCol, label: 'Gain/Loss' },
                          { key: 'tax_impact' as SortCol, label: 'Tax Impact' },
                        ].map(h => (
                          <th
                            key={h.key}
                            onClick={() => handleSort(h.key)}
                            style={{
                              textAlign: h.key === 'gain_loss' || h.key === 'tax_impact' ? 'right' : 'left',
                              padding: '8px 12px', fontSize: 10, color: sortCol === h.key ? '#c4a6ff' : '#555',
                              textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer',
                              fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                            }}
                          >
                            {h.label} {sortCol === h.key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map(e => {
                        const amt = Number(e.amount);
                        const isLoss = amt < 0 || e.event_type === 'realized_loss';
                        const taxImpact = e.tax_character === 'long_term'
                          ? amt * 0.15 : amt * (bracketInfo.currentBracket || 0.24);
                        return (
                          <tr key={e.id} style={{ borderBottom: '1px solid rgba(30,30,53,0.5)' }}>
                            <td style={{ padding: '8px 12px', color: '#8888a8', fontSize: 12 }}>{e.date}</td>
                            <td style={{ padding: '8px 12px', color: '#e8e8e8', fontWeight: 600, fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                              {e.ticker || '-'}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{
                                padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                                background: e.tax_character === 'long_term' ? 'rgba(74,222,128,0.1)' : 'rgba(240,198,116,0.1)',
                                color: e.tax_character === 'long_term' ? '#4ade80' : '#f0c674',
                              }}>
                                {e.tax_character === 'long_term' ? 'LT' : 'ST'}
                              </span>
                              {e.wash_sale_flag && (
                                <AlertTriangle size={10} color="#f87171" style={{ marginLeft: 6 }} />
                              )}
                            </td>
                            <td style={{
                              padding: '8px 12px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 12, fontWeight: 600, color: isLoss ? '#f87171' : '#4ade80',
                            }}>
                              {fmtCurrency(amt, true)}
                            </td>
                            <td style={{
                              padding: '8px 12px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 12, color: taxImpact < 0 ? '#4ade80' : '#f87171',
                            }}>
                              {fmtCurrency(taxImpact)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid #2a2a3a' }}>
                        <td colSpan={3} style={{ padding: '8px 12px', color: '#8888a8', fontSize: 11, fontWeight: 600 }}>
                          Running Total ({filteredEvents.length} trades)
                        </td>
                        <td style={{
                          padding: '8px 12px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 13, fontWeight: 700, color: gainsRunningTotal >= 0 ? '#4ade80' : '#f87171',
                        }}>
                          {fmtCurrency(gainsRunningTotal, true)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </SectionCard>

            {/* ═══ TWO-COLUMN: HARVEST + WASH SALE ═══ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>

              {/* ═══ 3. TAX-LOSS HARVESTING PANEL ═══ */}
              <SectionCard title="Tax-Loss Harvesting" icon={TrendingDown}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                  <button
                    onClick={refreshHarvest}
                    aria-label="Scan for harvest opportunities"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                      border: '1px solid #2a2a3a', background: 'transparent', color: '#8888a8',
                    }}
                  >
                    <RefreshCw size={10} /> Scan Now
                  </button>
                </div>
                {harvestLoading ? (
                  <SectionSkeleton rows={4} />
                ) : !harvestData || harvestData.candidates.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: '#555', fontSize: 12, border: '1px dashed #2a2a3a', borderRadius: 8 }}>
                    No harvest candidates found. All positions are at a gain or below the $100 threshold.
                  </div>
                ) : (
                  <div>
                    {/* Summary */}
                    <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                      <div style={{ padding: '4px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.2)' }}>
                        <div style={{ fontSize: 9, color: '#8888a8', fontWeight: 600 }}>LOSSES</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>
                          {fmtCurrency(harvestData.totalUnrealizedLosses)}
                        </div>
                      </div>
                      <div style={{ padding: '4px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.2)' }}>
                        <div style={{ fontSize: 9, color: '#8888a8', fontWeight: 600 }}>SAVINGS</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>
                          {fmtCurrency(harvestData.totalPotentialSavings)}
                        </div>
                      </div>
                    </div>
                    {/* Candidates */}
                    {harvestData.candidates.slice(0, 5).map(c => (
                      <div key={c.ticker} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '6px 0', borderBottom: '1px solid rgba(30,30,53,0.5)',
                      }}>
                        <div>
                          <span style={{ color: '#e8e8e8', fontWeight: 600, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
                            {c.ticker}
                          </span>
                          {c.washSaleRisk && (
                            <span style={{ marginLeft: 6, fontSize: 9, color: '#f87171', fontWeight: 700 }}>WASH RISK</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <span style={{ color: '#f87171', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                            {fmtCurrency(c.unrealizedLoss)}
                          </span>
                          <span style={{ color: '#4ade80', fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                            save {fmtCurrency(c.taxSavings)}
                          </span>
                        </div>
                      </div>
                    ))}
                    {/* Recommendation */}
                    <div style={{ marginTop: 8, fontSize: 11, color: '#b0b0c0', lineHeight: 1.5 }}>
                      {harvestData.recommendation}
                    </div>
                  </div>
                )}
              </SectionCard>

              {/* ═══ 4. WASH SALE MONITOR ═══ */}
              <SectionCard title="Wash Sale Monitor" icon={AlertTriangle}>
                {(data?.wash_sales || []).length === 0 ? (
                  <div style={{ color: '#4ade80', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Shield size={14} />
                    No active wash sale restrictions
                  </div>
                ) : (
                  data?.wash_sales.map((ws, i) => {
                    const sellDate = new Date(ws.date);
                    const expireDate = new Date(ws.wash_sale_expires);
                    const now = new Date();
                    const totalDays = Math.max(1, (expireDate.getTime() - sellDate.getTime()) / 86400000);
                    const elapsed = (now.getTime() - sellDate.getTime()) / 86400000;
                    const pct = Math.min(100, Math.max(0, (elapsed / totalDays) * 100));
                    const daysLeft = Math.max(0, Math.ceil((expireDate.getTime() - now.getTime()) / 86400000));

                    return (
                      <div key={i} style={{ marginBottom: 12, padding: '10px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.15)', background: 'rgba(248,113,113,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ color: '#f87171', fontWeight: 700, fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>
                            {ws.ticker}
                          </span>
                          <span style={{ color: '#f87171', fontSize: 11 }}>
                            {daysLeft}d remaining
                          </span>
                        </div>
                        {/* Timeline bar */}
                        <div style={{ height: 6, borderRadius: 3, background: '#1a1a3a', position: 'relative', marginBottom: 4 }}>
                          <div style={{
                            height: '100%', borderRadius: 3, width: `${pct}%`,
                            background: pct > 90 ? '#4ade80' : '#f87171',
                            transition: 'width 300ms ease',
                          }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#555' }}>
                          <span>Sold {ws.date}</span>
                          <span>Safe {ws.wash_sale_expires}</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#8888a8', marginTop: 4 }}>
                          Loss: {fmtCurrency(Math.abs(ws.amount))}
                        </div>
                      </div>
                    );
                  })
                )}
              </SectionCard>
            </div>

            {/* ═══ TWO-COLUMN: ESTIMATED TAX + BRACKETS ═══ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>

              {/* ═══ 5. ESTIMATED TAX CALCULATOR ═══ */}
              <SectionCard title="Estimated Tax Calculator" icon={Calculator}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Inputs */}
                  <div>
                    <label style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      PROJECTED ORDINARY INCOME
                    </label>
                    <input
                      type="number"
                      value={estIncome}
                      onChange={e => setEstIncome(Number(e.target.value) || 0)}
                      aria-label="Projected ordinary income"
                      style={{
                        width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 13,
                        background: '#0a0a1a', border: '1px solid #2a2a3a', color: '#e8e8e8',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      YTD WITHHOLDING / PAYMENTS
                    </label>
                    <input
                      type="number"
                      value={estWithholding}
                      onChange={e => setEstWithholding(Number(e.target.value) || 0)}
                      aria-label="YTD withholding"
                      style={{
                        width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 13,
                        background: '#0a0a1a', border: '1px solid #2a2a3a', color: '#e8e8e8',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    />
                  </div>

                  {/* Results */}
                  <div style={{ borderTop: '1px solid #1e1e35', paddingTop: 10 }}>
                    {[
                      { label: 'Income Tax', value: taxCalc.incomeTax.totalTax, color: '#f87171' },
                      { label: 'Cap Gains Tax', value: taxCalc.capGainsTax.tax, color: '#f0c674' },
                      { label: 'NIIT (3.8%)', value: taxCalc.niit.niit, color: '#8a5cf6' },
                      { label: 'Total Estimated Tax', value: taxCalc.totalTax, color: '#fff', bold: true },
                    ].map(r => (
                      <div key={r.label} style={{
                        display: 'flex', justifyContent: 'space-between', padding: '4px 0',
                        borderBottom: '1px solid rgba(30,30,53,0.3)',
                      }}>
                        <span style={{ fontSize: 12, color: '#8888a8', fontWeight: ('bold' in r && r.bold) ? 700 : 400 }}>{r.label}</span>
                        <span style={{
                          fontSize: 13, fontWeight: ('bold' in r && r.bold) ? 700 : 600, color: r.color,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>
                          {fmtCurrency(r.value)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Quarterly Payments */}
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, marginBottom: 6 }}>QUARTERLY ESTIMATED PAYMENTS</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                      {Object.entries(quarterlyDates).map(([q, date]) => {
                        const isNext = q.toUpperCase() === nextQuarter.quarter;
                        const isPast = new Date(date) < new Date();
                        return (
                          <div key={q} style={{
                            padding: '6px 8px', borderRadius: 6, textAlign: 'center',
                            background: isNext ? 'rgba(240,198,116,0.08)' : 'rgba(0,0,0,0.2)',
                            border: isNext ? '1px solid rgba(240,198,116,0.3)' : '1px solid transparent',
                            opacity: isPast ? 0.5 : 1,
                          }}>
                            <div style={{ fontSize: 10, color: isNext ? '#f0c674' : '#666', fontWeight: 600 }}>
                              {q.toUpperCase()}
                            </div>
                            <div style={{
                              fontSize: 13, fontWeight: 700, color: isNext ? '#f0c674' : '#e8e8e8',
                              fontFamily: "'JetBrains Mono', monospace",
                            }}>
                              {fmtCurrency(taxCalc.quarterly.quarterlyAmount)}
                            </div>
                            <div style={{ fontSize: 9, color: '#555' }}>{date}</div>
                          </div>
                        );
                      })}
                    </div>
                    {nextQuarter && (
                      <div style={{ marginTop: 6, fontSize: 11, color: '#f0c674' }}>
                        Next payment: {nextQuarter.quarter} due {nextQuarter.date}
                      </div>
                    )}
                  </div>
                </div>
              </SectionCard>

              {/* ═══ 6. TAX BRACKET VISUALIZER ═══ */}
              <SectionCard title="Tax Bracket Visualizer" icon={BarChart3}>
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={bracketChartData} layout="vertical" margin={{ left: 40, right: 16 }}>
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="label"
                        tick={{ fill: '#8888a8', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}
                        width={40}
                      />
                      <RTooltip
                        contentStyle={{ background: '#12122a', border: '1px solid #2a2a3a', borderRadius: 8, fontSize: 11, color: '#e8e8e8' }}
                        formatter={(value: number, name: string) => {
                          return [`${Math.round(value)}% filled`, name];
                        }}
                      />
                      <Bar dataKey="pctFilled" radius={[0, 4, 4, 0]} maxBarSize={20}>
                        {bracketChartData.map(entry => (
                          <Cell
                            key={entry.label}
                            fill={entry.isCurrent ? '#f0c674' : entry.pctFilled > 0 ? '#8a5cf6' : '#1a1a3a'}
                          />
                        ))}
                      </Bar>
                      <ReferenceLine x={100} stroke="#f87171" strokeDasharray="3 3" strokeWidth={1} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11 }}>
                  <span style={{ color: '#8888a8' }}>
                    Current bracket: <strong style={{ color: '#f0c674' }}>{fmtPct(bracketInfo.currentBracket)}</strong>
                  </span>
                  <span style={{ color: '#8888a8' }}>
                    Room in bracket: <strong style={{ color: '#4ade80' }}>
                      {bracketInfo.roomInBracket === Infinity ? '∞' : fmtCurrency(bracketInfo.roomInBracket)}
                    </strong>
                  </span>
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: '#666' }}>
                  Effective rate: {fmtPct(taxCalc.effectiveRate)} · Marginal rate: {fmtPct(bracketInfo.currentBracket)}
                </div>
              </SectionCard>
            </div>

            {/* ═══ TWO-COLUMN: HOLDING PERIOD + SECTION 1256 ═══ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>

              {/* ═══ 7. HOLDING PERIOD MONITOR ═══ */}
              <SectionCard title="Holding Period Monitor" icon={Clock}>
                {posLoading ? (
                  <SectionSkeleton rows={3} />
                ) : holdingPositions.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: '#555', fontSize: 12 }}>
                    {positions.length === 0
                      ? 'No positions found. Connect your brokerage to monitor holding periods.'
                      : 'No positions approaching long-term status (>300 days held).'}
                  </div>
                ) : (
                  <div>
                    {holdingPositions.map(p => {
                      const pct = (p.daysHeld / 366) * 100;
                      const isClose = p.daysUntilLongTerm <= 30;
                      const isVeryClose = p.daysUntilLongTerm <= 7;

                      return (
                        <div key={p.symbol} style={{
                          marginBottom: 10, padding: '8px 10px', borderRadius: 8,
                          border: isClose ? '1px solid rgba(240,198,116,0.3)' : '1px solid #1a1a3a',
                          background: isClose ? 'rgba(240,198,116,0.03)' : 'transparent',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: '#e8e8e8', fontWeight: 700, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
                                {p.symbol}
                              </span>
                              {isVeryClose && (
                                <span style={{
                                  padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                                  background: 'rgba(248,113,113,0.15)', color: '#f87171',
                                }}>
                                  DO NOT SELL
                                </span>
                              )}
                              {isClose && !isVeryClose && (
                                <span style={{
                                  padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                                  background: 'rgba(240,198,116,0.12)', color: '#f0c674',
                                }}>
                                  HOLD
                                </span>
                              )}
                            </div>
                            <span style={{
                              color: isClose ? '#f0c674' : '#8888a8', fontSize: 12, fontWeight: 600,
                              fontFamily: "'JetBrains Mono', monospace",
                            }}>
                              {p.daysUntilLongTerm}d to LT
                            </span>
                          </div>
                          {/* Progress bar */}
                          <div style={{ height: 4, borderRadius: 2, background: '#1a1a3a' }}>
                            <div style={{
                              height: '100%', borderRadius: 2, width: `${Math.min(100, pct)}%`,
                              background: isClose ? '#f0c674' : '#8a5cf6',
                              transition: 'width 300ms ease',
                            }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontSize: 9, color: '#555' }}>
                            <span>{p.daysHeld}d held</span>
                            <span>366d = long-term</span>
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
                      Positions held 366+ days qualify for preferential long-term capital gains rates (0/15/20% vs ordinary income rates).
                    </div>
                  </div>
                )}
              </SectionCard>

              {/* ═══ 8. SECTION 1256 OPPORTUNITIES ═══ */}
              <SectionCard title="Section 1256 — 60/40 Split" icon={Receipt}>
                <Section1256Panel
                  filingStatus={filingStatus}
                  ordinaryIncome={estIncome}
                />
              </SectionCard>
            </div>

            {/* ═══ 9. BUSINESS DEDUCTIONS (Glastonbury Group) ═══ */}
            <SectionCard title="Business Deductions — Glastonbury Group" icon={Calculator} style={{ marginBottom: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Mileage */}
                <div>
                  <label style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    BUSINESS MILES DRIVEN
                  </label>
                  <input
                    type="number"
                    value={bizMiles || ''}
                    onChange={e => setBizMiles(Number(e.target.value) || 0)}
                    placeholder="0"
                    aria-label="Business miles driven"
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 13,
                      background: '#0a0a1a', border: '1px solid #2a2a3a', color: '#e8e8e8',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  />
                  <div style={{ fontSize: 10, color: '#555', marginTop: 3 }}>
                    @ ${ACTIVE_TAX_YEAR.businessDeductions.mileageRate}/mile → <strong style={{ color: '#4ade80' }}>{fmtCurrency(bizDeductions.mileage.deduction)}</strong>
                  </div>
                </div>

                {/* Home Office */}
                <div>
                  <label style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    HOME OFFICE (SQ FT)
                  </label>
                  <input
                    type="number"
                    value={bizSqFt || ''}
                    onChange={e => setBizSqFt(Number(e.target.value) || 0)}
                    placeholder="0"
                    aria-label="Home office square footage"
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 13,
                      background: '#0a0a1a', border: '1px solid #2a2a3a', color: '#e8e8e8',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  />
                  <div style={{ fontSize: 10, color: '#555', marginTop: 3 }}>
                    Simplified method (max 300 sq ft) → <strong style={{ color: '#4ade80' }}>{fmtCurrency(bizDeductions.homeOffice.deduction)}</strong>
                  </div>
                </div>

                {/* Section 179 */}
                <div>
                  <label style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    EQUIPMENT PURCHASES (§179)
                  </label>
                  <input
                    type="number"
                    value={bizEquipment || ''}
                    onChange={e => setBizEquipment(Number(e.target.value) || 0)}
                    placeholder="0"
                    aria-label="Equipment purchases"
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 13,
                      background: '#0a0a1a', border: '1px solid #2a2a3a', color: '#e8e8e8',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  />
                  <div style={{ fontSize: 10, color: '#555', marginTop: 3 }}>
                    Deduction: <strong style={{ color: '#4ade80' }}>{fmtCurrency(bizDeductions.sec179.deduction)}</strong>
                    {bizDeductions.sec179.phaseout && <span style={{ color: '#f87171' }}> (phaseout applies)</span>}
                  </div>
                </div>

                {/* SEP-IRA */}
                <div>
                  <label style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    NET SELF-EMPLOYMENT INCOME
                  </label>
                  <input
                    type="number"
                    value={bizNetSE || ''}
                    onChange={e => setBizNetSE(Number(e.target.value) || 0)}
                    placeholder="0"
                    aria-label="Net self-employment income"
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 13,
                      background: '#0a0a1a', border: '1px solid #2a2a3a', color: '#e8e8e8',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  />
                  <div style={{ fontSize: 10, color: '#555', marginTop: 3 }}>
                    SEP-IRA max: <strong style={{ color: '#4ade80' }}>{fmtCurrency(bizDeductions.sep.maxContribution)}</strong>
                    {' '}(saves {fmtCurrency(bizDeductions.sep.taxSavings)})
                  </div>
                </div>
              </div>

              {/* Summary */}
              {bizDeductions.total > 0 && (
                <div style={{
                  marginTop: 16, padding: '10px 14px', borderRadius: 8,
                  background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.15)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#e8e8e8' }}>
                      Total Business Deductions
                    </div>
                    <div style={{ fontSize: 10, color: '#8888a8', marginTop: 2 }}>
                      Estimated tax savings at {fmtPct(taxCalc.incomeTax.marginalRate)} marginal rate
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontSize: 20, fontWeight: 700, color: '#4ade80',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {fmtCurrency(bizDeductions.total)}
                    </div>
                    <div style={{ fontSize: 11, color: '#4ade80', opacity: 0.7 }}>
                      saves {fmtCurrency(bizDeductions.taxSavings)}
                    </div>
                  </div>
                </div>
              )}
            </SectionCard>
          </>
        )}
      </div>
    </AppShell>
    </ErrorBoundary>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1256 SUB-COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function Section1256Panel({ filingStatus, ordinaryIncome }: {
  filingStatus: FilingStatus;
  ordinaryIncome: number;
}) {
  const [gain, setGain] = useState(10000);

  const result = useMemo(() =>
    calculateSection1256Tax(gain, ordinaryIncome, filingStatus),
  [gain, ordinaryIncome, filingStatus]);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, display: 'block', marginBottom: 4 }}>
          TOTAL GAIN ON 1256 CONTRACTS
        </label>
        <input
          type="number"
          value={gain}
          onChange={e => setGain(Number(e.target.value) || 0)}
          aria-label="Section 1256 gain"
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 13,
            background: '#0a0a1a', border: '1px solid #2a2a3a', color: '#e8e8e8',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        />
      </div>

      {/* 60/40 Split Visual */}
      <div style={{ display: 'flex', height: 24, borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ width: '60%', background: 'rgba(74,222,128,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#4ade80' }}>60% LT</span>
        </div>
        <div style={{ width: '40%', background: 'rgba(240,198,116,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#f0c674' }}>40% ST</span>
        </div>
      </div>

      {/* Breakdown */}
      {[
        { label: 'Long-Term Portion (60%)', value: result.longTermPortion, tax: result.longTermTax, color: '#4ade80' },
        { label: 'Short-Term Portion (40%)', value: result.shortTermPortion, tax: result.shortTermTax, color: '#f0c674' },
        { label: 'Total 1256 Tax', value: null, tax: result.totalTax, color: '#e8e8e8', bold: true },
      ].map(r => (
        <div key={r.label} style={{
          display: 'flex', justifyContent: 'space-between', padding: '4px 0',
          borderBottom: '1px solid rgba(30,30,53,0.3)',
        }}>
          <div>
            <span style={{ fontSize: 12, color: '#8888a8', fontWeight: r.bold ? 700 : 400 }}>{r.label}</span>
            {r.value !== null && (
              <span style={{ fontSize: 10, color: '#555', marginLeft: 6 }}>{fmtCurrency(r.value)}</span>
            )}
          </div>
          <span style={{
            fontSize: 13, fontWeight: r.bold ? 700 : 600, color: r.color,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {fmtCurrency(r.tax)}
          </span>
        </div>
      ))}

      {/* Savings vs all-short-term */}
      {result.savings > 0 && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 6,
          background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.15)',
          fontSize: 12, color: '#4ade80',
        }}>
          <strong>Savings vs all short-term:</strong>{' '}
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
            {fmtCurrency(result.savings)}
          </span>
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 11, color: '#666', lineHeight: 1.5 }}>
        Section 1256 contracts (futures, broad-based index options) receive automatic 60/40 long-term/short-term treatment regardless of holding period.
      </div>
    </div>
  );
}
