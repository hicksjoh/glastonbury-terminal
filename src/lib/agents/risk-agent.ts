// RiskAgent — factor analysis, stress testing, correlation, VaR
// Pure computation on portfolio data from Alpaca

import { BaseAgent, type AgentTask, type AgentResult, AgentRegistry } from './agent-framework';
import { analyzeFactorExposure, type FactorAnalysis } from '../factor-engine';
import { runAllStressTests, type StressTestResult } from '../stress-test-engine';

class RiskAgentImpl extends BaseAgent {
  readonly name = 'RiskAgent';
  readonly description = 'Portfolio risk analysis — factors, stress tests, correlation, VaR';
  readonly capabilities = ['factor_analysis', 'stress_test', 'correlation', 'var', 'risk_summary'];

  protected async run(task: AgentTask): Promise<AgentResult> {
    const sources: string[] = [];

    try {
      // Get positions from Alpaca
      const alpacaKey = process.env.ALPACA_API_KEY;
      const alpacaSecret = process.env.ALPACA_SECRET_KEY;
      if (!alpacaKey || !alpacaSecret) throw new Error('Alpaca not configured');

      const res = await fetch('https://paper-api.alpaca.markets/v2/positions', {
        headers: { 'APCA-API-KEY-ID': alpacaKey, 'APCA-API-SECRET-KEY': alpacaSecret },
      });
      if (!res.ok) throw new Error(`Alpaca HTTP ${res.status}`);

      const positions = await res.json();
      sources.push('alpaca');

      if (!Array.isArray(positions) || positions.length === 0) {
        return {
          agent: this.name, status: 'success',
          data: { factors: null, stress: [], message: 'No positions to analyze' },
          confidence: 1, latencyMs: 0, sources,
        };
      }

      // Factor analysis
      const holdings = positions.map((p: Record<string, unknown>) => ({
        symbol: String(p.symbol || ''),
        weight: Math.abs(Number(p.market_value || 0)),
        momentum1Y: Number(p.unrealized_plpc || 0) * 100,
      }));

      const totalValue = holdings.reduce((s, h) => s + h.weight, 0);
      for (const h of holdings) h.weight = totalValue > 0 ? h.weight / totalValue : 0;

      const factors: FactorAnalysis = analyzeFactorExposure(holdings);

      // Stress tests
      const stressPositions = positions.map((p: Record<string, unknown>) => ({
        symbol: String(p.symbol || ''),
        value: Math.abs(Number(p.market_value || 0)),
      }));
      const stress: StressTestResult[] = runAllStressTests(stressPositions);

      // Portfolio VaR (parametric, 95% confidence)
      const portfolioVol = 0.20; // assume 20% annualized vol
      const dailyVol = portfolioVol / Math.sqrt(252);
      const var95 = totalValue * dailyVol * 1.645;
      const var99 = totalValue * dailyVol * 2.326;

      return {
        agent: this.name,
        status: 'success',
        data: {
          factors,
          stress: stress.map(s => ({
            scenario: s.scenario.name,
            impact: s.portfolioImpact,
            lossDollars: s.portfolioLossDollars,
            riskLevel: s.riskLevel,
          })),
          var: {
            daily95: Math.round(var95),
            daily99: Math.round(var99),
            totalPortfolioValue: Math.round(totalValue),
          },
          positionCount: positions.length,
        },
        confidence: 0.85,
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

AgentRegistry.register(new RiskAgentImpl());
export const RiskAgent = AgentRegistry.get('RiskAgent')!;
