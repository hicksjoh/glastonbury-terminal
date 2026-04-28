import { NextRequest } from 'next/server';
import {
  anthropic,
  CLAUDE_MODEL_PRIMARY,
  CLAUDE_MODEL_FALLBACK,
} from '@/lib/claude';
import { createServiceClient } from '@/lib/supabase';
import { checkRateLimitDurable } from '@/lib/rate-limit-durable';
import {
  fetchBars,
  fetchQuote,
  fetchCompanyProfile,
  fetchRecentFilings,
  fetchOptionsSnapshot,
  fetchRecentNews,
  computeIndicators,
  type Indicators,
  type Filing,
  type OptionsSnapshot,
  type NewsItem,
  type Quote,
  type CompanyProfile,
} from '@/lib/crew-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type SpecialistName = 'fundamentals' | 'technicals' | 'options_flow' | 'sentiment';

type SpecialistOutput = {
  thesis: string;
  confidence: number;              // 0-100
  stance: 'bullish' | 'bearish' | 'neutral';
  key_points: string[];
  citations: string[];
};

type JudgeOutput = {
  verdict: 'BULL' | 'BEAR' | 'NEUTRAL' | 'PASS';
  confidence: number;              // 0-100
  rationale: string;
  scores: Record<SpecialistName, number>; // 1-10
  suggested_trade: {
    structure: string;             // e.g. "Long 100 SPY at $498"
    entry: string;
    target: string;
    stop: string;
    thesis: string;
    timeframe: string;
  } | null;
};

const PRICE_PER_M: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
};
const costOf = (model: string, tIn: number, tOut: number) => {
  const p = PRICE_PER_M[model] ?? { input: 3.0, output: 15.0 };
  return (tIn / 1_000_000) * p.input + (tOut / 1_000_000) * p.output;
};

const sseEncode = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

// ── Shared data bundle ───────────────────────────────────────────────────────
type DataBundle = {
  ticker: string;
  quote: Quote | null;
  profile: CompanyProfile | null;
  bars_count: number;
  indicators: Indicators | null;
  filings: Filing[];
  options: OptionsSnapshot | null;
  news: NewsItem[];
};

async function gatherData(ticker: string): Promise<DataBundle> {
  const [bars, quote, profile, filings, options, news] = await Promise.all([
    fetchBars(ticker, '1Day', 260),
    fetchQuote(ticker),
    fetchCompanyProfile(ticker),
    fetchRecentFilings(ticker, 5),
    fetchOptionsSnapshot(ticker),
    fetchRecentNews(ticker, 72, 15),
  ]);
  return {
    ticker,
    quote,
    profile,
    bars_count: bars.length,
    indicators: bars.length > 10 ? computeIndicators(bars) : null,
    filings,
    options,
    news,
  };
}

// ── Specialist prompts ───────────────────────────────────────────────────────
const SPECIALIST_SYSTEM: Record<SpecialistName, string> = {
  fundamentals: `You are the FUNDAMENTALS specialist on Wes Hicks' trading crew.
You analyze 10-K/10-Q/8-K filings, earnings transcripts, company profile, and valuation multiples.
Return a tight, number-dense take. You MUST cite at least one concrete number, filing type, or financial metric from the provided data. If data is missing, say so and work from what IS available. Never fabricate numbers.`,
  technicals: `You are the TECHNICALS specialist on Wes Hicks' trading crew.
You analyze price action: moving averages (20/50/200), RSI(14), MACD, support/resistance levels, volatility, and 1d/5d/20d changes.
Return a tight, number-dense take. You MUST cite at least one concrete indicator value or price level. Never fabricate numbers.`,
  options_flow: `You are the OPTIONS FLOW specialist on Wes Hicks' trading crew.
You analyze options open interest, put/call ratios, top strikes by OI, implied volatility, and any unusual activity.
Return a tight, number-dense take. You MUST cite at least one concrete strike, OI number, or P/C ratio when data is available. If options data is unavailable, say so plainly. Never fabricate numbers.`,
  sentiment: `You are the NEWS & SENTIMENT specialist on Wes Hicks' trading crew.
You analyze the last 72 hours of company news — sources, headlines, summaries — for shifts in narrative.
Return a tight, number-dense take. You MUST cite at least one specific headline and source from the provided news. If no news is available, say so. Never fabricate headlines.`,
};

function userPromptForSpecialist(name: SpecialistName, data: DataBundle): string {
  const slice: Record<string, unknown> = {
    ticker: data.ticker,
    quote: data.quote,
    profile: data.profile,
  };
  if (name === 'fundamentals') {
    slice.profile_full = data.profile;
    slice.recent_filings = data.filings;
  } else if (name === 'technicals') {
    slice.indicators = data.indicators;
    slice.bars_count = data.bars_count;
  } else if (name === 'options_flow') {
    slice.options = data.options;
  } else if (name === 'sentiment') {
    slice.news = data.news.slice(0, 10);
  }
  return `Ticker: ${data.ticker}

DATA PACKAGE (JSON):
${JSON.stringify(slice, null, 2)}

Return ONLY a JSON object (no markdown fences) matching this exact TypeScript shape:
{
  "thesis": string,           // 2-4 sentences. Number-dense. No filler.
  "confidence": number,       // 0-100
  "stance": "bullish" | "bearish" | "neutral",
  "key_points": string[],     // 3-5 bullet-style strings
  "citations": string[]       // at least 1 concrete data point, filing, strike, or headline with source
}

If the data is sparse, lower your confidence and say so in the thesis.`;
}

// ── Specialist runner (streams tokens as they arrive) ────────────────────────
type SpecialistResult = {
  name: SpecialistName;
  output: SpecialistOutput;
  raw_text: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
};

async function runSpecialist(
  name: SpecialistName,
  data: DataBundle,
  onToken: (delta: string) => void,
): Promise<SpecialistResult> {
  const t0 = Date.now();
  const system = SPECIALIST_SYSTEM[name];
  const user = userPromptForSpecialist(name, data);

  const callStream = (model: string) =>
    anthropic.messages.stream({
      model,
      max_tokens: 800,
      system,
      messages: [{ role: 'user', content: user }],
    });

  let modelUsed = CLAUDE_MODEL_FALLBACK; // Sonnet for specialists (speed/cost)
  let stream: ReturnType<typeof anthropic.messages.stream>;
  try {
    stream = callStream(modelUsed);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 429 || status === 529 || status === 503) {
      modelUsed = CLAUDE_MODEL_PRIMARY;
      stream = callStream(CLAUDE_MODEL_PRIMARY);
    } else {
      throw err;
    }
  }

  let accumulated = '';
  stream.on('text', (delta: string) => {
    accumulated += delta;
    onToken(delta);
  });

  const finalMsg = await stream.finalMessage();
  const tokensIn = finalMsg.usage?.input_tokens ?? 0;
  const tokensOut = finalMsg.usage?.output_tokens ?? 0;

  const parsed = parseSpecialistJSON(accumulated);

  return {
    name,
    output: parsed,
    raw_text: accumulated,
    model: modelUsed,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    latency_ms: Date.now() - t0,
  };
}

function parseSpecialistJSON(text: string): SpecialistOutput {
  // Tolerate fenced code blocks
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const jsonStr = match ? match[0] : cleaned;
  try {
    const j = JSON.parse(jsonStr);
    return {
      thesis: String(j.thesis ?? '').slice(0, 2000),
      confidence: Math.max(0, Math.min(100, Number(j.confidence) || 0)),
      stance: ['bullish', 'bearish', 'neutral'].includes(j.stance) ? j.stance : 'neutral',
      key_points: Array.isArray(j.key_points) ? j.key_points.slice(0, 6).map(String) : [],
      citations: Array.isArray(j.citations) ? j.citations.slice(0, 6).map(String) : [],
    };
  } catch {
    return {
      thesis: text.slice(0, 1000),
      confidence: 0,
      stance: 'neutral',
      key_points: [],
      citations: [],
    };
  }
}

// ── Judge ────────────────────────────────────────────────────────────────────
const JUDGE_SYSTEM = `You are the JUDGE on Wes Hicks' trading crew — the senior portfolio manager synthesizing input from four specialist analysts.
You score each specialist 1-10 on quality/conviction, issue a final verdict (BULL, BEAR, NEUTRAL, or PASS), and propose a specific trade structure.
Your rationale must be direct, data-driven, and cite specific points from the specialist memos. Be willing to PASS when the signal is weak — false conviction is expensive.`;

function userPromptForJudge(ticker: string, data: DataBundle, specialists: SpecialistResult[]): string {
  return `Ticker: ${ticker}
Current quote: ${JSON.stringify(data.quote)}

SPECIALIST OUTPUTS:
${specialists.map(s => `
--- ${s.name.toUpperCase()} ---
${JSON.stringify(s.output, null, 2)}
`).join('\n')}

Return ONLY a JSON object (no markdown fences) matching this exact shape:
{
  "verdict": "BULL" | "BEAR" | "NEUTRAL" | "PASS",
  "confidence": number,       // 0-100
  "rationale": string,        // 3-6 sentences. Cite specific specialist points. No filler.
  "scores": {
    "fundamentals": number,   // 1-10
    "technicals": number,
    "options_flow": number,
    "sentiment": number
  },
  "suggested_trade": {
    "structure": string,      // e.g. "Long 100 shares", "Bull call spread 500/510 Jan", "Iron condor 480/490/510/520"
    "entry": string,
    "target": string,
    "stop": string,
    "thesis": string,
    "timeframe": string
  } | null  // null when verdict is PASS or NEUTRAL with low conviction
}`;
}

type JudgeResult = {
  output: JudgeOutput;
  raw_text: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
};

async function runJudge(
  ticker: string,
  data: DataBundle,
  specialists: SpecialistResult[],
  onToken: (delta: string) => void,
): Promise<JudgeResult> {
  const t0 = Date.now();
  const callStream = (model: string) =>
    anthropic.messages.stream({
      model,
      max_tokens: 1200,
      system: JUDGE_SYSTEM,
      messages: [{ role: 'user', content: userPromptForJudge(ticker, data, specialists) }],
    });

  let modelUsed = CLAUDE_MODEL_PRIMARY; // Opus for judge
  let stream: ReturnType<typeof anthropic.messages.stream>;
  try {
    stream = callStream(modelUsed);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 429 || status === 529 || status === 503) {
      modelUsed = CLAUDE_MODEL_FALLBACK;
      stream = callStream(CLAUDE_MODEL_FALLBACK);
    } else {
      throw err;
    }
  }

  let accumulated = '';
  stream.on('text', (delta: string) => {
    accumulated += delta;
    onToken(delta);
  });

  const finalMsg = await stream.finalMessage();
  const tokensIn = finalMsg.usage?.input_tokens ?? 0;
  const tokensOut = finalMsg.usage?.output_tokens ?? 0;

  return {
    output: parseJudgeJSON(accumulated),
    raw_text: accumulated,
    model: modelUsed,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    latency_ms: Date.now() - t0,
  };
}

function parseJudgeJSON(text: string): JudgeOutput {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const jsonStr = match ? match[0] : cleaned;
  try {
    const j = JSON.parse(jsonStr);
    const verdict = ['BULL', 'BEAR', 'NEUTRAL', 'PASS'].includes(j.verdict) ? j.verdict : 'NEUTRAL';
    const scores = j.scores && typeof j.scores === 'object' ? j.scores : {};
    return {
      verdict,
      confidence: Math.max(0, Math.min(100, Number(j.confidence) || 0)),
      rationale: String(j.rationale ?? '').slice(0, 4000),
      scores: {
        fundamentals: Number(scores.fundamentals) || 0,
        technicals: Number(scores.technicals) || 0,
        options_flow: Number(scores.options_flow) || 0,
        sentiment: Number(scores.sentiment) || 0,
      },
      suggested_trade: j.suggested_trade && typeof j.suggested_trade === 'object' ? {
        structure: String(j.suggested_trade.structure ?? ''),
        entry: String(j.suggested_trade.entry ?? ''),
        target: String(j.suggested_trade.target ?? ''),
        stop: String(j.suggested_trade.stop ?? ''),
        thesis: String(j.suggested_trade.thesis ?? ''),
        timeframe: String(j.suggested_trade.timeframe ?? ''),
      } : null,
    };
  } catch {
    return {
      verdict: 'NEUTRAL',
      confidence: 0,
      rationale: text.slice(0, 1000),
      scores: { fundamentals: 0, technicals: 0, options_flow: 0, sentiment: 0 },
      suggested_trade: null,
    };
  }
}

// ── Persist run ──────────────────────────────────────────────────────────────
async function persistRun(args: {
  userId: string;
  ticker: string;
  inputs: DataBundle;
  specialists: SpecialistResult[];
  judge: JudgeResult;
  totalCost: number;
  totalLatency: number;
}): Promise<string | null> {
  try {
    const sb = createServiceClient();
    const pick = (name: SpecialistName) => args.specialists.find(s => s.name === name)?.output ?? null;
    const { data, error } = await sb
      .from('crew_runs')
      .insert({
        user_id: args.userId,
        ticker: args.ticker,
        inputs_json: { quote: args.inputs.quote, profile: args.inputs.profile, bars_count: args.inputs.bars_count },
        fundamentals_output: pick('fundamentals'),
        technicals_output: pick('technicals'),
        options_flow_output: pick('options_flow'),
        sentiment_output: pick('sentiment'),
        judge_verdict: args.judge.output.verdict,
        judge_confidence: args.judge.output.confidence,
        judge_rationale: args.judge.output.rationale,
        suggested_trade: args.judge.output.suggested_trade,
        total_cost_usd: args.totalCost,
        total_latency_ms: args.totalLatency,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) return null;
    return (data as unknown as { id: string }).id;
  } catch {
    return null;
  }
}

// ── Route handler ────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Durable rate limit: 8 per minute across all Vercel instances.
  const { allowed } = await checkRateLimitDurable('crew-analyze', 'wes', 8, 60);
  if (!allowed) return new Response('Too many requests', { status: 429 });

  let body: { ticker?: string };
  try {
    body = (await req.json()) as { ticker?: string };
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const ticker = (body.ticker ?? '').trim().toUpperCase();
  if (!/^[A-Z.\-]{1,8}$/.test(ticker)) {
    return new Response('Invalid ticker', { status: 400 });
  }

  const userId = 'wes';
  const encoder = new TextEncoder();
  const t0 = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(sseEncode(obj))); } catch { /* closed */ }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };

      req.signal.addEventListener('abort', close, { once: true });

      try {
        send({ type: 'meta', ticker, phase: 'gathering-data' });
        const data = await gatherData(ticker);
        send({
          type: 'meta',
          phase: 'specialists-starting',
          data_health: {
            quote: !!data.quote,
            profile: !!data.profile,
            bars: data.bars_count,
            filings: data.filings.length,
            options: !!data.options,
            news: data.news.length,
          },
        });

        // ── Fire all 4 specialists in parallel ───────────────────────────
        const specialistNames: SpecialistName[] = ['fundamentals', 'technicals', 'options_flow', 'sentiment'];
        for (const n of specialistNames) send({ type: 'specialist', name: n, event: 'start' });

        const specialists = await Promise.all(
          specialistNames.map(name =>
            runSpecialist(name, data, delta => send({ type: 'specialist', name, event: 'token', delta }))
              .then(res => {
                send({ type: 'specialist', name, event: 'done', output: res.output, latency_ms: res.latency_ms, model: res.model });
                return res;
              })
              .catch(err => {
                const message = err instanceof Error ? err.message : String(err);
                send({ type: 'specialist', name, event: 'error', message });
                // Return a neutral stub so judge still runs
                return {
                  name,
                  output: { thesis: `Specialist ${name} failed: ${message}`, confidence: 0, stance: 'neutral' as const, key_points: [], citations: [] },
                  raw_text: '',
                  model: CLAUDE_MODEL_FALLBACK,
                  tokens_in: 0, tokens_out: 0, latency_ms: 0,
                } satisfies SpecialistResult;
              })
          )
        );

        // ── Judge ────────────────────────────────────────────────────────
        send({ type: 'judge', event: 'start' });
        const judge = await runJudge(ticker, data, specialists, delta => send({ type: 'judge', event: 'token', delta }));
        send({
          type: 'judge',
          event: 'done',
          verdict: judge.output.verdict,
          confidence: judge.output.confidence,
          rationale: judge.output.rationale,
          scores: judge.output.scores,
          suggestedTrade: judge.output.suggested_trade,
          latency_ms: judge.latency_ms,
          model: judge.model,
        });

        // ── Persist + close ──────────────────────────────────────────────
        const totalLatency = Date.now() - t0;
        const totalCost = specialists.reduce((sum, s) => sum + costOf(s.model, s.tokens_in, s.tokens_out), 0)
          + costOf(judge.model, judge.tokens_in, judge.tokens_out);

        const runId = await persistRun({ userId, ticker, inputs: data, specialists, judge, totalCost, totalLatency });

        send({
          type: 'complete',
          runId,
          totalCostUsd: Number(totalCost.toFixed(6)),
          totalLatencyMs: totalLatency,
          tokens: {
            specialists: specialists.map(s => ({ name: s.name, in: s.tokens_in, out: s.tokens_out })),
            judge: { in: judge.tokens_in, out: judge.tokens_out },
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
