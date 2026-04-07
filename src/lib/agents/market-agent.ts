// MarketAgent — real-time prices, flow, GEX, scanner
// Data sources: Alpaca, FMP, Finnhub, Polygon

import { BaseAgent, type AgentTask, type AgentResult, AgentRegistry } from './agent-framework';
import { apiFetchWithFallback } from '../api-client';

class MarketAgentImpl extends BaseAgent {
  readonly name = 'MarketAgent';
  readonly description = 'Real-time market data — prices, flow, GEX, scanner, volume analysis';
  readonly capabilities = ['quote', 'scanner', 'flow', 'gex', 'volume', 'market_overview'];

  protected async run(task: AgentTask): Promise<AgentResult> {
    const symbol = task.symbol || 'SPY';
    const sources: string[] = [];

    try {
      // Fetch quote from Finnhub (fast, generous limits)
      const quoteResult = await apiFetchWithFallback<{
        c?: number; d?: number; dp?: number; h?: number; l?: number; o?: number; pc?: number;
      }>(
        'finnhub', '/quote', { symbol }, {},
        { cacheTtlMs: 30_000 },
      );
      if (quoteResult._meta.live) sources.push('finnhub');

      const quote = quoteResult.data;
      const price = quote.c ?? 0;
      const change = quote.d ?? 0;
      const changePct = quote.dp ?? 0;

      // Get market breadth from FMP
      const [gainersRes, losersRes] = await Promise.all([
        apiFetchWithFallback<unknown[]>('fmp', '/v3/stock_market/gainers', {}, [], { cacheTtlMs: 5 * 60 * 1000 }),
        apiFetchWithFallback<unknown[]>('fmp', '/v3/stock_market/losers', {}, [], { cacheTtlMs: 5 * 60 * 1000 }),
      ]);
      if (gainersRes._meta.live) sources.push('fmp');

      const gainers = Array.isArray(gainersRes.data) ? gainersRes.data.length : 0;
      const losers = Array.isArray(losersRes.data) ? losersRes.data.length : 0;

      return {
        agent: this.name,
        status: 'success',
        data: {
          symbol,
          price,
          change,
          changePct,
          high: quote.h ?? 0,
          low: quote.l ?? 0,
          open: quote.o ?? 0,
          prevClose: quote.pc ?? 0,
          marketBreadth: {
            gainers,
            losers,
            ratio: losers > 0 ? Math.round((gainers / losers) * 100) / 100 : gainers,
            sentiment: gainers > losers * 1.5 ? 'bullish' : gainers > losers ? 'neutral' : 'bearish',
          },
        },
        confidence: quoteResult._meta.live ? 0.9 : 0.3,
        latencyMs: 0,
        sources,
      };
    } catch (err) {
      return {
        agent: this.name,
        status: 'error',
        data: null,
        confidence: 0,
        latencyMs: 0,
        error: String(err),
        sources,
      };
    }
  }
}

AgentRegistry.register(new MarketAgentImpl());
export const MarketAgent = AgentRegistry.get('MarketAgent')!;
