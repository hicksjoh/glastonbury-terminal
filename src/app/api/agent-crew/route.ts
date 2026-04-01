import { NextRequest, NextResponse } from 'next/server';
import { anthropic } from '@/lib/claude';
import { createServiceClient } from '@/lib/supabase';

const ALPACA_BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const ALPACA_HEADERS = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
};
const FMP_KEY = process.env.FMP_API_KEY || '';

export async function POST(req: NextRequest) {
  try {
    const { symbol, action, context: additionalContext } = await req.json();

    if (!symbol || !action || !['buy', 'sell'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid request. Required: { symbol: string, action: "buy" | "sell" }' },
        { status: 400 }
      );
    }

    const upperSymbol = symbol.toUpperCase();

    // ── Fetch real-time context in parallel ──────────────────────────────
    const [quoteData, portfolioData, accountData] = await Promise.all([
      fetchQuote(upperSymbol),
      fetchPortfolio(),
      fetchAccount(),
    ]);

    const currentPrice = quoteData?.price ?? 'unavailable';
    const portfolioSummary = formatPortfolio(portfolioData);
    const accountSummary = formatAccount(accountData);

    const userContext = [
      `Symbol: ${upperSymbol}`,
      `Proposed action: ${action.toUpperCase()}`,
      `Current price: $${currentPrice}`,
      `\nPortfolio positions:\n${portfolioSummary}`,
      `\nAccount summary:\n${accountSummary}`,
      additionalContext ? `\nAdditional context from trader: ${additionalContext}` : '',
    ].join('\n');

    // ── Run 3 Claude agent calls in parallel ─────────────────────────────
    const [analystRaw, riskRaw, executorRaw] = await Promise.all([
      callAgent(
        `You are the Analyst on a hedge fund trading desk. Evaluate ${upperSymbol} for a ${action} trade. Consider price action, market conditions, and risk/reward. Be thorough but concise. Return ONLY valid JSON: { "thesis": string, "conviction": number (1-10), "keyFactors": string[], "risks": string[], "priceTarget": number }`,
        userContext
      ),
      callAgent(
        `You are the Risk Controller on a hedge fund trading desk. Challenge the proposed ${action} on ${upperSymbol}. Be the skeptic. Return ONLY valid JSON: { "approval": boolean, "concerns": string[], "riskRating": "low" | "medium" | "high" | "extreme", "maxPositionSize": string, "stopLossRecommendation": string, "hedgeSuggestion": string }`,
        userContext
      ),
      callAgent(
        `You are the Execution Specialist on a hedge fund trading desk. Design the optimal trade execution for ${action} on ${upperSymbol}. Return ONLY valid JSON: { "recommendation": "proceed" | "modify" | "reject", "executionPlan": { "orderType": string, "entryPrice": number, "stopLoss": number, "takeProfit": number, "timeframe": string }, "alternativeStrategy": string, "kellySize": { "shares": number, "dollars": number, "pctOfPortfolio": number } }`,
        userContext
      ),
    ]);

    // ── Parse responses with fallback defaults ───────────────────────────
    const analyst = safeParseJSON(analystRaw, {
      thesis: 'Analysis unavailable',
      conviction: 5,
      keyFactors: [],
      risks: ['Unable to parse analyst response'],
      priceTarget: 0,
    });

    const riskController = safeParseJSON(riskRaw, {
      approval: false,
      concerns: ['Unable to parse risk assessment'],
      riskRating: 'high' as const,
      maxPositionSize: 'unknown',
      stopLossRecommendation: 'unknown',
      hedgeSuggestion: 'unknown',
    });

    const executor = safeParseJSON(executorRaw, {
      recommendation: 'reject' as string,
      executionPlan: {
        orderType: 'limit',
        entryPrice: 0,
        stopLoss: 0,
        takeProfit: 0,
        timeframe: 'unknown',
      },
      alternativeStrategy: 'Unable to parse execution plan',
      kellySize: { shares: 0, dollars: 0, pctOfPortfolio: 0 },
    });

    // ── Determine consensus ──────────────────────────────────────────────
    const analystPositive = analyst.conviction >= 7;
    const riskPositive = riskController.approval === true;
    const executorPositive = executor.recommendation === 'proceed';

    const positiveCount = [analystPositive, riskPositive, executorPositive].filter(Boolean).length;

    let consensus: string;
    if (positiveCount === 3) {
      consensus = 'unanimous_go';
    } else if (positiveCount === 0) {
      consensus = 'unanimous_stop';
    } else if (positiveCount >= 2) {
      consensus = 'majority_go';
    } else {
      consensus = 'split';
    }

    // ── Generate final verdict ───────────────────────────────────────────
    const finalVerdict = generateVerdict({
      symbol: upperSymbol,
      action,
      consensus,
      analyst,
      riskController,
      executor,
    });

    const timestamp = new Date().toISOString();

    // ── Store in Supabase ────────────────────────────────────────────────
    try {
      const supabase = createServiceClient();
      await (supabase as any).from('crew_sessions').insert({
        symbol: upperSymbol,
        proposed_action: action,
        analyst_response: analyst,
        risk_response: riskController,
        executor_response: executor,
        consensus,
        final_verdict: finalVerdict,
        created_at: timestamp,
      });
    } catch (dbErr) {
      console.error('[agent-crew] Supabase insert failed:', dbErr);
    }

    // ── Return response ──────────────────────────────────────────────────
    return NextResponse.json({
      symbol: upperSymbol,
      proposedAction: action,
      analyst: {
        thesis: analyst.thesis,
        conviction: analyst.conviction,
        keyFactors: analyst.keyFactors,
        risks: analyst.risks,
        priceTarget: analyst.priceTarget,
      },
      riskController: {
        approval: riskController.approval,
        concerns: riskController.concerns,
        riskRating: riskController.riskRating,
        maxPositionSize: riskController.maxPositionSize,
        stopLoss: riskController.stopLossRecommendation,
        hedge: riskController.hedgeSuggestion,
      },
      executor: {
        recommendation: executor.recommendation,
        executionPlan: executor.executionPlan,
        alternativeStrategy: executor.alternativeStrategy,
        kellySize: executor.kellySize,
      },
      consensus,
      finalVerdict,
      timestamp,
    });
  } catch (err) {
    console.error('[agent-crew] Route error:', err);
    return NextResponse.json(
      { error: 'Agent crew analysis failed', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// ── Helper: Fetch stock quote from FMP ─────────────────────────────────────
async function fetchQuote(symbol: string) {
  try {
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${FMP_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.[0] ?? null;
  } catch {
    return null;
  }
}

// ── Helper: Fetch portfolio positions from Alpaca ──────────────────────────
async function fetchPortfolio() {
  try {
    const res = await fetch(`${ALPACA_BASE_URL}/v2/positions`, {
      headers: ALPACA_HEADERS,
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// ── Helper: Fetch account from Alpaca ──────────────────────────────────────
async function fetchAccount() {
  try {
    const res = await fetch(`${ALPACA_BASE_URL}/v2/account`, {
      headers: ALPACA_HEADERS,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Helper: Format portfolio for agent context ─────────────────────────────
function formatPortfolio(positions: any[]): string {
  if (!positions || positions.length === 0) return 'No current positions';
  return positions
    .map(
      (p: any) =>
        `${p.symbol}: ${p.qty} shares @ $${parseFloat(p.avg_entry_price).toFixed(2)} (P&L: $${parseFloat(p.unrealized_pl).toFixed(2)})`
    )
    .join('\n');
}

// ── Helper: Format account for agent context ───────────────────────────────
function formatAccount(account: any): string {
  if (!account) return 'Account data unavailable';
  return [
    `Equity: $${parseFloat(account.equity).toFixed(2)}`,
    `Cash: $${parseFloat(account.cash).toFixed(2)}`,
    `Buying Power: $${parseFloat(account.buying_power).toFixed(2)}`,
    `Portfolio Value: $${parseFloat(account.portfolio_value).toFixed(2)}`,
  ].join('\n');
}

// ── Helper: Call a Claude agent ────────────────────────────────────────────
async function callAgent(systemPrompt: string, userMessage: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });
  return message.content[0].type === 'text' ? message.content[0].text : '';
}

// ── Helper: Safe JSON parse with fallback ──────────────────────────────────
function safeParseJSON<T>(raw: string, fallback: T): T {
  try {
    // Try to extract JSON from the response (handles markdown code blocks)
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();
    return JSON.parse(jsonStr) as T;
  } catch {
    console.error('[agent-crew] JSON parse failed for:', raw.substring(0, 200));
    return fallback;
  }
}

// ── Helper: Generate final verdict ─────────────────────────────────────────
function generateVerdict(params: {
  symbol: string;
  action: string;
  consensus: string;
  analyst: any;
  riskController: any;
  executor: any;
}): string {
  const { symbol, action, consensus, analyst, riskController, executor } = params;

  switch (consensus) {
    case 'unanimous_go':
      return `UNANIMOUS GO: All three agents agree — ${action.toUpperCase()} ${symbol}. Analyst conviction: ${analyst.conviction}/10. Risk approved (${riskController.riskRating} risk). Executor recommends proceeding with ${executor.executionPlan?.orderType || 'limit'} order. Price target: $${analyst.priceTarget}.`;

    case 'majority_go':
      const dissenters = [];
      if (analyst.conviction < 7) dissenters.push('Analyst (low conviction)');
      if (!riskController.approval) dissenters.push('Risk Controller');
      if (executor.recommendation !== 'proceed') dissenters.push('Executor');
      return `MAJORITY GO (2/3): Most agents favor the ${action} on ${symbol}, but ${dissenters.join(' and ')} raised concerns. Key concern: ${riskController.concerns?.[0] || 'see details'}. Proceed with caution and tight risk management.`;

    case 'split':
      return `SPLIT DECISION: Mixed signals on ${action} ${symbol}. Analyst conviction: ${analyst.conviction}/10. Risk rating: ${riskController.riskRating}. Executor: ${executor.recommendation}. Consider waiting for better entry or more data before committing capital.`;

    case 'unanimous_stop':
      return `UNANIMOUS STOP: All three agents advise against this ${action} on ${symbol}. Analyst conviction: ${analyst.conviction}/10. Risk: ${riskController.riskRating}. Top concern: ${riskController.concerns?.[0] || 'multiple red flags'}. Stand down.`;

    default:
      return `Analysis complete for ${action} ${symbol}. Consensus: ${consensus}. Review individual agent opinions for details.`;
  }
}
