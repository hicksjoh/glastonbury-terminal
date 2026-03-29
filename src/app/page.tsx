import { AppShell } from '@/components/layout/AppShell';
import { NetWorthCard } from '@/components/dashboard/NetWorthCard';
import { BriefingCard } from '@/components/dashboard/BriefingCard';
import { AuditFeed } from '@/components/dashboard/AuditFeed';
import { IncomeChart } from '@/components/dashboard/IncomeChart';
import { RoadmapProgress } from '@/components/dashboard/RoadmapProgress';
import { PORTFOLIO_SUMMARY, MOCK_AUDIT_LOG } from '@/lib/data';

export default function DashboardPage() {
  return (
    <AppShell>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#e8e8e8', margin: 0 }}>Dashboard</h1>
        <p style={{ color: '#6b6b80', fontSize: 13, marginTop: 4 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>
      {/* Top row: Net Worth, Briefing, Audit Feed */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 20 }}>
        <NetWorthCard portfolio={PORTFOLIO_SUMMARY} />
        <BriefingCard />
        <AuditFeed entries={MOCK_AUDIT_LOG.slice(0, 5)} />
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
