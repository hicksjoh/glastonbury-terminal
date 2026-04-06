'use client';
import dynamic from 'next/dynamic';
import { Sidebar } from './Sidebar';
import { NotificationBell } from '@/components/NotificationBell';
import { RegimeBadge } from '@/components/RegimeBadge';
import { ShortcutsHelp } from '@/components/ShortcutsHelp';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

const MarketTickerBar = dynamic(() => import('@/components/MarketTickerBar'), { ssr: false });

export function AppShell({ children }: { children: React.ReactNode }) {
  useKeyboardShortcuts();

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
      <ShortcutsHelp />
    </div>
  );
}
