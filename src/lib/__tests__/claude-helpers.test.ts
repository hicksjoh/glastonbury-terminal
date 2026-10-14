// Guards for the helpers every Claude call site leans on. Thinking models
// lead `content` with thinking blocks and spend max_tokens on reasoning;
// both broke call sites silently before these helpers existed.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({}));

import { modelBudget, textOf, LATEST_BY_TIER } from '../claude';
import { computeAnthropicCostUsd, modelPricing } from '../anthropic-cost';

describe('textOf', () => {
  it('skips leading thinking blocks', () => {
    expect(textOf({
      content: [{ type: 'thinking' }, { type: 'text', text: 'Hello ' }, { type: 'text', text: 'Wes.' }],
      stop_reason: 'end_turn',
    })).toBe('Hello Wes.');
  });

  it('returns empty for a refusal, even with partial text', () => {
    expect(textOf({ content: [{ type: 'text', text: 'partial' }], stop_reason: 'refusal' })).toBe('');
  });
});

describe('modelBudget', () => {
  it('adds thinking headroom on models that always think', () => {
    const b = modelBudget(LATEST_BY_TIER.primary, 600, 'low');
    expect(b.max_tokens).toBeGreaterThan(600);
    expect(b.output_config).toEqual({ effort: 'low' });
  });

  it('leaves Haiku and pinned 4.x models untouched (no effort param)', () => {
    expect(modelBudget('claude-haiku-4-5', 512, 'low')).toEqual({ max_tokens: 512 });
    expect(modelBudget('claude-haiku-4-5-20251001', 512)).toEqual({ max_tokens: 512 });
    expect(modelBudget('claude-opus-4-7', 1200)).toEqual({ max_tokens: 1200 });
  });
});

describe('modelPricing', () => {
  it('prices every latest-tier model from the table', () => {
    expect(modelPricing(LATEST_BY_TIER.primary)).toEqual({ input_per_mtok: 10, output_per_mtok: 50 });
    expect(modelPricing(LATEST_BY_TIER.fallback)).toEqual({ input_per_mtok: 2, output_per_mtok: 10 });
    expect(modelPricing(LATEST_BY_TIER.fast)).toEqual({ input_per_mtok: 1, output_per_mtok: 5 });
  });

  it('resolves dated snapshot ids', () => {
    expect(modelPricing('claude-haiku-4-5-20251001')).toEqual(modelPricing('claude-haiku-4-5'));
  });

  it('never prices an unknown model at $0 — the burn alert must stay loud', () => {
    expect(computeAnthropicCostUsd({ input_tokens: 1_000_000 }, 'claude-something-new')).toBeGreaterThan(0);
  });
});
