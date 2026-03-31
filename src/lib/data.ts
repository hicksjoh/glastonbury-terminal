import { RoadmapEntry, Strategy, AuditLogEntry } from '@/types';

export const ROADMAP_DATA: RoadmapEntry[] = [
  { year: 2026, engine: 'Foundation', projected: 580000, actual: 580000 },
  { year: 2027, engine: 'CR3 Scale', projected: 1200000 },
  { year: 2028, engine: 'Expansion', projected: 2800000 },
  { year: 2029, engine: 'Franchise Growth', projected: 6500000 },
  { year: 2030, engine: 'IPO Catalyst', projected: 15000000 },
  { year: 2031, engine: 'Portfolio Compounding', projected: 28000000 },
  { year: 2032, engine: '$50M Target', projected: 50000000 },
];

export const MOCK_STRATEGIES: Strategy[] = [
  {
    id: '1',
    name: 'Covered Call Wheel',
    type: 'covered_call_wheel',
    status: 'paper',
    params: { targetDelta: 0.3, daysToExpiry: 30, targetYield: 0.02 },
    performance: { totalReturn: 4280, totalReturnPct: 8.4, tradesExecuted: 12, lastRun: new Date().toISOString() },
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2',
    name: 'Tax-Loss Harvesting',
    type: 'tax_loss_harvest',
    status: 'active',
    params: { threshold: -0.05, washSaleDays: 31 },
    performance: { totalReturn: 1240, totalReturnPct: 2.1, tradesExecuted: 4, lastRun: new Date().toISOString() },
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '3',
    name: 'Auto Rebalance',
    type: 'auto_rebalance',
    status: 'active',
    params: { rebalancePct: 5, frequency: 'quarterly' },
    performance: { totalReturn: 890, totalReturnPct: 1.5, tradesExecuted: 2, lastRun: new Date().toISOString() },
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '4',
    name: 'RSU Diversification',
    type: 'rsu_diversification',
    status: 'paper',
    params: { vestingSchedule: 'quarterly', diversifyPct: 0.5, targetAllocation: 'VTI' },
    performance: { totalReturn: 0, totalReturnPct: 0, tradesExecuted: 0 },
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const MOCK_AUDIT_LOG: AuditLogEntry[] = [
  { id: '1', timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(), agent: 'Keisha', action: 'Portfolio Analysis', details: 'Analyzed 8 positions, identified 2 covered call opportunities', status: 'success', reason: 'Scheduled daily scan — AAPL and MSFT both showing elevated IV rank above 40%, optimal for premium selling' },
  { id: '2', timestamp: new Date(Date.now() - 1000 * 60 * 32).toISOString(), agent: 'Tax-Loss Harvester', action: 'Scan Complete', details: 'Scanned 8 positions, no harvest opportunities above threshold', status: 'success', reason: 'All positions within -5% threshold — closest was TSLA at -3.8%, holding for now' },
  { id: '3', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), agent: 'Rebalancer', action: 'Drift Check', details: 'Portfolio drift within 3.2% of target — no rebalance needed', status: 'success', reason: 'Equities at 62% (target 60%), options at 24% (target 25%) — within 5% tolerance band' },
  { id: '4', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(), agent: 'Morning Brief', action: 'Briefing Generated', details: 'Daily briefing generated and delivered', status: 'success', reason: 'Market opened green, Fed minutes due today — flagged potential volatility impact on options positions' },
  { id: '5', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), agent: 'Covered Call Wheel', action: 'Opportunity Detected', details: 'AAPL 185C 30 DTE — estimated premium $2.40/contract', status: 'pending', reason: 'Sold AAPL 185C: 30 DTE reached, IV rank 42%, theta decay optimal at -0.04/day' },
];

export const INCOME_STREAM_DATA = [
  { month: 'Jan', cr3: 143333, anthropic: 22500, dividends: 1200, options: 0 },
  { month: 'Feb', cr3: 143333, anthropic: 22500, dividends: 800, options: 840 },
  { month: 'Mar', cr3: 143333, anthropic: 22500, dividends: 1500, options: 1240 },
  { month: 'Apr', cr3: 143333, anthropic: 22500, dividends: 900, options: 2100 },
  { month: 'May', cr3: 143333, anthropic: 22500, dividends: 1100, options: 1680 },
  { month: 'Jun', cr3: 143333, anthropic: 22500, dividends: 2400, options: 3200 },
];

export const PORTFOLIO_SUMMARY = {
  totalNetWorth: 1482000,
  alpacaEquity: 82000,
  alpacaCash: 18000,
  cr3Equity: 720000,
  anthropicRSUs: 82000,
  miamiShoresProperty: 580000,
  otherCash: 0,
  lastUpdated: new Date().toISOString(),
};
