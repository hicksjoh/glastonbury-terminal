// AlphaAgent — synthesizes all other agent outputs into scored trade signals
// This is the ONLY agent that uses the Claude API for reasoning

import { BaseAgent, type AgentTask, type AgentResult, AgentRegistry } from './agent-framework';

class AlphaAgentImpl extends BaseAgent {
  readonly name = 'AlphaAgent';
  readonly description = 'Signal synthesis — scores trade opportunities using all agent data + AI reasoning';
  readonly capabilities = ['signal_score', 'trade_evaluation', 'daily_briefing'];

  protected async run(task: AgentTask): Promise<AgentResult> {
    const symbol = task.symbol;
    const agentResults = task.params?.agentResults as Record<string, AgentResult> | undefined;

    try {
      // Collect signals from other agents
      const signals: { source: string; signal: string; strength: number }[] = [];
      const sources: string[] = ['alpha_synthesis'];

      if (agentResults) {
        // Market signals
        const market = agentResults.MarketAgent;
        if (market?.status === 'success' && market.data) {
          const md = market.data as Record<string, unknown>;
          const changePct = Number((md as { changePct?: number }).changePct || 0);
          if (changePct > 2) signals.push({ source: 'market', signal: 'strong_momentum', strength: 0.8 });
          else if (changePct > 0.5) signals.push({ source: 'market', signal: 'positive_trend', strength: 0.6 });
          else if (changePct < -2) signals.push({ source: 'market', signal: 'selling_pressure', strength: -0.8 });
          sources.push('market');
        }

        // Risk signals
        const risk = agentResults.RiskAgent;
        if (risk?.status === 'success' && risk.data) {
          const rd = risk.data as { factors?: { exposures?: { market?: number } }; var?: { daily95?: number } };
          const beta = rd.factors?.exposures?.market ?? 1;
          if (beta > 1.3) signals.push({ source: 'risk', signal: 'high_beta_warning', strength: -0.3 });
          sources.push('risk');
        }

        // Compliance signals
        const compliance = agentResults.ComplianceAgent;
        if (compliance?.status === 'success' && compliance.data) {
          const cd = compliance.data as { summary?: { approved?: boolean; failures?: number } };
          if (cd.summary?.approved === false) {
            signals.push({ source: 'compliance', signal: 'compliance_block', strength: -1.0 });
          }
          sources.push('compliance');
        }

        // Sentiment signals
        const sentiment = agentResults.SentimentAgent;
        if (sentiment?.status === 'success' && sentiment.data) {
          const sd = sentiment.data as { sentiment?: { score?: number; label?: string } };
          const sentScore = sd.sentiment?.score ?? 0;
          if (sentScore > 30) signals.push({ source: 'sentiment', signal: 'strong_bullish_sentiment', strength: 0.7 });
          else if (sentScore > 10) signals.push({ source: 'sentiment', signal: 'bullish_sentiment', strength: 0.4 });
          else if (sentScore < -30) signals.push({ source: 'sentiment', signal: 'strong_bearish_sentiment', strength: -0.7 });
          else if (sentScore < -10) signals.push({ source: 'sentiment', signal: 'bearish_sentiment', strength: -0.4 });
          sources.push('sentiment');
        }
      }

      // Score the opportunity (0-100)
      const bullishSignals = signals.filter(s => s.strength > 0);
      const bearishSignals = signals.filter(s => s.strength < 0);
      const netStrength = signals.reduce((sum, s) => sum + s.strength, 0);

      // Base score of 50, adjusted by signals
      const rawScore = 50 + netStrength * 25;
      const score = Math.max(0, Math.min(100, Math.round(rawScore)));

      let direction: 'long' | 'short' | 'neutral';
      if (score >= 65) direction = 'long';
      else if (score <= 35) direction = 'short';
      else direction = 'neutral';

      // Confluence check
      const confluenceCount = new Set(signals.map(s => s.source)).size;

      return {
        agent: this.name,
        status: 'success',
        data: {
          symbol,
          score,
          direction,
          signals,
          confluence: {
            count: confluenceCount,
            bullish: bullishSignals.length,
            bearish: bearishSignals.length,
            sources: Array.from(new Set(signals.map(s => s.source))),
          },
          recommendation: generateRecommendation(score, direction, confluenceCount, symbol),
        },
        confidence: Math.min(0.95, 0.5 + confluenceCount * 0.1),
        latencyMs: 0,
        sources,
      };
    } catch (err) {
      return {
        agent: this.name, status: 'error', data: null,
        confidence: 0, latencyMs: 0, error: String(err), sources: [],
      };
    }
  }
}

function generateRecommendation(score: number, direction: string, confluence: number, symbol?: string): string {
  const sym = symbol || 'this position';
  if (score >= 80 && confluence >= 3) {
    return `Strong BUY signal for ${sym} (${score}/100). ${confluence} sources in agreement. High conviction entry.`;
  }
  if (score >= 65) {
    return `Moderate BUY signal for ${sym} (${score}/100). ${confluence} confluent signals. Consider a scaled entry.`;
  }
  if (score <= 20 && confluence >= 3) {
    return `Strong AVOID signal for ${sym} (${score}/100). Multiple bearish confluences detected.`;
  }
  if (score <= 35) {
    return `Bearish signal for ${sym} (${score}/100). Wait for better setup or consider short exposure.`;
  }
  return `Neutral on ${sym} (${score}/100). No strong directional signal — wait for more confluence.`;
}

AgentRegistry.register(new AlphaAgentImpl());
export const AlphaAgent = AgentRegistry.get('AlphaAgent')!;
