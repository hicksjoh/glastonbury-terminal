'use client';
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Sidebar } from './Sidebar';
import { NotificationBell } from '@/components/NotificationBell';
import { RegimeBadge } from '@/components/RegimeBadge';
import { ShortcutsHelp } from '@/components/ShortcutsHelp';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

const MarketTickerBar = dynamic(() => import('@/components/MarketTickerBar'), { ssr: false });

export function AppShell({ children }: { children: React.ReactNode }) {
  useKeyboardShortcuts();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#08080d' }}>
      <MarketTickerBar />
      <div style={{ display: 'flex', flex: 1 }}>
        {isMobile && (
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle navigation"
            aria-expanded={sidebarOpen}
            style={{
              position: 'fixed', top: 12, left: 12, zIndex: 60,
              padding: '8px 10px', borderRadius: 8,
              background: 'rgba(26,26,36,0.95)', border: '1px solid #2a2a3a',
              color: '#e8e8e8', fontSize: 18, cursor: 'pointer',
              backdropFilter: 'blur(8px)',
            }}
          >
            {sidebarOpen ? '✕' : '☰'}
          </button>
        )}
        {isMobile && sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 39,
              background: 'rgba(0,0,0,0.5)',
            }}
          />
        )}
        <Sidebar isOpen={sidebarOpen} isMobile={isMobile} onClose={() => setSidebarOpen(false)} />
        <main id="main-content" tabIndex={-1} role="main" style={{ flex: 1, marginLeft: isMobile ? 0 : 220, overflowY: 'auto' }}>
          {/* Top bar with regime badge and notifications */}
          <div style={{
            display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12,
            padding: isMobile ? '12px 16px 0' : '12px 40px 0', position: 'sticky', top: 0, zIndex: 50,
            paddingTop: isMobile ? 48 : undefined,
          }}>
            <RegimeBadge />
            <NotificationBell />
          </div>
          <div style={{ padding: isMobile ? '16px 16px 32px' : '16px 40px 32px' }}>
            {children}
          </div>
        </main>
      </div>
      <ShortcutsHelp />
    </div>
  );
}
