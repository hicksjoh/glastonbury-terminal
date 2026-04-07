// Historical stress testing engine
// Simulates portfolio impact under past market crashes
// Pure computation — no external API calls

export interface StressScenario {
  name: string;
  description: string;
  period: string;
  marketDrop: number;      // S&P 500 drawdown (%)
  sectorImpacts: Record<string, number>; // sector-specific drops
  durationDays: number;
  recoveryDays: number;
  vixPeak: number;
}

export interface StressTestResult {
  scenario: StressScenario;
  portfolioImpact: number;     // estimated portfolio loss (%)
  portfolioLossDollars: number;
  worstPosition: { symbol: string; loss: number } | null;
  bestPosition: { symbol: string; loss: number } | null;
  riskLevel: 'low' | 'moderate' | 'high' | 'extreme';
  recommendation: string;
}

// Historical scenarios
export const STRESS_SCENARIOS: StressScenario[] = [
  {
    name: 'COVID Crash',
    description: 'Pandemic-driven selloff — fastest bear market in history',
    period: 'Feb-Mar 2020',
    marketDrop: -34,
    sectorImpacts: {
      technology: -30, healthcare: -25, consumer_cyclical: -40,
      financial: -38, energy: -55, industrial: -35,
      utilities: -25, real_estate: -30, consumer_defensive: -20,
      communication: -25, basic_materials: -30,
    },
    durationDays: 33,
    recoveryDays: 148,
    vixPeak: 82.69,
  },
  {
    name: 'GFC 2008',
    description: 'Global Financial Crisis — credit system near-collapse',
    period: 'Oct 2007 - Mar 2009',
    marketDrop: -57,
    sectorImpacts: {
      technology: -50, healthcare: -35, consumer_cyclical: -55,
      financial: -80, energy: -55, industrial: -55,
      utilities: -35, real_estate: -70, consumer_defensive: -25,
      communication: -45, basic_materials: -55,
    },
    durationDays: 517,
    recoveryDays: 1403,
    vixPeak: 89.53,
  },
  {
    name: 'Rate Hike 2022',
    description: 'Fed aggressive tightening — tech and growth selloff',
    period: 'Jan-Oct 2022',
    marketDrop: -25,
    sectorImpacts: {
      technology: -35, healthcare: -15, consumer_cyclical: -35,
      financial: -20, energy: 30, industrial: -20,
      utilities: -5, real_estate: -30, consumer_defensive: -5,
      communication: -40, basic_materials: -15,
    },
    durationDays: 282,
    recoveryDays: 380,
    vixPeak: 36.45,
  },
  {
    name: 'Flash Crash',
    description: 'Algorithmic cascade — market dropped 9% in minutes',
    period: 'May 6, 2010',
    marketDrop: -9,
    sectorImpacts: {
      technology: -10, healthcare: -8, consumer_cyclical: -12,
      financial: -12, energy: -8, industrial: -10,
      utilities: -5, real_estate: -8, consumer_defensive: -5,
      communication: -10, basic_materials: -8,
    },
    durationDays: 1,
    recoveryDays: 4,
    vixPeak: 40.95,
  },
  {
    name: 'China Selloff 2015',
    description: 'China devaluation + growth fears — global contagion',
    period: 'Aug 2015',
    marketDrop: -12,
    sectorImpacts: {
      technology: -12, healthcare: -10, consumer_cyclical: -15,
      financial: -14, energy: -20, industrial: -14,
      utilities: -5, real_estate: -8, consumer_defensive: -6,
      communication: -10, basic_materials: -18,
    },
    durationDays: 8,
    recoveryDays: 45,
    vixPeak: 53.29,
  },
  {
    name: 'Bond Tantrum 2013',
    description: 'Taper tantrum — Fed signals end of QE',
    period: 'May-Jun 2013',
    marketDrop: -6,
    sectorImpacts: {
      technology: -5, healthcare: -4, consumer_cyclical: -7,
      financial: -8, energy: -5, industrial: -6,
      utilities: -10, real_estate: -12, consumer_defensive: -3,
      communication: -5, basic_materials: -8,
    },
    durationDays: 24,
    recoveryDays: 30,
    vixPeak: 21.91,
  },
];

interface PositionInput {
  symbol: string;
  value: number;       // dollar value
  sector?: string;
  beta?: number;
}

export function runStressTest(
  positions: PositionInput[],
  scenario: StressScenario,
): StressTestResult {
  const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
  if (totalValue === 0) {
    return {
      scenario,
      portfolioImpact: 0,
      portfolioLossDollars: 0,
      worstPosition: null,
      bestPosition: null,
      riskLevel: 'low',
      recommendation: 'No positions to stress test.',
    };
  }

  let worstLoss = 0;
  let worstSymbol = '';
  let bestLoss = -100;
  let bestSymbol = '';
  let weightedImpact = 0;

  for (const pos of positions) {
    const weight = pos.value / totalValue;
    const beta = pos.beta ?? 1.0;

    // Get sector-specific impact or use market-wide
    const sectorKey = (pos.sector || 'technology').toLowerCase().replace(/\s/g, '_');
    const sectorImpact = scenario.sectorImpacts[sectorKey] ?? scenario.marketDrop;

    // Adjust by beta
    const posImpact = sectorImpact * beta;
    weightedImpact += weight * posImpact;

    if (posImpact < worstLoss) {
      worstLoss = posImpact;
      worstSymbol = pos.symbol;
    }
    if (posImpact > bestLoss) {
      bestLoss = posImpact;
      bestSymbol = pos.symbol;
    }
  }

  const portfolioImpact = Math.round(weightedImpact * 100) / 100;
  const portfolioLossDollars = Math.round(totalValue * (portfolioImpact / 100));

  let riskLevel: StressTestResult['riskLevel'];
  if (Math.abs(portfolioImpact) < 10) riskLevel = 'low';
  else if (Math.abs(portfolioImpact) < 25) riskLevel = 'moderate';
  else if (Math.abs(portfolioImpact) < 40) riskLevel = 'high';
  else riskLevel = 'extreme';

  const recommendation = generateRecommendation(riskLevel, portfolioImpact, scenario);

  return {
    scenario,
    portfolioImpact,
    portfolioLossDollars,
    worstPosition: worstSymbol ? { symbol: worstSymbol, loss: Math.round(worstLoss * 100) / 100 } : null,
    bestPosition: bestSymbol ? { symbol: bestSymbol, loss: Math.round(bestLoss * 100) / 100 } : null,
    riskLevel,
    recommendation,
  };
}

function generateRecommendation(risk: string, impact: number, scenario: StressScenario): string {
  if (risk === 'extreme') {
    return `Extreme loss of ${impact}% under ${scenario.name}. Consider adding hedges (puts, VIX calls) or reducing high-beta positions.`;
  }
  if (risk === 'high') {
    return `Significant ${impact}% drawdown under ${scenario.name}. Review sector concentration and consider defensive rebalancing.`;
  }
  if (risk === 'moderate') {
    return `Moderate ${impact}% impact from ${scenario.name}. Portfolio has reasonable diversification but could benefit from tail hedging.`;
  }
  return `Low sensitivity to ${scenario.name} (${impact}%). Portfolio is well-positioned for this type of stress event.`;
}

// Run all scenarios
export function runAllStressTests(positions: PositionInput[]): StressTestResult[] {
  return STRESS_SCENARIOS.map(s => runStressTest(positions, s));
}
