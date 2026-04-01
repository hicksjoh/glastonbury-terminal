/**
 * Confluence Signal Scoring Engine
 * Cross-references multiple alpha signals to produce a composite score (0-100)
 */

import { calculateKelly } from './kelly-sizer';

export interface SignalInput {
  insiderClusterBuy?: boolean;
  congressBuy?: boolean;
  bullishFlow?: boolean;
  sentimentScore?: number; // 1-10
  earningsBeatRate?: number; // 0-1
  above50DMA?: boolean;
  regimeFit?: boolean;
  // For Kelly sizing
  winRate?: number;
  avgWin?: number;
  avgLoss?: number;
}

export interface ScoredSignal {
  score: number; // 0-100
  sources: string[];
  kellySizing: { shares: number; dollars: number; pctOfPortfolio: number } | null;
}

/**
 * Score a signal based on confluence of multiple alpha sources
 */
export function scoreSignal(input: SignalInput, portfolioSize: number = 100000, pricePerShare: number = 100): ScoredSignal {
  let score = 0;
  const sources: string[] = [];

  if (input.insiderClusterBuy) {
    score += 25;
    sources.push('insider_cluster_buy');
  }

  if (input.congressBuy) {
    score += 20;
    sources.push('congress_buy');
  }

  if (input.bullishFlow) {
    score += 20;
    sources.push('bullish_flow');
  }

  if (input.sentimentScore && input.sentimentScore > 7) {
    score += 15;
    sources.push('positive_sentiment');
  }

  if (input.earningsBeatRate && input.earningsBeatRate > 0.75) {
    score += 10;
    sources.push('earnings_beat_history');
  }

  if (input.above50DMA) {
    score += 10;
    sources.push('above_50dma');
  }

  if (input.regimeFit) {
    score += 10;
    sources.push('regime_fit');
  }

  // Normalize to 0-100 (max raw = 110)
  score = Math.min(100, Math.round(score * (100 / 110)));

  // Kelly sizing for top scorers
  let kellySizing = null;
  if (score >= 40 && input.winRate && input.avgWin && input.avgLoss) {
    const kelly = calculateKelly({
      expectedReturn: input.avgWin * input.winRate - input.avgLoss * (1 - input.winRate),
      winRate: input.winRate,
      avgWin: input.avgWin,
      avgLoss: input.avgLoss,
    }, portfolioSize);

    const dollars = kelly.dollarsAtRisk;
    const shares = pricePerShare > 0 ? Math.floor(dollars / pricePerShare) : 0;

    kellySizing = {
      shares,
      dollars: Math.round(dollars),
      pctOfPortfolio: Math.round(kelly.halfKelly * 10000) / 100,
    };
  }

  return { score, sources, kellySizing };
}

/**
 * Score and rank multiple symbols
 */
export function rankSignals(
  signals: Array<{ symbol: string; company: string; input: SignalInput; price: number }>,
  portfolioSize: number = 100000
): Array<{ symbol: string; company: string; score: number; sources: string[]; kellySizing: ScoredSignal['kellySizing'] }> {
  return signals
    .map(s => {
      const result = scoreSignal(s.input, portfolioSize, s.price);
      return { symbol: s.symbol, company: s.company, ...result };
    })
    .sort((a, b) => b.score - a.score);
}
