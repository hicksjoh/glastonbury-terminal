// SentimentAgent — news sentiment, congress trades, insider activity
// Data sources: Finnhub, NewsAPI, GNews, FMP

import { BaseAgent, type AgentTask, type AgentResult, AgentRegistry } from './agent-framework';
import { getSymbolSentiment, getMarketSentiment } from '../sentiment-engine';
import { apiFetchWithFallback } from '../api-client';

class SentimentAgentImpl extends BaseAgent {
  readonly name = 'SentimentAgent';
  readonly description = 'Market sentiment — news analysis, congress trades, insider activity, social signals';
  readonly capabilities = ['sentiment', 'news', 'congress_trades', 'insider_activity'];

  protected async run(task: AgentTask): Promise<AgentResult> {
    const symbol = task.symbol;
    const sources: string[] = [];

    try {
      // Get news sentiment
      const { summary, metas } = symbol
        ? await getSymbolSentiment(symbol)
        : await getMarketSentiment();

      for (const m of metas) if (m.live) sources.push(m.source);

      // Get insider activity for the symbol
      let insiderSignals: { type: string; count: number }[] = [];
      if (symbol) {
        const insiderResult = await apiFetchWithFallback<unknown[]>(
          'fmp', '/v4/insider-trading-rss-feed', { limit: '50' }, [],
          { cacheTtlMs: 15 * 60 * 1000 },
        );

        if (Array.isArray(insiderResult.data)) {
          const matching = insiderResult.data.filter(
            (t: unknown) => String((t as Record<string, unknown>).symbol || '') === symbol
          );
          const buys = matching.filter(
            (t: unknown) => String((t as Record<string, unknown>).acquistionOrDisposition || '').toLowerCase() === 'a'
          ).length;
          const sells = matching.length - buys;

          if (matching.length > 0) {
            insiderSignals = [
              { type: 'insider_buys', count: buys },
              { type: 'insider_sells', count: sells },
            ];
            if (insiderResult._meta.live) sources.push('fmp:insider');
          }
        }
      }

      return {
        agent: this.name,
        status: 'success',
        data: {
          sentiment: summary.composite,
          topArticles: summary.articles.slice(0, 5).map(a => ({
            headline: a.headline,
            source: a.source,
            sentiment: a.sentiment,
          })),
          insiderSignals,
          sources: summary.sources,
        },
        confidence: summary.composite.articleCount > 5 ? 0.8 : 0.5,
        latencyMs: 0,
        sources,
      };
    } catch (err) {
      return {
        agent: this.name, status: 'error', data: null,
        confidence: 0, latencyMs: 0, error: String(err), sources,
      };
    }
  }
}

AgentRegistry.register(new SentimentAgentImpl());
export const SentimentAgent = AgentRegistry.get('SentimentAgent')!;
