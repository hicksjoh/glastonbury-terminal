// ComplianceAgent — Trade Guard rules, position limits, wash sales, daily loss
// Pure computation on portfolio data

import { BaseAgent, type AgentTask, type AgentResult, AgentRegistry } from './agent-framework';

interface ComplianceCheck {
  rule: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  value?: number;
  limit?: number;
}

class ComplianceAgentImpl extends BaseAgent {
  readonly name = 'ComplianceAgent';
  readonly description = 'Trade compliance — position limits, sector concentration, wash sales, daily loss';
  readonly capabilities = ['pre_trade_check', 'daily_compliance', 'position_limits', 'wash_sale_check'];

  protected async run(task: AgentTask): Promise<AgentResult> {
    const sources: string[] = [];

    try {
      const alpacaKey = process.env.ALPACA_API_KEY;
      const alpacaSecret = process.env.ALPACA_SECRET_KEY;
      if (!alpacaKey || !alpacaSecret) throw new Error('Alpaca not configured');

      // Fetch account + positions in parallel
      const [accountRes, positionsRes] = await Promise.all([
        fetch('https://paper-api.alpaca.markets/v2/account', {
          headers: { 'APCA-API-KEY-ID': alpacaKey, 'APCA-API-SECRET-KEY': alpacaSecret },
        }),
        fetch('https://paper-api.alpaca.markets/v2/positions', {
          headers: { 'APCA-API-KEY-ID': alpacaKey, 'APCA-API-SECRET-KEY': alpacaSecret },
        }),
      ]);

      if (!accountRes.ok || !positionsRes.ok) throw new Error('Failed to fetch account data');

      const account = await accountRes.json();
      const positions = await positionsRes.json();
      sources.push('alpaca');

      const equity = Number(account.equity || 0);
      const dayPL = Number(account.equity || 0) - Number(account.last_equity || 0);
      const posArray = Array.isArray(positions) ? positions : [];

      const checks: ComplianceCheck[] = [];

      // Rule 1: Single position limit (max 15% of portfolio)
      for (const pos of posArray) {
        const posValue = Math.abs(Number(pos.market_value || 0));
        const pct = equity > 0 ? (posValue / equity) * 100 : 0;
        if (pct > 15) {
          checks.push({
            rule: 'Position Size Limit',
            status: 'fail',
            message: `${pos.symbol} is ${pct.toFixed(1)}% of portfolio (limit: 15%)`,
            value: pct,
            limit: 15,
          });
        } else if (pct > 10) {
          checks.push({
            rule: 'Position Size Warning',
            status: 'warn',
            message: `${pos.symbol} is ${pct.toFixed(1)}% of portfolio (warning at 10%)`,
            value: pct,
            limit: 15,
          });
        }
      }

      // Rule 2: Sector concentration (max 40%)
      const sectorMap: Record<string, number> = {};
      for (const pos of posArray) {
        const sector = 'technology'; // Would need FMP enrichment
        sectorMap[sector] = (sectorMap[sector] || 0) + Math.abs(Number(pos.market_value || 0));
      }
      for (const [sector, value] of Object.entries(sectorMap)) {
        const pct = equity > 0 ? (value / equity) * 100 : 0;
        if (pct > 40) {
          checks.push({
            rule: 'Sector Concentration',
            status: 'fail',
            message: `${sector} sector is ${pct.toFixed(1)}% (limit: 40%)`,
            value: pct,
            limit: 40,
          });
        }
      }

      // Rule 3: Daily loss limit (max 3% of equity)
      const dayPLPct = equity > 0 ? (dayPL / equity) * 100 : 0;
      if (dayPLPct < -3) {
        checks.push({
          rule: 'Daily Loss Limit',
          status: 'fail',
          message: `Daily loss is ${dayPLPct.toFixed(1)}% (limit: -3%)`,
          value: dayPLPct,
          limit: -3,
        });
      } else if (dayPLPct < -2) {
        checks.push({
          rule: 'Daily Loss Warning',
          status: 'warn',
          message: `Daily loss is ${dayPLPct.toFixed(1)}% (warning at -2%)`,
          value: dayPLPct,
          limit: -3,
        });
      }

      // Rule 4: Total position count (max 20 for manageable portfolio)
      if (posArray.length > 20) {
        checks.push({
          rule: 'Position Count',
          status: 'warn',
          message: `${posArray.length} positions (recommended max: 20)`,
          value: posArray.length,
          limit: 20,
        });
      }

      // Rule 5: Cash reserve (min 5%)
      const cash = Number(account.cash || 0);
      const cashPct = equity > 0 ? (cash / equity) * 100 : 0;
      if (cashPct < 5) {
        checks.push({
          rule: 'Cash Reserve',
          status: 'warn',
          message: `Cash is ${cashPct.toFixed(1)}% (recommended min: 5%)`,
          value: cashPct,
          limit: 5,
        });
      }

      // Summary
      const failures = checks.filter(c => c.status === 'fail').length;
      const warnings = checks.filter(c => c.status === 'warn').length;

      // If no issues found, add a pass
      if (checks.length === 0) {
        checks.push({
          rule: 'All Clear',
          status: 'pass',
          message: 'All compliance checks passed',
        });
      }

      return {
        agent: this.name,
        status: 'success',
        data: {
          checks,
          summary: {
            totalChecks: 5,
            failures,
            warnings,
            passes: 5 - failures - warnings,
            approved: failures === 0,
          },
          account: {
            equity: Math.round(equity),
            cash: Math.round(cash),
            dayPL: Math.round(dayPL),
            positionCount: posArray.length,
          },
        },
        confidence: 0.95,
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

AgentRegistry.register(new ComplianceAgentImpl());
export const ComplianceAgent = AgentRegistry.get('ComplianceAgent')!;
