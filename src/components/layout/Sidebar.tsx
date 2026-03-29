'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, TrendingUp, BarChart3, MessageSquare, Zap } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/strategies', label: 'Strategies', icon: TrendingUp },
  { href: '/monte-carlo', label: 'Monte Carlo', icon: BarChart3 },
  { href: '/keisha', label: 'Keisha AI', icon: MessageSquare },
  { href: '/trading', label: 'Trading', icon: Zap },
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
      <div style={{ marginBottom: 40, paddingLeft: 8 }}>
        <div style={{ color: '#c9a84c', fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em' }}>G</div>
        <div style={{ color: '#e8e8e8', fontSize: 13, fontWeight: 600 }}>Glastonbury Terminal</div>
        <div style={{ color: '#6b6b80', fontSize: 11, marginTop: 2 }}>THE GLASTONBURY GROUP</div>
      </div>
      {/* Nav */}
      <nav style={{ flex: 1 }}>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
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
                marginBottom: 4,
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
      </nav>
      {/* Footer */}
      <div style={{ color: '#6b6b80', fontSize: 11, paddingLeft: 8 }}>
        <div>Paper Trading Active</div>
        <div style={{ color: '#2a2a3a', fontSize: 10, marginTop: 4 }}>v0.1.0 &bull; 2026</div>
      </div>
    </aside>
  );
}
