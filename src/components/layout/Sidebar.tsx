'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, TrendingUp, BarChart3, MessageSquare, Zap, Newspaper, Star, Grid3X3, CalendarDays, ScanSearch } from 'lucide-react';

const NAV_SECTIONS = [
  {
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'MARKETS',
    items: [
      { href: '/news', label: 'News', icon: Newspaper },
      { href: '/watchlist', label: 'Watchlist', icon: Star },
      { href: '/sectors', label: 'Sectors', icon: Grid3X3 },
      { href: '/calendar', label: 'Calendar', icon: CalendarDays },
    ],
  },
  {
    label: 'TOOLS',
    items: [
      { href: '/trading', label: 'Trading', icon: Zap },
      { href: '/trading/options/screener', label: 'Screener', icon: ScanSearch },
      { href: '/strategies', label: 'Strategies', icon: TrendingUp },
      { href: '/monte-carlo', label: 'Monte Carlo', icon: BarChart3 },
      { href: '/keisha', label: 'Keisha AI', icon: MessageSquare },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside style={{
      width: 220,
      minHeight: '100vh',
      backgroundColor: '#1a1a24',
      borderRight: '1px solid #2a2a3a',
      display: 'flex',
      flexDirection: 'column',
      padding: '24px 16px',
      position: 'fixed',
      left: 0,
      top: 0,
    }}>
      {/* Logo */}
      <div style={{ marginBottom: 32, paddingLeft: 8 }}>
        <div style={{ color: '#c9a84c', fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em' }}>G</div>
        <div style={{ color: '#e8e8e8', fontSize: 13, fontWeight: 600 }}>Glastonbury Terminal</div>
        <div style={{ color: '#6b6b80', fontSize: 11, marginTop: 2 }}>THE GLASTONBURY GROUP</div>
      </div>
      {/* Nav */}
      <nav style={{ flex: 1 }}>
        {NAV_SECTIONS.map((section, si) => (
          <div key={si} style={{ marginBottom: 8 }}>
            {section.label && (
              <div style={{
                color: '#444',
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                padding: '8px 12px 4px',
              }}>
                {section.label}
              </div>
            )}
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 8,
                    marginBottom: 2,
                    textDecoration: 'none',
                    backgroundColor: active ? 'rgba(201, 168, 76, 0.1)' : 'transparent',
                    color: active ? '#c9a84c' : '#6b6b80',
                    transition: 'all 0.15s',
                    fontSize: 14,
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <Icon size={16} />
                  {label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      {/* Footer */}
      <div style={{ color: '#6b6b80', fontSize: 11, paddingLeft: 8 }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: 'rgba(138, 92, 246, 0.1)',
          border: '1px solid rgba(138, 92, 246, 0.2)',
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 10,
          color: '#8a5cf6',
          marginBottom: 8,
          cursor: 'default',
        }}>
          Cmd+K Search
        </div>
        <div>Paper Trading Active</div>
        <div style={{ color: '#2a2a3a', fontSize: 10, marginTop: 4 }}>v0.2.0 &bull; 2026</div>
      </div>
    </aside>
  );
}
