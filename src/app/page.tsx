'use client';
import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { NetWorthCard } from '@/components/dashboard/NetWorthCard';
import { BriefingCard } from '@/components/dashboard/BriefingCard';
import { AuditFeed } from '@/components/dashboard/AuditFeed';
import { IncomeChart } from '@/components/dashboard/IncomeChart';
import { RoadmapProgress } from '@/components/dashboard/RoadmapProgress';
import { PORTFOLIO_SUMMARY, MOCK_AUDIT_LOG } from '@/lib/data';
import { Portfolio, AuditLogEntry } from '@/types';

export default function DashboardPage() {
  const [portfolio, setPortfolio] = useState<Portfolio>(PORTFOLIO_SUMMARY);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>(MOCK_AUDIT_LOG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLiveData() {
      try {
        // Fetch Alpaca account for live portfolio numbers
        const accountRes = await fetch('/api/alpaca/account');
        if (accountRes.ok) {
          const acct = await accountRes.json();
          if (!acct.error) {
            setPortfolio(prev => ({
              ...prev,
              alpacaEquity: parseFloat(acct.equity) || prev.alpacaEquity,
              alpacaCash: parseFloat(acct.cash) || prev.alpacaCash,
              totalNetWorth:
                (parseFloat(acct.equity) || prev.alpacaEquity) +
                (parseFloat(acct.cash) || prev.alpacaCash) +
                prev.cr3Equity +
                prev.anthropicRSUs +
                prev.miamiShoresProperty,
              lastUpdated: new Date().toISOString(),
            }));
          }
        }
      } catch {
        // Fall back to static data
      }

      try {
        // Fetch audit log from Supabase
        const auditRes = await fetch('/api/audit-log');
        if (auditRes.ok) {
          const entries = await auditRes.json();
          if (Array.isArray(entries) && entries.length > 0) {
            setAuditLog(entries);
          }
        }
      } catch {
        // Fall back to mock data
      }

      setLoading(false);
    }

    fetchLiveData();
  }, []);

  return (
    <AppShell>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#e8e8e8', margin: 0 }}>Dashboard</h1>
        <p style={{ color: '#6b6b80', fontSize: 13, marginTop: 4 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          {loading && <span style={{ marginLeft: 8, color: '#c9a84c' }}>&#8226; Syncing live data...</span>}
        </p>
      </div>
      {/* Top row: Net Worth, Briefing, Audit Feed */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 20 }}>
        <NetWorthCard portfolio={portfolio} />
        <BriefingCard />
        <AuditFeed entries={auditLog.slice(0, 5)} />
      </div>
      {/* Second row: Income Chart */}
      <div style={{ marginBottom: 20 }}>
        <IncomeChart />
      </div>
      {/* Full-width Roadmap */}
      <RoadmapProgress />
    </AppShell>
  );
}
