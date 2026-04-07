'use client';
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const MonteCarloChart = dynamic(() => import('./MonteCarloChart'), {
  loading: () => (
    <div style={{ textAlign: 'center', padding: 60, color: '#6b6b80' }}>Loading chart...</div>
  ),
  ssr: false,
});

// Box-Muller normal distribution
function normal(mean = 0, std = 1) {
  const u = Math.random();
  const v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(arr: number[], p: number) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

interface PortfolioData {
  cr3Value: number;
  anthropicRSUs: number;
  investmentPortfolio: number;
  propertyValue: number;
  totalNetWorth: number;
  loading: boolean;
}

interface MonteCarloParams {
  cr3Factor: number;
  ipoValuation: number;
  investmentReturn: number;
  cr3ExitYear: number;
  exitMultiple: number;
}

function runMonteCarlo(params: MonteCarloParams, portfolio: PortfolioData) {
  const N = 1000;
  const years = [2026, 2027, 2028, 2029, 2030, 2031, 2032];
  const sims: number[][] = Array.from({ length: N }, () => Array(years.length).fill(0));

  for (let s = 0; s < N; s++) {
    for (let y = 0; y < years.length; y++) {
      const yr = years[y];
      const cr3 = portfolio.cr3Value * params.cr3Factor * Math.max(0, 1 + normal(0, 0.15)) * (yr - 2025);
      const anthropic =
        yr >= 2027
          ? portfolio.anthropicRSUs * (params.ipoValuation / 40) * Math.max(0, 1 + normal(0, 0.2))
          : 0;
      const investments =
        portfolio.investmentPortfolio * Math.pow(1 + params.investmentReturn + normal(0, 0.06), yr - 2026);
      const exitBonus = yr === params.cr3ExitYear ? cr3 * params.exitMultiple : 0;
      sims[s][y] = Math.max(0, cr3 + anthropic + investments + portfolio.propertyValue + exitBonus);
    }
  }

  const chartData = years.map((yr, yi) => {
    const vals = sims.map(s => s[yi]);
    return {
      year: yr,
      p10: percentile(vals, 10) / 1_000_000,
      p25: percentile(vals, 25) / 1_000_000,
      p50: percentile(vals, 50) / 1_000_000,
      p75: percentile(vals, 75) / 1_000_000,
      p90: percentile(vals, 90) / 1_000_000,
    };
  });

  const finalVals = sims.map(s => s[years.length - 1]);
  const targetProb = (finalVals.filter(v => v >= 50_000_000).length / N) * 100;
  const median = percentile(finalVals, 50);

  return { chartData, targetProb, median };
}

const DEFAULT_PARAMS: MonteCarloParams = {
  cr3Factor: 1.0,
  ipoValuation: 40,
  investmentReturn: 0.12,
  cr3ExitYear: 2030,
  exitMultiple: 5,
};

export default function MonteCarloPage() {
  const [params, setParams] = useState<MonteCarloParams>(DEFAULT_PARAMS);
  const [portfolioData, setPortfolioData] = useState<PortfolioData>({
    cr3Value: 720000,
    anthropicRSUs: 82000,
    investmentPortfolio: 100000,
    propertyValue: 580000,
    totalNetWorth: 1482000,
    loading: true,
  });
  const [result, setResult] = useState(() => runMonteCarlo(DEFAULT_PARAMS, {
    cr3Value: 720000,
    anthropicRSUs: 82000,
    investmentPortfolio: 100000,
    propertyValue: 580000,
    totalNetWorth: 1482000,
    loading: true,
  }));

  // Fetch real portfolio data on mount
  useEffect(() => {
    async function fetchPortfolio() {
      try {
        const [wealthRes, alpacaRes] = await Promise.all([
          fetch('/api/wealth').then(r => r.json()).catch(() => null),
          fetch('/api/alpaca/account').then(r => r.json()).catch(() => null),
        ]);

        const breakdown = wealthRes?.data?.breakdown;
        const investmentValue = alpacaRes?.equity
          ? parseFloat(alpacaRes.equity)
          : breakdown?.investments?.value ?? 100000;

        const newPortfolio: PortfolioData = {
          cr3Value: breakdown?.franchise?.value ?? 720000,
          anthropicRSUs: breakdown?.rsus?.value ?? 82000,
          investmentPortfolio: investmentValue,
          propertyValue: breakdown?.real_estate?.value ?? 580000,
          totalNetWorth: wealthRes?.data?.total_net_worth ?? 1482000,
          loading: false,
        };

        setPortfolioData(newPortfolio);
      } catch {
        setPortfolioData(prev => ({ ...prev, loading: false }));
      }
    }
    fetchPortfolio();
  }, []);

  // Re-run simulation when params or portfolio data change
  useEffect(() => {
    if (!portfolioData.loading) {
      setResult(runMonteCarlo(params, portfolioData));
    }
  }, [params, portfolioData]);

  const sliders = [
    {
      key: 'cr3Factor' as keyof MonteCarloParams,
      label: 'CR3 Revenue Factor',
      min: 0.3,
      max: 2.0,
      step: 0.1,
      format: (v: number) => `${v.toFixed(1)}x`,
    },
    {
      key: 'ipoValuation' as keyof MonteCarloParams,
      label: 'Anthropic IPO Valuation',
      min: 10,
      max: 150,
      step: 5,
      format: (v: number) => `$${v}B`,
    },
    {
      key: 'investmentReturn' as keyof MonteCarloParams,
      label: 'Investment Return Rate',
      min: 0.04,
      max: 0.25,
      step: 0.01,
      format: (v: number) => `${(v * 100).toFixed(0)}%`,
    },
    {
      key: 'cr3ExitYear' as keyof MonteCarloParams,
      label: 'CR3 Exit Year',
      min: 2028,
      max: 2035,
      step: 1,
      format: (v: number) => `${v}`,
    },
    {
      key: 'exitMultiple' as keyof MonteCarloParams,
      label: 'Exit Multiple',
      min: 2,
      max: 15,
      step: 0.5,
      format: (v: number) => `${v}x`,
    },
  ];

  const fmtCurrency = (v: number) =>
    v >= 1_000_000
      ? `$${(v / 1_000_000).toFixed(2)}M`
      : `$${(v / 1_000).toFixed(0)}K`;

  return (
    <AppShell>
      <ErrorBoundary label="MonteCarlo">
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Monte Carlo Modeler</h1>
        <p style={{ color: '#6b6b80', fontSize: 13, marginTop: 4 }}>
          1,000-simulation $50M wealth roadmap probability model
          {portfolioData.loading ? ' — loading portfolio...' : ' — seeded with live portfolio data'}
        </p>
      </div>

      {/* Current Portfolio Card */}
      <div className="terminal-card" style={{ marginBottom: 24, border: '1px solid rgba(129,140,248,0.3)' }}>
        <div style={{ fontSize: 12, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          Current Portfolio (Simulation Inputs)
          {portfolioData.loading && (
            <span style={{ color: '#c9a84c', fontSize: 11, fontStyle: 'italic' }}>fetching live data...</span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
          {[
            { label: 'CR3 Franchise', value: portfolioData.cr3Value, color: '#c9a84c' },
            { label: 'Anthropic RSUs', value: portfolioData.anthropicRSUs, color: '#818cf8' },
            { label: 'Investments', value: portfolioData.investmentPortfolio, color: '#22c55e' },
            { label: 'Real Estate', value: portfolioData.propertyValue, color: '#f97316' },
            { label: 'Total Net Worth', value: portfolioData.totalNetWorth, color: '#e8e8e8' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color, opacity: portfolioData.loading ? 0.4 : 1 }}>
                {fmtCurrency(value)}
              </div>
              <div style={{ fontSize: 11, color: '#6b6b80', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Key Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 24 }}>
        <div className="terminal-card" style={{ border: '1px solid rgba(201,168,76,0.3)', textAlign: 'center' }}>
          <div style={{ fontSize: 48, fontWeight: 800, color: '#c9a84c' }}>
            {result.targetProb.toFixed(0)}%
          </div>
          <div style={{ fontSize: 13, color: '#6b6b80' }}>Probability of reaching $50M by 2032</div>
        </div>
        <div className="terminal-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#22c55e' }}>
            ${(result.median / 1_000_000).toFixed(1)}M
          </div>
          <div style={{ fontSize: 13, color: '#6b6b80' }}>Median 2032 Outcome</div>
        </div>
        <div className="terminal-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#818cf8' }}>1,000</div>
          <div style={{ fontSize: 13, color: '#6b6b80' }}>Simulations Run</div>
        </div>
      </div>

      {/* Chart */}
      <div className="terminal-card" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
          Probability Fan &mdash; Wealth Trajectory 2026&ndash;2032
        </div>
        <MonteCarloChart data={result.chartData} />
      </div>

      {/* Sliders */}
      <div className="terminal-card">
        <div style={{ fontSize: 12, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 20 }}>
          Scenario Parameters
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {sliders.map(({ key, label, min, max, step, format }) => (
            <div key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: '#b0b0c0' }}>{label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#c9a84c' }}>
                  {format(params[key])}
                </span>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={params[key]}
                onChange={e => setParams(p => ({ ...p, [key]: parseFloat(e.target.value) }))}
                style={{ width: '100%', accentColor: '#c9a84c' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b6b80', marginTop: 4 }}>
                <span>{format(min)}</span>
                <span>{format(max)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      </ErrorBoundary>
    </AppShell>
  );
}
