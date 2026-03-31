import { Sidebar } from './Sidebar';
import MarketTickerBar from '@/components/MarketTickerBar';
import { NotificationBell } from '@/components/NotificationBell';
import { RegimeBadge } from '@/components/RegimeBadge';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#08080d' }}>
      <MarketTickerBar />
      <div style={{ display: 'flex', flex: 1 }}>
        <Sidebar />
        <main style={{ flex: 1, marginLeft: 220, overflowY: 'auto' }}>
          {/* Top bar with regime badge and notifications */}
          <div style={{
            display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12,
            padding: '12px 40px 0', position: 'sticky', top: 0, zIndex: 50,
          }}>
            <RegimeBadge />
            <NotificationBell />
          </div>
          <div style={{ padding: '16px 40px 32px' }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
