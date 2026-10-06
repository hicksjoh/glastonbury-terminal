/**
 * Portfolio facts shared by every briefing prompt (on-demand and the daily
 * cron). Both routes used to carry their own literal "Static Holdings" line
 * and an unlabelled Alpaca block, so the model quoted a stale CR3 value and
 * told the owner to deploy a paper account's simulated cash
 * (QA 2026-10-05, blocker 6). One source so they cannot drift again.
 */
import { createServiceClient } from '@/lib/supabase';
import { getServerTradingMode } from '@/lib/trading-mode';

/** Heading for the brokerage block. A paper balance is simulated money. */
export function brokerageAccountLabel(): string {
  return getServerTradingMode() === 'live'
    ? 'Alpaca Account'
    : 'Alpaca PAPER Account (SIMULATED funds — not real money, not part of net worth; never describe it as idle or deployable cash)';
}

/** The same wealth_assets rows /wealth renders, or an explicit "unavailable". */
export async function recordedHoldingsContext(): Promise<string> {
  try {
    const { data: assets, error } = await createServiceClient()
      .from('wealth_assets')
      .select('name, asset_class, current_value, last_updated');
    if (error) throw error;
    if (!assets || assets.length === 0) return 'Recorded holdings: none on file — do not quote holding values';
    return `Recorded Holdings (manually valued):\n${assets
      .map((a) => `  - ${a.name}: $${Number(a.current_value).toLocaleString()} (valued ${String(a.last_updated).slice(0, 10)})`)
      .join('\n')}`;
  } catch {
    return 'Recorded holdings: unavailable — do not quote holding values';
  }
}
