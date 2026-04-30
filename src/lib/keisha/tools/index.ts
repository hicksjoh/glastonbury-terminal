// Public API for Keisha tools — assembles registry and re-exports the same
// symbols previously exported from @/lib/keisha-tools.
//
// This file is the target shape; keisha-tools.ts is replaced with a re-export
// shim pointing here once all batches are complete.

import type { RenderCard } from '@/types/keisha';
import type { ToolDef } from './registry';

// ─── Batch 1: Lookup tools ───────────────────────────────────────────────────
import { lookupPrice } from './lookup-price';
import { getPosition } from './get-position';
import { portfolioSummary } from './portfolio-summary';
import { addWatchlist } from './add-watchlist';
import { removeWatchlist } from './remove-watchlist';
import { updateWatchlistTarget } from './update-watchlist-target';
import { setAlert } from './set-alert';
import { batchLookup } from './batch-lookup';
import { scanWatchlist } from './scan-watchlist';
import { lookupOptions } from './lookup-options';

// ─── Batch 2: Analysis + memory tools ───────────────────────────────────────
import { checkTradeGuard } from './check-trade-guard';
import { checkGex } from './check-gex';
import { checkInsider } from './check-insider';
import { pinMemory } from './pin-memory';
import { recallMemories } from './recall-memories';
import { deleteMemory } from './delete-memory';
import { getCongressTrades } from './get-congress-trades';
import { getMarketNarrative } from './get-market-narrative';
import { getWeeklyReplaySummary } from './get-weekly-replay-summary';
import { placeOrder } from './place-order';
import { suggestFollowups } from './suggest-followups';

// ─── Batch 3: Tax tools ──────────────────────────────────────────────────────
import { getTaxEstimate } from './tax/get-tax-estimate';
import { checkWashSale } from './tax/check-wash-sale';
import { getHarvestCandidates } from './tax/get-harvest-candidates';
import { compareTaxLots } from './tax/compare-tax-lots';
import { getHoldingPeriods } from './tax/get-holding-periods';
import { calculateSection1256 } from './tax/calculate-section-1256';
import { getTaxSuggestions } from './tax/get-tax-suggestions';
import { exportTaxReport } from './tax/export-tax-report';
import { calculateBusinessDeductions } from './tax/calculate-business-deductions';

// ─── Batch 4: Widget + read tools ───────────────────────────────────────────
import { orderTicket } from './order-ticket';
import { miniChart } from './mini-chart';
import { greeksCalculator } from './greeks-calculator';
import { tradePreview } from './trade-preview';
import { getStormStatus } from './get-storm-status';
import { getTaxHarvestSummary } from './get-tax-harvest-summary';
import { getCoachReview } from './get-coach-review';
import { getRecentCrewRuns } from './get-recent-crew-runs';
import { getEarningsMemo } from './get-earnings-memo';
import { getResearchMemo } from './get-research-memo';
import { getPredictionMarkets } from './get-prediction-markets';
import { semanticSearch } from './semantic-search';

// ─── Registry ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOL_REGISTRY: ToolDef<any>[] = [
  // Batch 1
  lookupPrice,
  getPosition,
  portfolioSummary,
  addWatchlist,
  removeWatchlist,
  updateWatchlistTarget,
  setAlert,
  placeOrder,        // dangerous — agent loop intercepts, never calls execute
  suggestFollowups,  // sentinel — agent loop intercepts
  batchLookup,
  scanWatchlist,
  lookupOptions,
  // Batch 2
  checkTradeGuard,
  checkGex,
  checkInsider,
  pinMemory,
  recallMemories,
  deleteMemory,
  getCongressTrades,
  getMarketNarrative,
  getWeeklyReplaySummary,
  // Batch 3
  getTaxEstimate,
  checkWashSale,
  getHarvestCandidates,
  compareTaxLots,
  getHoldingPeriods,
  calculateSection1256,
  getTaxSuggestions,
  exportTaxReport,
  calculateBusinessDeductions,
  // Batch 4
  orderTicket,
  miniChart,
  greeksCalculator,
  tradePreview,
  getStormStatus,
  getTaxHarvestSummary,
  getCoachReview,
  getRecentCrewRuns,
  getEarningsMemo,
  getResearchMemo,
  getPredictionMarkets,
  semanticSearch,
];

export const KEISHA_TOOLS = TOOL_REGISTRY.map(t => t.toAnthropicTool());

export const DANGEROUS_TOOLS = new Set(
  TOOL_REGISTRY.filter(t => t.dangerous).map(t => t.name),
);

export const MAX_TOOL_ITERATIONS = 6;

export async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
): Promise<{ result: unknown; success: boolean }> {
  const tool = TOOL_REGISTRY.find(t => t.name === name);
  if (!tool) return { result: { error: `Unknown tool: ${name}` }, success: false };
  const parsed = tool.inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      result: { error: `Invalid input: ${parsed.error.message}` },
      success: false,
    };
  }
  // Wrap in try/catch to match the original top-level catch in keisha-tools.ts
  try {
    return await tool.execute(parsed.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Tool execution failed';
    console.error(`Tool ${name} error:`, msg);
    return { result: { error: msg }, success: false };
  }
}

export function buildRenderCard(
  name: string,
  input: Record<string, unknown>,
  result: unknown,
  success: boolean,
): RenderCard | null {
  const tool = TOOL_REGISTRY.find(t => t.name === name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tool?.buildRenderCard?.(input as any, result, success) as RenderCard | null) ?? null;
}
