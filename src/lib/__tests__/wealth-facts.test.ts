import { describe, it, expect } from 'vitest';
import {
  formatWealthFactsBlock,
  type WealthFactsBlock,
  type WealthFact,
  type CR3StrategySplit,
  type CR3TopPerformer,
  type RevenueTrajectoryRow,
} from '@/lib/wealth-facts';

const updatedAt = new Date('2026-04-15T12:00:00Z');

function fact<T>(value: T, displayLabel: string, key: string): WealthFact<T> {
  return { key, value, displayLabel, source: 'manual', updatedAt };
}

function fullFixture(): WealthFactsBlock {
  return {
    masterTarget2032: fact(56_670_000, 'Master Target', 'master_target_2032'),
    target2026Foundation: fact(580_000, 'Foundation Year 2026', 'target_2026_foundation'),
    cr3TotalTerritories: fact(23, 'CR3 Total Territories', 'cr3_total_territories'),
    cr3SeacoastTerritories: fact(13, 'CR3 Seacoast', 'cr3_seacoast_territories'),
    cr3WestCoastTerritories: fact(10, 'CR3 West Coast', 'cr3_west_coast_territories'),
    cr3ProjectedRevenue2026: fact(1_720_000, 'CR3 Projected 2026', 'cr3_projected_revenue_2026'),
    cr3StrategySplit: fact<CR3StrategySplit>(
      { operate: 3, sell: 17, hybrid: 3 },
      'CR3 Strategy Split',
      'cr3_strategy_split',
    ),
    cr3TopPerformers: fact<CR3TopPerformer[]>(
      [
        { name: 'Naples', multiplier: 1.8 },
        { name: 'Boca Raton', multiplier: 1.5 },
      ],
      'CR3 Top Performers',
      'cr3_top_performers',
    ),
    cr3EquityValue: fact(720_000, 'CR3 Equity', 'cr3_equity_value'),
    anthropicRsusRemaining: fact(5_749, 'Anthropic RSUs', 'anthropic_rsus_remaining'),
    anthropicRsuGrantPrice: fact(259.14, 'Anthropic RSU Grant Price', 'anthropic_rsu_grant_price'),
    miamiShoresPropertyValue: fact(580_000, 'Miami Shores Property', 'miami_shores_property_value'),
    revenueTrajectoryTable: fact<RevenueTrajectoryRow[]>(
      [
        { year: 2026, annual: 580_000, cumulative: 580_000, phase: 'Foundation Year' },
        { year: 2032, annual: 17_300_000, cumulative: 56_670_000, phase: 'Empire ($50M)' },
      ],
      '$50M Revenue Trajectory',
      'revenue_trajectory_table',
    ),
    latestUpdate: updatedAt,
  };
}

describe('formatWealthFactsBlock', () => {
  const asOf = new Date('2026-04-28T00:00:00Z');

  it('stamps the as-of date in the header', () => {
    const out = formatWealthFactsBlock(fullFixture(), asOf);
    expect(out).toContain('WEALTH FACTS (as of 2026-04-28)');
  });

  it('renders each numeric fact with its updated date', () => {
    const out = formatWealthFactsBlock(fullFixture(), asOf);
    // Each numeric line carries an [updated YYYY-MM-DD] stamp
    expect(out).toMatch(/Anthropic RSUs: 5,749 @ \$259\.14 grant price.*\[updated 2026-04-15\]/);
    expect(out).toMatch(/MASTER TARGET: \$56\.67M.*\[updated 2026-04-15\].*cumulative wealth by 2032/);
    expect(out).toMatch(/Miami Shores property: \$580K.*\[updated 2026-04-15\]/);
  });

  it('includes territory counts and CR3 strategy split', () => {
    const out = formatWealthFactsBlock(fullFixture(), asOf);
    expect(out).toContain('Total territories: 23');
    expect(out).toContain('Seacoast FL: 13 territories');
    expect(out).toContain('West Coast FL: 10 territories');
    expect(out).toContain('Operate 3');
    expect(out).toContain('Sell 17');
    expect(out).toContain('Hybrid 3');
  });

  it('renders top performers as comma-separated multipliers', () => {
    const out = formatWealthFactsBlock(fullFixture(), asOf);
    expect(out).toContain('Naples 1.8x');
    expect(out).toContain('Boca Raton 1.5x');
  });

  it('renders the trajectory table with year, annual, cumulative, phase', () => {
    const out = formatWealthFactsBlock(fullFixture(), asOf);
    expect(out).toContain('$50M TRAJECTORY');
    expect(out).toContain('2026');
    expect(out).toContain('Foundation Year');
    expect(out).toContain('2032');
    expect(out).toContain('Empire ($50M)');
  });

  it('mentions the display labels we expose so admin tooling can rely on them', () => {
    // The display_label fields are the human-readable handles for an
    // admin form. We verify the formatter at least references the key
    // domains so the test catches accidental schema drift.
    const out = formatWealthFactsBlock(fullFixture(), asOf);
    expect(out).toContain('CR3 American Exteriors');
    expect(out).toContain('Anthropic Compensation');
    expect(out).toContain('Miami Shores property');
  });

  it('degrades gracefully when facts are missing', () => {
    const empty: WealthFactsBlock = {
      masterTarget2032: null,
      target2026Foundation: null,
      cr3TotalTerritories: null,
      cr3SeacoastTerritories: null,
      cr3WestCoastTerritories: null,
      cr3ProjectedRevenue2026: null,
      cr3StrategySplit: null,
      cr3TopPerformers: null,
      cr3EquityValue: null,
      anthropicRsusRemaining: null,
      anthropicRsuGrantPrice: null,
      miamiShoresPropertyValue: null,
      revenueTrajectoryTable: null,
      latestUpdate: null,
    };

    const out = formatWealthFactsBlock(empty, asOf);
    // Header still present
    expect(out).toContain('WEALTH FACTS (as of 2026-04-28)');
    // Missing values render as 'unknown' rather than throwing
    expect(out).toContain('unknown');
    // Trajectory table is omitted entirely when missing
    expect(out).not.toContain('$50M TRAJECTORY');
  });
});
