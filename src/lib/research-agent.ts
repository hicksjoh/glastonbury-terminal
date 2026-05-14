/**
 * Phase 5 — Deep Research Agent.
 * Claude Opus 4.7 runs a tool-use loop to gather sources, then produces
 * a 1500-2500 word buy-side memo with inline citations.
 *
 * Tools exposed:
 *   - web_search (Anthropic server tool)
 *   - ticker_snapshot (quote + profile)
 *   - recent_filings (SEC filings via FMP)
 *   - company_news (72h via Finnhub)
 *   - peer_comps (FMP peer list + key ratios)
 *
 * Budgets are env-configurable and enforced on every tool-loop iteration:
 *   - Wall clock (seconds)
 *   - Total cost USD
 *   - Output tokens
 */

import type { MessageParam, Tool, TextBlockParam, ToolUseBlockParam, ToolResultBlockParam, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages';
import {
  anthropic,
  CLAUDE_MODEL_PRIMARY,
  CLAUDE_MODEL_FALLBACK,
  NON_STREAM_TIMEOUT_MS,
} from '@/lib/claude';
import { tagAnthropicCall } from '@/lib/anthropic-cost';
import {
  fetchQuote,
  fetchCompanyProfile,
  fetchRecentFilings,
  fetchRecentNews,
} from '@/lib/crew-data';

// ── Cost table ──────────────────────────────────────────────────────────────
const PRICE_PER_M: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
};

function costUsd(model: string, tIn: number, tOut: number): number {
  const p = PRICE_PER_M[model] ?? { input: 3.0, output: 15.0 };
  return (tIn / 1_000_000) * p.input + (tOut / 1_000_000) * p.output;
}

// ── Tool definitions (sent to Claude) ───────────────────────────────────────
// Anthropic's web_search is a server-side tool — we declare but don't execute it.
// Our custom tools we execute locally.
const CUSTOM_TOOLS: Tool[] = [
  {
    name: 'ticker_snapshot',
    description: 'Get a quick fundamental snapshot for a ticker: latest price, day change, company name, industry, market cap, P/E ratio, short description.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol (e.g. "AAPL")' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'recent_filings',
    description: 'List the most recent SEC filings (10-K, 10-Q, 8-K, etc.) for a ticker with filed dates and links to the original SEC documents.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol' },
        limit: { type: 'number', description: 'Number of filings to return (1-20, default 8)' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'company_news',
    description: 'Get the last 72 hours of company-specific news headlines with sources and summaries.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol' },
        hours: { type: 'number', description: 'Look-back window in hours (24-168, default 72)' },
      },
      required: ['ticker'],
    },
  },
];

// Anthropic server tools — declared as part of the tools array with a "type".
type ServerToolDecl = { type: string; name: string; max_uses?: number };
const WEB_SEARCH_TOOL: ServerToolDecl = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 12,
};

// ── Tool execution ──────────────────────────────────────────────────────────
async function executeCustomTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    if (name === 'ticker_snapshot') {
      const ticker = String(input.ticker ?? '').toUpperCase();
      if (!ticker) return 'Error: ticker required';
      const [quote, profile] = await Promise.all([fetchQuote(ticker), fetchCompanyProfile(ticker)]);
      if (!quote && !profile) return `No data found for ${ticker}`;
      return JSON.stringify({ ticker, quote, profile }, null, 2);
    }
    if (name === 'recent_filings') {
      const ticker = String(input.ticker ?? '').toUpperCase();
      const limit = Math.max(1, Math.min(20, Number(input.limit ?? 8)));
      if (!ticker) return 'Error: ticker required';
      const filings = await fetchRecentFilings(ticker, limit);
      return JSON.stringify({ ticker, count: filings.length, filings }, null, 2);
    }
    if (name === 'company_news') {
      const ticker = String(input.ticker ?? '').toUpperCase();
      const hours = Math.max(24, Math.min(168, Number(input.hours ?? 72)));
      if (!ticker) return 'Error: ticker required';
      const news = await fetchRecentNews(ticker, hours, 15);
      return JSON.stringify({ ticker, hours, count: news.length, news }, null, 2);
    }
    return `Error: unknown tool "${name}"`;
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

// ── System prompt ───────────────────────────────────────────────────────────
export const RESEARCH_SYSTEM_PROMPT = `You are a buy-side equity research analyst writing for a sophisticated portfolio manager. Your final memo MUST be 1500-2500 words and cover, in this order:

1. **Thesis** — one-paragraph summary of your call.
2. **Bull case** — the 3-5 strongest arguments for the stock.
3. **Bear case** — the 3-5 strongest arguments against.
4. **90-day catalysts** — upcoming earnings, product launches, macro events, filings.
5. **Financial health** — revenue/margin/FCF trajectory, balance sheet, leverage. Use real numbers from filings.
6. **Valuation vs peers** — key multiples (P/E, EV/EBITDA, P/S, FCF yield) vs 3-5 named peers.
7. **Options positioning** — skew, OI trends, notable flow if available.
8. **Sentiment** — what the news and market narrative say.
9. **Risks** — specific, not generic.
10. **Recommendation** — explicit position sizing, time horizon, entry trigger, invalidation level.

Rules:
- Use tools liberally. You have web_search (max 12 uses), ticker_snapshot, recent_filings, and company_news.
- Cite every concrete claim inline with either an SEC filing form + date, a news source + date, or a web search URL. Minimum 8 distinct sources.
- Be direct. No filler. No corporate hedging. If the data is thin, say so.
- Write in Markdown. Use ## for section headers, tables where helpful.
- Your LAST assistant message must be ONLY the final memo markdown — no preamble, no tool calls.`;

// ── Runtime types ───────────────────────────────────────────────────────────
export type AgentEvent =
  | { type: 'status'; phase: 'thinking' | 'searching' | 'tool_call' | 'writing_memo' | 'done'; detail?: string }
  | { type: 'tool_use'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; ok: boolean; preview?: string }
  | { type: 'text'; delta: string }
  | { type: 'usage'; cumTokensIn: number; cumTokensOut: number; cumCostUsd: number; iterations: number }
  | { type: 'error'; message: string };

export type AgentResult = {
  memo_markdown: string;
  sources_cited: string[];
  iterations: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_usd: number;
  total_runtime_seconds: number;
  truncated_reason: 'completed' | 'wall_clock' | 'token_budget' | 'cost_budget' | 'iteration_cap' | 'error';
};

// ── Source extraction from memo ────────────────────────────────────────────
function extractSources(memo: string): string[] {
  const sources = new Set<string>();
  const collect = (re: RegExp, transform: (m: string) => string = s => s) => {
    const matches = Array.from(memo.matchAll(re));
    for (const m of matches) sources.add(transform(m[0]));
  };
  // URLs (highest quality)
  collect(/https?:\/\/[^\s)\]]+/g, s => s.replace(/[,.;:)]+$/, ''));
  // SEC filing references with or without date nearby
  collect(/\b(10-K|10-Q|8-K|DEF 14A|S-1|13F|13D|20-F|424B[0-9]?|Form\s*4|proxy statement)\b(?:[^\n]{0,50}?\b(?:Q[1-4]\s*(?:FY)?20\d\d|20\d\d-\d\d-\d\d|20\d\d))?/gi,
          s => s.trim().replace(/\s+/g, ' '));
  // Named news/data sources
  collect(/\b(Bloomberg|Reuters|CNBC|WSJ|Wall Street Journal|Financial Times|FT|Barron'?s|The Verge|Nikkei|Motley Fool|Seeking Alpha|Yahoo Finance|MarketWatch|Morningstar|Koyfin|FactSet|IDC|Gartner|Canalys|Counterpoint|Strategy Analytics)\b[^\n]{0,40}?(?:20\d\d|Q[1-4])?/gi,
          s => s.trim().replace(/\s+/g, ' '));
  // Inline source/citation tags
  collect(/\[(?:source|src|via|ref)[:\s][^\]]{3,80}\]/gi);
  collect(/\(source:\s*[^)]{3,80}\)/gi);
  // Company earnings call mentions
  collect(/\b(earnings call|conference call|analyst day|investor day)\b[^\n]{0,30}?\b(Q[1-4]\s*(?:FY)?20\d\d)\b/gi,
          s => s.trim().replace(/\s+/g, ' '));
  return Array.from(sources).slice(0, 60);
}

// ── Agent loop ──────────────────────────────────────────────────────────────
export async function runResearchAgent(
  args: {
    topic: string;
    ticker?: string;
    prompt: string;
    budgetSeconds: number;
    budgetCostUsd: number;
    budgetOutputTokens: number;
    iterationCap?: number;
    onEvent?: (e: AgentEvent) => void;
  },
): Promise<AgentResult> {
  const start = Date.now();
  const onEvent = args.onEvent ?? (() => {});
  const iterationCap = args.iterationCap ?? 18;

  const tools = [...CUSTOM_TOOLS, WEB_SEARCH_TOOL] as unknown as Tool[];

  const userOpeningMessage = `Topic: ${args.topic}
${args.ticker ? `Ticker: ${args.ticker}` : ''}

Prompt from Wes:
${args.prompt}

Use your tools to gather data, then deliver the final memo as your last message. Minimum 8 distinct sources. Target 1500-2500 words.`;

  const conversation: MessageParam[] = [
    { role: 'user', content: userOpeningMessage },
  ];

  let cumIn = 0;
  let cumOut = 0;
  let iterations = 0;
  let truncated: AgentResult['truncated_reason'] = 'completed';
  let finalText = '';
  let modelUsed = CLAUDE_MODEL_PRIMARY;

  for (iterations = 0; iterations < iterationCap; iterations++) {
    // ── Budget check ────────────────────────────────────────────────────
    const elapsedSec = (Date.now() - start) / 1000;
    if (elapsedSec > args.budgetSeconds) { truncated = 'wall_clock'; break; }
    const cost = costUsd(modelUsed, cumIn, cumOut);
    if (cost > args.budgetCostUsd) { truncated = 'cost_budget'; break; }
    if (cumOut > args.budgetOutputTokens) { truncated = 'token_budget'; break; }

    onEvent({ type: 'status', phase: 'thinking', detail: `iteration ${iterations + 1}/${iterationCap}` });

    // ── Call Claude ─────────────────────────────────────────────────────
    let response: Awaited<ReturnType<typeof anthropic.messages.create>>;
    try {
      response = await anthropic.messages.create({
        model: modelUsed,
        max_tokens: 4096,
        system: RESEARCH_SYSTEM_PROMPT,
        tools,
        messages: conversation,
      }, { signal: AbortSignal.timeout(NON_STREAM_TIMEOUT_MS) });
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if ((status === 429 || status === 529 || status === 503) && modelUsed !== CLAUDE_MODEL_FALLBACK) {
        modelUsed = CLAUDE_MODEL_FALLBACK;
        onEvent({ type: 'status', phase: 'thinking', detail: `switched to fallback ${modelUsed}` });
        iterations -= 1; // retry this iteration with fallback model
        continue;
      }
      truncated = 'error';
      onEvent({ type: 'error', message: (err as Error).message });
      break;
    }
    tagAnthropicCall(response.usage, modelUsed, { caller: 'research-agent' });

    cumIn += response.usage?.input_tokens ?? 0;
    cumOut += response.usage?.output_tokens ?? 0;
    onEvent({
      type: 'usage',
      cumTokensIn: cumIn,
      cumTokensOut: cumOut,
      cumCostUsd: costUsd(modelUsed, cumIn, cumOut),
      iterations: iterations + 1,
    });

    // ── Process content blocks ──────────────────────────────────────────
    const toolUseBlocks = response.content.filter(
      (b): b is ToolUseBlockParam => b.type === 'tool_use',
    );
    const textBlocks = response.content.filter(
      (b): b is TextBlockParam => b.type === 'text',
    );

    // Accumulate text from this turn into the running finalText.
    if (textBlocks.length > 0) {
      const turnText = textBlocks.map(b => b.text).join('\n\n');
      finalText = finalText ? `${finalText}\n\n${turnText}` : turnText;
    }

    // Clean end — Claude said it's done, no tools pending.
    if (response.stop_reason === 'end_turn' && toolUseBlocks.length === 0) {
      onEvent({ type: 'text', delta: '' });
      onEvent({ type: 'status', phase: 'done', detail: 'agent finished' });
      break;
    }

    // Append assistant message to the running conversation.
    conversation.push({
      role: 'assistant',
      content: response.content as (TextBlockParam | ImageBlockParam | ToolUseBlockParam)[],
    });

    // Execute our custom tools. web_search runs server-side — its results are
    // inline in the assistant message we just pushed, so we don't produce a
    // tool_result for it.
    const toolResults: ToolResultBlockParam[] = [];
    for (const tu of toolUseBlocks) {
      const name = tu.name;
      const input = (tu.input as Record<string, unknown>) ?? {};

      if (name === 'web_search') {
        onEvent({ type: 'tool_use', tool: 'web_search', input });
        continue;
      }

      onEvent({ type: 'tool_use', tool: name, input });
      onEvent({ type: 'status', phase: 'tool_call', detail: name });
      const output = await executeCustomTool(name, input);
      const ok = !output.startsWith('Error:');
      onEvent({ type: 'tool_result', tool: name, ok, preview: output.slice(0, 200) });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: output,
        is_error: !ok,
      });
    }

    if (toolResults.length > 0) {
      // Normal continuation: custom tool results go back as a user turn.
      conversation.push({ role: 'user', content: toolResults });
      continue;
    }

    // No custom tool_results. Two sub-cases:
    //   (a) Claude hit max_tokens mid-memo — send a "continue" nudge so it finishes.
    //   (b) Claude only used web_search — still need a user turn to proceed;
    //       send a nudge to keep going.
    if (response.stop_reason === 'max_tokens') {
      onEvent({ type: 'status', phase: 'writing_memo', detail: 'continuing truncated memo' });
      conversation.push({
        role: 'user',
        content: 'Continue writing from exactly where you stopped. Do not repeat anything already written.',
      });
      continue;
    }

    if (toolUseBlocks.length > 0) {
      // web_search-only turn. Nudge Claude to proceed.
      conversation.push({
        role: 'user',
        content: 'Continue with your research and memo. Use the web search results you just received.',
      });
      continue;
    }

    // No tools, no usable stop reason — bail.
    if (textBlocks.length === 0) {
      truncated = 'error';
      break;
    }
    // Had text but unknown stop reason — accept what we have and exit.
    break;
  }

  if (iterations >= iterationCap && !finalText) truncated = 'iteration_cap';

  // If agent finished but finalText is empty, grab the last assistant text block.
  if (!finalText) {
    for (let i = conversation.length - 1; i >= 0; i--) {
      const m = conversation[i];
      if (m.role === 'assistant') {
        const content = m.content;
        if (typeof content === 'string') { finalText = content; break; }
        const t = (content as (TextBlockParam | ImageBlockParam | ToolUseBlockParam)[])
          .filter((b): b is TextBlockParam => b.type === 'text')
          .map(b => b.text).join('\n\n');
        if (t) { finalText = t; break; }
      }
    }
  }

  onEvent({ type: 'status', phase: 'done', detail: truncated });

  return {
    memo_markdown: finalText,
    sources_cited: extractSources(finalText),
    iterations,
    total_tokens_in: cumIn,
    total_tokens_out: cumOut,
    total_cost_usd: costUsd(modelUsed, cumIn, cumOut),
    total_runtime_seconds: Math.round((Date.now() - start) / 1000),
    truncated_reason: truncated,
  };
}

export function wordCount(s: string): number {
  if (!s) return 0;
  return s.trim().split(/\s+/).length;
}
