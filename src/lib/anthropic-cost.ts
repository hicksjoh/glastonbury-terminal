// Anthropic spend instrumentation.
//
// Codex audit + p4-2 SLO finding: Sentry alert rule #4 ("Anthropic budget
// burn") needs `anthropic_cost_usd` emitted on every Anthropic call so
// Sentry can aggregate spend over time and alert on burst spending.
// Without instrumentation a runaway loop (or compromised API key) burns
// money silently until the monthly Anthropic invoice arrives.
//
// Architecture:
//   - computeAnthropicCostUsd(usage, model) — pure pricing math
//   - tagAnthropicCall(usage, model) — best-effort Sentry attach + log
//
// Pricing tables are best-known list rates. Anthropic occasionally adjusts
// pricing; the alert is meant to catch order-of-magnitude burns, not
// CFO-grade accounting. Update PRICING when Anthropic announces changes.
//
// Streaming caveat: messages.stream emits usage in the final SSE event,
// not on the initial response. Callers using stream must call this from
// the stream's `finalMessage` / message_stop handler, not eagerly.

import * as Sentry from '@sentry/nextjs';
import { log } from './logger';

interface ModelPricing {
  input_per_mtok: number;
  output_per_mtok: number;
}

// USD per 1,000,000 tokens. List rates as of 2026-10.
const PRICING: Record<string, ModelPricing> = {
  // Fable tier
  'claude-fable-5-1': { input_per_mtok: 10, output_per_mtok: 50 },
  'claude-fable-5': { input_per_mtok: 10, output_per_mtok: 50 },
  // Opus family
  'claude-opus-5-5': { input_per_mtok: 4, output_per_mtok: 20 },
  'claude-opus-5': { input_per_mtok: 5, output_per_mtok: 25 },
  'claude-opus-4-8': { input_per_mtok: 5, output_per_mtok: 25 },
  'claude-opus-4-7': { input_per_mtok: 5, output_per_mtok: 25 },
  'claude-opus-4-6': { input_per_mtok: 5, output_per_mtok: 25 },
  // Sonnet family
  'claude-sonnet-5-5': { input_per_mtok: 2, output_per_mtok: 10 },
  'claude-sonnet-5': { input_per_mtok: 2, output_per_mtok: 10 },
  'claude-sonnet-4-6': { input_per_mtok: 3, output_per_mtok: 15 },
  'claude-sonnet-4-5': { input_per_mtok: 3, output_per_mtok: 15 },
  // Haiku family
  'claude-haiku-4-5': { input_per_mtok: 1, output_per_mtok: 5 },
};

export interface AnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

// An unknown model must not price at $0 — that blinds the budget-burn
// alert exactly when a new (usually pricier) model ships. Unknown ids
// price at the most expensive known rate so the alert errs loud.
const UNKNOWN_MODEL_PRICING: ModelPricing = { input_per_mtok: 10, output_per_mtok: 50 };

export function modelPricing(model: string): ModelPricing {
  // Tolerate dated snapshots ("claude-haiku-4-5-20251001") and "[1m]" tags.
  const id = model.replace(/\[1m\]$/, '').replace(/-\d{8}$/, '');
  const p = PRICING[id];
  if (p) return p;
  log.warn({ model }, 'anthropic-cost: unknown model, pricing at top rate — update PRICING table');
  return UNKNOWN_MODEL_PRICING;
}

/**
 * Compute the USD cost of a single Anthropic message call.
 * Cache writes are billed at 1.25× input price; cache reads at 0.1×.
 * Unknown models price at the top known rate (see modelPricing).
 */
export function computeAnthropicCostUsd(usage: AnthropicUsage, model: string): number {
  const p = modelPricing(model);
  const M = 1_000_000;
  const input = (usage.input_tokens ?? 0) * p.input_per_mtok;
  const cacheWrite = (usage.cache_creation_input_tokens ?? 0) * p.input_per_mtok * 1.25;
  const cacheRead = (usage.cache_read_input_tokens ?? 0) * p.input_per_mtok * 0.1;
  const output = (usage.output_tokens ?? 0) * p.output_per_mtok;
  return (input + cacheWrite + cacheRead + output) / M;
}

function costBucket(cost: number): string {
  if (cost < 0.01) return '<1c';
  if (cost < 0.10) return '1-10c';
  if (cost < 1) return '10c-1usd';
  if (cost < 10) return '1-10usd';
  return '10usd+';
}

/**
 * Tag the current Sentry scope with cost telemetry and emit a structured
 * log line for Logtail-side aggregation alerts. Returns the computed cost
 * so callers can do their own accounting if needed.
 *
 * Best-effort — never throws. Sentry-off / instrumentation-off both
 * degrade to "just log."
 *
 * Tag breakdown:
 *   anthropic_model           — exact model string used
 *   anthropic_cost_bucket     — coarse cost band for quick filtering
 *   measurement.anthropic_cost_usd — exact spend, aggregable in alerts
 *   extras: input/output/cache token counts for forensics
 */
export function tagAnthropicCall(
  usage: AnthropicUsage,
  model: string,
  extra: Record<string, unknown> = {},
): number {
  const cost = computeAnthropicCostUsd(usage, model);

  // Structured log line — Logtail/Datadog/Axiom can aggregate this even
  // if Sentry sampling drops the transaction. Belt-and-suspenders for the
  // SLO alert.
  log.info(
    {
      anthropic_model: model,
      anthropic_cost_usd: cost,
      anthropic_cost_bucket: costBucket(cost),
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_read_tokens: usage.cache_read_input_tokens ?? 0,
      cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
      ...extra,
    },
    'anthropic call',
  );

  try {
    // setTag/setExtra apply to the current scope (Sentry's Next.js integration
    // creates one per request). The cost is emitted as both an extra (numeric,
    // queryable in Sentry's discover) and a coarse-bucket tag (cardinality-safe).
    // Sentry v10 moved setMeasurement off the scope object; we don't need it
    // for alerting because alert rules can query on the numeric extra directly.
    Sentry.withScope(scope => {
      scope.setTag('anthropic_model', model);
      scope.setTag('anthropic_cost_bucket', costBucket(cost));
      scope.setExtra('anthropic_cost_usd', cost);
      scope.setExtra('anthropic_input_tokens', usage.input_tokens ?? 0);
      scope.setExtra('anthropic_output_tokens', usage.output_tokens ?? 0);
      scope.setExtra('anthropic_cache_read_tokens', usage.cache_read_input_tokens ?? 0);
      scope.setExtra('anthropic_cache_write_tokens', usage.cache_creation_input_tokens ?? 0);
    });
  } catch {
    // Sentry not initialized → no-op. The log line above still fired.
  }

  return cost;
}
