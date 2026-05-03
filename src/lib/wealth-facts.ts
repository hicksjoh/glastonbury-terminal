// Wealth facts loader — Wave 4
// ----------------------------------------------------------------------------
// Keisha's hardcoded portfolio numbers used to live inline in
// src/lib/prompts/keisha-system.ts (the cached system prompt). Updating them
// required a code edit + redeploy, so they drifted.
//
// This module reads the same numbers from a Supabase `wealth_facts` table
// (see supabase/migrations/006_wealth_facts.sql) and formats them as a
// markdown block to be prepended to the DYNAMIC (uncached) part of the
// system message inside buildFullPortfolioContext. That keeps the static
// system prompt cache hot while letting the numbers refresh per-request.
//
// The format is intentionally close to the prose Keisha used to read so
// her downstream behavior (referencing $50M, Naples 1.8x, 23 territories,
// 5,749 RSUs, etc.) keeps working the same.

import type { createServiceClient } from '@/lib/supabase';

// ── Domain types ─────────────────────────────────────────────────────────────

export interface CR3StrategySplit {
  operate: number;
  sell: number;
  hybrid: number;
}

export interface CR3TopPerformer {
  name: string;
  multiplier: number;
}

export interface RevenueTrajectoryRow {
  year: number;
  annual: number;
  cumulative: number;
  phase: string;
}

export interface WealthFact<T = unknown> {
  key: string;
  value: T;
  displayLabel: string;
  source: string;
  updatedAt: Date;
}

/**
 * Strongly-typed view of all known wealth facts. Each property is `null`
 * if the corresponding row is missing from the `wealth_facts` table — that
 * way the formatter degrades gracefully instead of throwing.
 */
export interface WealthFactsBlock {
  masterTarget2032: WealthFact<number> | null;
  target2026Foundation: WealthFact<number> | null;
  cr3TotalTerritories: WealthFact<number> | null;
  cr3SeacoastTerritories: WealthFact<number> | null;
  cr3WestCoastTerritories: WealthFact<number> | null;
  cr3ProjectedRevenue2026: WealthFact<number> | null;
  cr3StrategySplit: WealthFact<CR3StrategySplit> | null;
  cr3TopPerformers: WealthFact<CR3TopPerformer[]> | null;
  cr3EquityValue: WealthFact<number> | null;
  anthropicRsusRemaining: WealthFact<number> | null;
  anthropicRsuGrantPrice: WealthFact<number> | null;
  miamiShoresPropertyValue: WealthFact<number> | null;
  revenueTrajectoryTable: WealthFact<RevenueTrajectoryRow[]> | null;
  /** Latest `updated_at` across all loaded rows, or null when nothing loaded. */
  latestUpdate: Date | null;
}

// ── Loader ───────────────────────────────────────────────────────────────────

interface RawRow {
  key: string;
  value_json: unknown;
  display_label: string;
  source: string;
  updated_at: string;
}

const KEY_TO_FIELD: Record<string, keyof Omit<WealthFactsBlock, 'latestUpdate'>> = {
  master_target_2032: 'masterTarget2032',
  target_2026_foundation: 'target2026Foundation',
  cr3_total_territories: 'cr3TotalTerritories',
  cr3_seacoast_territories: 'cr3SeacoastTerritories',
  cr3_west_coast_territories: 'cr3WestCoastTerritories',
  cr3_projected_revenue_2026: 'cr3ProjectedRevenue2026',
  cr3_strategy_split: 'cr3StrategySplit',
  cr3_top_performers: 'cr3TopPerformers',
  cr3_equity_value: 'cr3EquityValue',
  anthropic_rsus_remaining: 'anthropicRsusRemaining',
  anthropic_rsu_grant_price: 'anthropicRsuGrantPrice',
  miami_shores_property_value: 'miamiShoresPropertyValue',
  revenue_trajectory_table: 'revenueTrajectoryTable',
};

function emptyBlock(): WealthFactsBlock {
  return {
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
}

/**
 * Loads every row from the `wealth_facts` table, maps it onto a typed
 * WealthFactsBlock by key, and returns an empty block on any error so the
 * caller never has to handle exceptions just to render Keisha's prompt.
 */
export async function loadWealthFacts(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<WealthFactsBlock> {
  const block = emptyBlock();

  try {
    const { data, error } = await supabase
      .from('wealth_facts')
      .select('key, value_json, display_label, source, updated_at');

    if (error || !data) return block;

    let latest: Date | null = null;
    for (const raw of data as unknown as RawRow[]) {
      const field = KEY_TO_FIELD[raw.key];
      if (!field) continue; // unknown key — ignore so we can add new ones safely

      const updatedAt = new Date(raw.updated_at);
      if (!latest || updatedAt.getTime() > latest.getTime()) {
        latest = updatedAt;
      }

      // Cast through unknown — runtime shape is enforced by the migration.
      // A bad value_json on disk would just propagate to Keisha's prompt as
      // best-effort; we'd rather render the wrong number than blow up the chat.
      const fact: WealthFact<unknown> = {
        key: raw.key,
        value: raw.value_json,
        displayLabel: raw.display_label,
        source: raw.source,
        updatedAt,
      };
      (block as any)[field] = fact;
    }
    block.latestUpdate = latest;
  } catch {
    // Non-critical: fall back to empty block so Keisha still answers.
  }

  return block;
}

// ── Formatter ────────────────────────────────────────────────────────────────

const usd = (n: number): string => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};

const isoDate = (d: Date): string => d.toISOString().split('T')[0];

function fmtNumber(fact: WealthFact<number> | null, fmt: (n: number) => string): string {
  if (!fact) return 'unknown';
  return `${fmt(fact.value)} [updated ${isoDate(fact.updatedAt)}]`;
}

/**
 * Renders all wealth facts as a markdown block intended for the DYNAMIC
 * portion of Keisha's system message (the uncached half — see
 * src/lib/prompts/index.ts cachedSystem helper).
 *
 * Style mirrors the section that used to live in keisha-system.ts so
 * Keisha's downstream voice doesn't shift. Each numeric line carries the
 * row's last-updated date so the model can reason about staleness.
 */
export function formatWealthFactsBlock(facts: WealthFactsBlock, asOf: Date): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════');
  lines.push(`  WEALTH FACTS (as of ${isoDate(asOf)})`);
  lines.push('═══════════════════════════════════════════');
  lines.push('');
  lines.push('These numbers are loaded live from the wealth_facts table — they may');
  lines.push('have shifted since training. Treat the bracketed update date as the');
  lines.push('authoritative recency stamp for each line.');
  lines.push('');

  // Targets
  lines.push(`MASTER TARGET: ${fmtNumber(facts.masterTarget2032, usd)} cumulative wealth by 2032`);
  lines.push(`Foundation Year 2026 Target: ${fmtNumber(facts.target2026Foundation, usd)}`);
  lines.push('');

  // CR3 territories
  lines.push('REVENUE ARCHITECTURE:');
  lines.push('- CR3 American Exteriors (Franchise Operations) — 60-70% of revenue');
  if (facts.cr3TotalTerritories) {
    lines.push(`  - Total territories: ${facts.cr3TotalTerritories.value} [updated ${isoDate(facts.cr3TotalTerritories.updatedAt)}]`);
  }
  if (facts.cr3SeacoastTerritories) {
    lines.push(`  - Seacoast FL: ${facts.cr3SeacoastTerritories.value} territories (Miami, Fort Lauderdale, West Palm Beach, Saint Lucie, Orlando) [updated ${isoDate(facts.cr3SeacoastTerritories.updatedAt)}]`);
  }
  if (facts.cr3WestCoastTerritories) {
    lines.push(`  - West Coast FL: ${facts.cr3WestCoastTerritories.value} territories (signed March 2026) [updated ${isoDate(facts.cr3WestCoastTerritories.updatedAt)}]`);
  }
  if (facts.cr3ProjectedRevenue2026) {
    lines.push(`  - Projected 2026 revenue: ${usd(facts.cr3ProjectedRevenue2026.value)} across all territories [updated ${isoDate(facts.cr3ProjectedRevenue2026.updatedAt)}]`);
  }

  if (facts.cr3TopPerformers) {
    const list = facts.cr3TopPerformers.value
      .map(p => `${p.name} ${p.multiplier}x`)
      .join(', ');
    lines.push(`  - Top performers: ${list} [updated ${isoDate(facts.cr3TopPerformers.updatedAt)}]`);
  }

  if (facts.cr3StrategySplit) {
    const s = facts.cr3StrategySplit.value;
    lines.push(`  - Strategy: Operate ${s.operate} (Miami North, Miami Central, FTL South), Sell ${s.sell}, Hybrid ${s.hybrid} [updated ${isoDate(facts.cr3StrategySplit.updatedAt)}]`);
  }

  if (facts.cr3EquityValue) {
    lines.push(`  - CR3 equity (off-brokerage): ${usd(facts.cr3EquityValue.value)} [updated ${isoDate(facts.cr3EquityValue.updatedAt)}]`);
  }
  lines.push('');

  // Anthropic RSUs
  lines.push('- Anthropic Compensation — 10-15% of revenue');
  if (facts.anthropicRsusRemaining && facts.anthropicRsuGrantPrice) {
    lines.push(
      `  - Anthropic RSUs: ${facts.anthropicRsusRemaining.value.toLocaleString()} @ $${facts.anthropicRsuGrantPrice.value.toFixed(2)} grant price ` +
      `[updated ${isoDate(facts.anthropicRsusRemaining.updatedAt)}]`,
    );
  } else {
    if (facts.anthropicRsusRemaining) {
      lines.push(`  - Anthropic RSUs: ${facts.anthropicRsusRemaining.value.toLocaleString()} [updated ${isoDate(facts.anthropicRsusRemaining.updatedAt)}]`);
    }
    if (facts.anthropicRsuGrantPrice) {
      lines.push(`  - Anthropic RSU Grant Price: $${facts.anthropicRsuGrantPrice.value.toFixed(2)} [updated ${isoDate(facts.anthropicRsuGrantPrice.updatedAt)}]`);
    }
  }
  lines.push('  - Quarterly vesting over 4 years; base salary contributes to investment capital');
  lines.push('');

  // Real estate
  lines.push('REAL ESTATE:');
  lines.push(`  - Miami Shores property: ${fmtNumber(facts.miamiShoresPropertyValue, usd)} value`);
  lines.push('');

  // Trajectory table
  if (facts.revenueTrajectoryTable && facts.revenueTrajectoryTable.value.length > 0) {
    lines.push(`$50M TRAJECTORY [updated ${isoDate(facts.revenueTrajectoryTable.updatedAt)}]:`);
    lines.push('| Year | Annual Rev  | Cumulative  | Phase              |');
    lines.push('|------|-------------|-------------|--------------------|');
    for (const row of facts.revenueTrajectoryTable.value) {
      const annual = usd(row.annual).padEnd(11);
      const cum = usd(row.cumulative).padEnd(11);
      const phase = row.phase.padEnd(18);
      lines.push(`| ${row.year} | ${annual} | ${cum} | ${phase} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
