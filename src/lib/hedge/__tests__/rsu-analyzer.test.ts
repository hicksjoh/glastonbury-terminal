/**
 * RSU concentration hedge analyzer.
 *
 * This module hedges Wes's actual Anthropic equity, and it had a
 * structural problem worth more than any rounding bug: the concentration
 * percentages and the risk level were produced by CLAUDE, not by code.
 * The system prompt asked the model to fill in rsuPctOfLiquid,
 * rsuPctOfTotal and riskLevel, and whatever it returned was spread
 * straight into the API response. Arithmetic a human acts on must not be
 * generated text — it is now computed deterministically and overrides
 * whatever the model said.
 *
 * The parse path was also unguarded: `{...parsed}` on a truncated
 * response (max_tokens is 1500) yields an object with no `concentration`
 * at all, and the client reads `.rsuPctOfLiquid` off undefined.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const anthropicMock = vi.hoisted(() => ({
  anthropic: { messages: { create: vi.fn() } },
  CLAUDE_MODEL_PRIMARY: 'test-model',
}));
const supabaseMock = vi.hoisted(() => ({ createServiceClient: vi.fn() }));
const fmpMock = vi.hoisted(() => ({ getQuote: vi.fn() }));

vi.mock('@/lib/claude', () => anthropicMock);
vi.mock('@/lib/supabase', () => supabaseMock);
vi.mock('@/lib/fmp-client', () => fmpMock);
vi.mock('@/lib/anthropic-cost', () => ({ tagAnthropicCall: vi.fn() }));
vi.mock('@/lib/prompts', () => ({ cachedSystem: (s: string) => s }));

import { computeConcentration, loadWealthSnapshot, analyzeRsuHedge } from '../rsu-analyzer';

function mockWealthRows(rows: Array<{ asset_class: string; name: string | null; current_value: number }>) {
  supabaseMock.createServiceClient.mockReturnValue({
    from: () => ({ select: () => Promise.resolve({ data: rows, error: null }) }),
  });
}

function claudeReturns(text: string) {
  anthropicMock.anthropic.messages.create.mockResolvedValue({
    content: [{ type: 'text', text }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

const NARRATIVE = {
  concentration: { rsuValue: 1, liquidNetWorth: 1, rsuPctOfLiquid: 1, rsuPctOfTotal: 1, riskLevel: 'low' },
  bullCase: { headline: 'ride it', points: ['a', 'b'] },
  bearCase: { headline: 'hedge it', points: ['c', 'd'] },
  synthesis: {
    verdict: 'partial-hedge', rationale: 'because', reEvalTrigger: 'if x',
    actions: [{ instrument: 'XLK', notionalUSD: 100000, tradeShape: 'buy puts', rationale: 'beta' }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  fmpMock.getQuote.mockResolvedValue({ price: 100, changePercentage: 1.5 });
});

// ---------------------------------------------------------------------------

describe('computeConcentration — deterministic arithmetic', () => {
  const wealth = { rsu: 1_490_000, brokerage: 300_000, cash: 200_000, realEstate: 900_000, franchise: 430_000, total: 3_320_000 };

  it('computes liquid net worth as RSU + brokerage + cash', () => {
    expect(computeConcentration(wealth).liquidNetWorth).toBe(1_990_000);
  });

  it('computes the two percentages exactly', () => {
    const c = computeConcentration(wealth);
    expect(c.rsuPctOfLiquid).toBeCloseTo((1_490_000 / 1_990_000) * 100, 6);
    expect(c.rsuPctOfTotal).toBeCloseTo((1_490_000 / 3_320_000) * 100, 6);
  });

  it('reports rsuValue verbatim', () => {
    expect(computeConcentration(wealth).rsuValue).toBe(1_490_000);
  });

  it('bands the risk level on percentage of LIQUID net worth', () => {
    const at = (rsu: number, otherLiquid: number) => computeConcentration({
      rsu, brokerage: otherLiquid, cash: 0, realEstate: 0, franchise: 0, total: rsu + otherLiquid,
    }).riskLevel;
    expect(at(5, 95)).toBe('low');        // 5%
    expect(at(10, 90)).toBe('moderate');  // 10%
    expect(at(25, 75)).toBe('high');      // 25%
    expect(at(50, 50)).toBe('extreme');   // 50%
    expect(at(70, 30)).toBe('extreme');   // Wes's actual position
  });

  it('never divides by zero', () => {
    const zero = computeConcentration({ rsu: 0, brokerage: 0, cash: 0, realEstate: 0, franchise: 0, total: 0 });
    expect(zero.rsuPctOfLiquid).toBe(0);
    expect(zero.rsuPctOfTotal).toBe(0);
    expect(zero.riskLevel).toBe('low');
  });

  it('never emits a non-finite number for malformed wealth', () => {
    const bad = computeConcentration({
      rsu: Number.NaN, brokerage: Number.POSITIVE_INFINITY, cash: 0,
      realEstate: 0, franchise: 0, total: Number.NaN,
    });
    for (const [k, v] of Object.entries(bad)) {
      if (typeof v === 'number') expect(Number.isFinite(v), k).toBe(true);
    }
  });

  it('caps the percentages at 100 even if the RSU exceeds the recorded total', () => {
    const c = computeConcentration({ rsu: 200, brokerage: 0, cash: 0, realEstate: 0, franchise: 0, total: 100 });
    expect(c.rsuPctOfTotal).toBeLessThanOrEqual(100);
    expect(c.rsuPctOfLiquid).toBeLessThanOrEqual(100);
  });
});

describe('loadWealthSnapshot', () => {
  it('sums by asset class and totals them', async () => {
    mockWealthRows([
      { asset_class: 'rsu', name: 'Anthropic', current_value: 1_000_000 },
      { asset_class: 'rsu', name: 'Anthropic 2', current_value: 490_000 },
      { asset_class: 'brokerage', name: null, current_value: 300_000 },
      { asset_class: 'cash', name: null, current_value: 200_000 },
      { asset_class: 'real_estate', name: 'Miami', current_value: 900_000 },
      { asset_class: 'franchise', name: 'CR3', current_value: 430_000 },
    ]);
    const w = await loadWealthSnapshot();
    expect(w.rsu).toBe(1_490_000);
    expect(w.brokerage).toBe(300_000);
    expect(w.realEstate).toBe(900_000);
    expect(w.total).toBe(3_320_000);
  });

  it('returns zeros for an empty table without NaN', async () => {
    mockWealthRows([]);
    const w = await loadWealthSnapshot();
    for (const [k, v] of Object.entries(w)) expect(Number.isFinite(v), k).toBe(true);
    expect(w.total).toBe(0);
  });

  it('ignores rows whose value is not a number', async () => {
    mockWealthRows([
      { asset_class: 'rsu', name: null, current_value: 1_000_000 },
      { asset_class: 'cash', name: null, current_value: 'oops' as unknown as number },
    ]);
    const w = await loadWealthSnapshot();
    expect(Number.isFinite(w.cash)).toBe(true);
    expect(w.total).toBe(1_000_000);
  });
});

describe('analyzeRsuHedge — the model writes the argument, not the arithmetic', () => {
  beforeEach(() => {
    mockWealthRows([
      { asset_class: 'rsu', name: null, current_value: 1_490_000 },
      { asset_class: 'brokerage', name: null, current_value: 300_000 },
      { asset_class: 'cash', name: null, current_value: 200_000 },
      { asset_class: 'real_estate', name: null, current_value: 900_000 },
      { asset_class: 'franchise', name: null, current_value: 430_000 },
    ]);
  });

  it('OVERRIDES the model concentration with the computed one', async () => {
    claudeReturns(JSON.stringify({
      ...NARRATIVE,
      concentration: { rsuValue: 42, liquidNetWorth: 42, rsuPctOfLiquid: 3, rsuPctOfTotal: 2, riskLevel: 'low' },
    }));
    const r = await analyzeRsuHedge();
    expect(r).not.toBeNull();
    expect(r!.concentration.rsuValue).toBe(1_490_000);
    expect(r!.concentration.liquidNetWorth).toBe(1_990_000);
    expect(r!.concentration.rsuPctOfLiquid).toBeCloseTo(74.87, 1);
    expect(r!.concentration.riskLevel).toBe('extreme');
  });

  it('keeps the model narrative sections', async () => {
    claudeReturns(JSON.stringify(NARRATIVE));
    const r = await analyzeRsuHedge();
    expect(r!.bullCase.headline).toBe('ride it');
    expect(r!.bearCase.points).toEqual(['c', 'd']);
    expect(r!.synthesis.verdict).toBe('partial-hedge');
    expect(r!.synthesis.actions[0].instrument).toBe('XLK');
  });

  it('tolerates a fenced code block around the JSON', async () => {
    claudeReturns('```json\n' + JSON.stringify(NARRATIVE) + '\n```');
    const r = await analyzeRsuHedge();
    expect(r).not.toBeNull();
    expect(r!.synthesis.verdict).toBe('partial-hedge');
  });

  it('returns null for unparseable output', async () => {
    claudeReturns('I think you should probably hedge, honestly.');
    expect(await analyzeRsuHedge()).toBeNull();
  });

  it('returns null when the response is truncated mid-JSON', async () => {
    claudeReturns('{"concentration": {"rsuValue": 149');
    expect(await analyzeRsuHedge()).toBeNull();
  });

  it('returns null when the narrative sections are missing', async () => {
    // `{...parsed}` on this used to produce an object with no bullCase,
    // and the client read `.headline` off undefined.
    claudeReturns(JSON.stringify({ concentration: { rsuValue: 1 } }));
    expect(await analyzeRsuHedge()).toBeNull();
  });

  it('returns null for an out-of-contract verdict', async () => {
    claudeReturns(JSON.stringify({
      ...NARRATIVE, synthesis: { ...NARRATIVE.synthesis, verdict: 'maybe-hedge' },
    }));
    expect(await analyzeRsuHedge()).toBeNull();
  });

  it('drops an action whose notional is not a number rather than emitting NaN', async () => {
    claudeReturns(JSON.stringify({
      ...NARRATIVE,
      synthesis: {
        ...NARRATIVE.synthesis,
        actions: [
          { instrument: 'XLK', notionalUSD: 'a lot', tradeShape: 's', rationale: 'r' },
          { instrument: 'QQQ', notionalUSD: 50000, tradeShape: 's', rationale: 'r' },
        ],
      },
    }));
    const r = await analyzeRsuHedge();
    expect(r!.synthesis.actions).toHaveLength(1);
    expect(r!.synthesis.actions[0].instrument).toBe('QQQ');
  });

  it('emits no non-finite number anywhere in the result', async () => {
    claudeReturns(JSON.stringify(NARRATIVE));
    const r = await analyzeRsuHedge();
    const walk = (v: unknown): void => {
      if (typeof v === 'number') { expect(Number.isFinite(v)).toBe(true); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(r);
  });

  it('returns null when there are no RSUs to hedge', async () => {
    mockWealthRows([{ asset_class: 'cash', name: null, current_value: 100 }]);
    claudeReturns(JSON.stringify(NARRATIVE));
    expect(await analyzeRsuHedge()).toBeNull();
    expect(anthropicMock.anthropic.messages.create).not.toHaveBeenCalled();
  });

  it('returns null with no API key and never calls the model', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await analyzeRsuHedge()).toBeNull();
    expect(anthropicMock.anthropic.messages.create).not.toHaveBeenCalled();
  });

  it('still returns an analysis when the proxy quotes fail', async () => {
    fmpMock.getQuote.mockRejectedValue(new Error('FMP down'));
    claudeReturns(JSON.stringify(NARRATIVE));
    const r = await analyzeRsuHedge();
    expect(r).not.toBeNull();
    expect(r!.proxyQuotes).toEqual([]);
  });
});
