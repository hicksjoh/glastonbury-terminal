'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAlertBadge } from '@/contexts/NotificationProvider';
import { SidebarTooltip } from './SidebarTooltip';
import { SECTION_DESCRIPTIONS, PAGE_DESCRIPTIONS } from '@/lib/sidebar-descriptions';
import {
  LayoutDashboard, TrendingUp, BarChart3, MessageSquare, Zap, Newspaper,
  Star, Grid3X3, CalendarDays, ScanSearch, Filter, Shield, ShieldCheck, Bell, Settings,
  Wallet, MapPin, DollarSign, Receipt, BookOpen, FlaskConical, Radar, Activity, Users,
  Layers, GitCompare, Globe, Target, Bot, Landmark, ChevronRight,
} from 'lucide-react';

const NAV_SECTIONS = [
  {
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/wealth', label: 'Wealth', icon: Wallet },
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
    label: 'TRADING',
    items: [
      { href: '/trading', label: 'Trading', icon: Zap },
      { href: '/trading/options/screener', label: 'Opt. Screener', icon: ScanSearch },
      { href: '/screener', label: 'Stock Screener', icon: Filter },
      { href: '/strategies', label: 'Strategies', icon: TrendingUp },
      { href: '/backtest', label: 'Backtest', icon: FlaskConical },
      { href: '/journal', label: 'Journal', icon: BookOpen },
    ],
  },
  {
    label: 'EMPIRE',
    items: [
      { href: '/territories', label: 'Territories', icon: MapPin },
      { href: '/cashflow', label: 'Cash Flow', icon: DollarSign },
      { href: '/tax', label: 'Tax Center', icon: Receipt },
    ],
  },
  {
    label: 'ALPHA ENGINE',
    items: [
      { href: '/scanner', label: 'Signal Scanner', icon: Radar },
      { href: '/flow', label: 'Options Flow', icon: Activity },
      { href: '/insider', label: 'Insider Tracker', icon: Users },
      { href: '/earnings', label: 'Earnings Intel', icon: CalendarDays },
      { href: '/simulator', label: 'P&L Simulator', icon: FlaskConical },
      { href: '/congress', label: 'Congress', icon: Landmark },
    ],
  },
  {
    label: 'QUANT LAB',
    items: [
      { href: '/gex', label: 'GEX Levels', icon: Zap },
      { href: '/vol-surface', label: 'Vol Surface', icon: Layers },
      { href: '/pairs', label: 'Pairs Trading', icon: GitCompare },
      { href: '/drift', label: 'Drift Regime', icon: TrendingUp },
      { href: '/macro', label: 'Macro Regime', icon: Globe },
      { href: '/optimizer', label: 'Optimizer', icon: Target },
      { href: '/crew', label: 'Trading Crew', icon: Users },
      { href: '/autopilot', label: 'Auto-Pilot', icon: Bot },
    ],
  },
  {
    label: 'INTELLIGENCE',
    items: [
      { href: '/risk', label: 'Risk', icon: Shield },
      { href: '/monte-carlo', label: 'Monte Carlo', icon: BarChart3 },
      { href: '/alerts', label: 'Alerts', icon: Bell },
      { href: '/keisha', label: 'Keisha AI', icon: MessageSquare },
      { href: '/guard-test', label: 'Guard Test', icon: ShieldCheck },
    ],
  },
];

// Default: MARKETS + TRADING expanded, rest collapsed
const DEFAULT_COLLAPSED: Record<string, boolean> = {
  MARKETS: false,
  TRADING: false,
  EMPIRE: true,
  'ALPHA ENGINE': true,
  'QUANT LAB': true,
  INTELLIGENCE: true,
};

function loadCollapsed(): Record<string, boolean> {
  if (typeof window === 'undefined') return DEFAULT_COLLAPSED;
  try {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved) return { ...DEFAULT_COLLAPSED, ...JSON.parse(saved) };
  } catch { /* ignore */ }
  return DEFAULT_COLLAPSED;
}

export function Sidebar({ isOpen, isMobile, onClose, compact, onToggleCompact }: {
  isOpen?: boolean;
  isMobile?: boolean;
  onClose?: () => void;
  compact?: boolean;
  onToggleCompact?: () => void;
}) {
  const pathname = usePathname();
  const alertBadge = useAlertBadge();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(DEFAULT_COLLAPSED);

  useEffect(() => {
    setCollapsed(loadCollapsed());
  }, []);

  const toggleSection = useCallback((label: string) => {
    setCollapsed(prev => {
      const next = { ...prev, [label]: !prev[label] };
      try { localStorage.setItem('sidebar-collapsed', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const isCompact = !!compact && !isMobile;
  const sidebarWidth = isCompact ? 52 : 220;

  return (
    <aside aria-label="Sidebar navigation" style={{
      width: sidebarWidth,
      minHeight: '100vh',
      backgroundColor: '#1a1a24',
      borderRight: '1px solid #2a2a3a',
      display: 'flex',
      flexDirection: 'column' as const,
      padding: isCompact ? '20px 4px' : '20px 16px',
      position: 'fixed',
      left: 0,
      top: 0,
      zIndex: 40,
      overflowY: isCompact ? 'visible' : 'auto',
      overflowX: isCompact ? 'visible' : 'hidden',
      transform: isMobile && !isOpen ? 'translateX(-100%)' : 'translateX(0)',
      transition: 'width 200ms ease, padding 200ms ease, transform 0.3s ease',
    }}>
      {/* Logo */}
      <div style={{ marginBottom: 24, paddingLeft: isCompact ? 2 : 8, overflow: 'hidden' }}>
        <Image
          src="/glastonbury-logo.png"
          alt="Glastonbury Group"
          width={isCompact ? 28 : 40}
          height={isCompact ? 28 : 40}
          className="filter invert brightness-[1.8]"
          priority
          style={{ transition: 'width 200ms ease, height 200ms ease' }}
        />
        {!isCompact && (
          <>
            <div style={{ color: '#e8e8e8', fontSize: 13, fontWeight: 600, marginTop: 6 }}>Glastonbury Terminal</div>
            <div style={{ color: '#6b6b80', fontSize: 11, marginTop: 2 }}>THE GLASTONBURY GROUP</div>
          </>
        )}
      </div>

      {/* Compact toggle button */}
      {!isMobile && onToggleCompact && (
        <button
          onClick={onToggleCompact}
          aria-label={isCompact ? 'Expand sidebar' : 'Collapse sidebar'}
          title={isCompact ? 'Expand (Cmd+B)' : 'Collapse (Cmd+B)'}
          style={{
            width: isCompact ? 32 : '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '4px 0', borderRadius: 6, marginBottom: 12,
            background: 'rgba(255,255,255,0.03)', border: '1px solid #2a2a3a',
            color: '#555', fontSize: 10, cursor: 'pointer',
            transition: 'width 200ms ease',
          }}
        >
          <ChevronRight size={12} style={{
            transform: isCompact ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 200ms ease',
          }} />
          {!isCompact && <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>Cmd+B</span>}
        </button>
      )}

      {/* Nav */}
      <nav aria-label="Main navigation" style={{ flex: 1 }}>
        {NAV_SECTIONS.map((section, si) => {
          const isCollapsed = section.label ? !!collapsed[section.label] : false;
          const hasActiveChild = section.items.some(item => pathname === item.href);

          // ── Compact Mode: icons only + flyout on hover ──
          if (isCompact) {
            return (
              <div key={si} style={{ marginBottom: 2, position: 'relative' }}>
                {section.items.map(({ href, label, icon: Icon }) => {
                  const active = pathname === href;
                  const showBadge = href === '/alerts' && alertBadge > 0;
                  return (
                    <SidebarTooltip key={href} description={PAGE_DESCRIPTIONS[href] ?? { title: label, description: '' }}>
                      <Link
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => { if (isMobile && onClose) onClose(); }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: 36, height: 36, borderRadius: 8, marginBottom: 1,
                          textDecoration: 'none', position: 'relative',
                          backgroundColor: active ? 'rgba(201, 168, 76, 0.1)' : 'transparent',
                          borderLeft: active ? '2px solid #f0c674' : '2px solid transparent',
                          color: active ? '#c9a84c' : '#6b6b80',
                          transition: 'all 0.15s',
                          margin: '0 auto 1px',
                        }}
                      >
                        <Icon size={16} />
                        {showBadge && (
                          <span style={{
                            position: 'absolute', top: 2, right: 2,
                            width: 8, height: 8, borderRadius: '50%',
                            background: '#f87171',
                          }} />
                        )}
                      </Link>
                    </SidebarTooltip>
                  );
                })}
                {/* Section divider in compact mode */}
                {section.label && si < NAV_SECTIONS.length - 1 && (
                  <div style={{ height: 1, background: '#2a2a3a', margin: '6px 8px' }} />
                )}
              </div>
            );
          }

          // ── Full Mode: collapsible sections ──
          return (
            <div key={si} style={{ marginBottom: 4 }} {...(section.label ? { role: 'group', 'aria-label': section.label } : {})}>
              {section.label && (
                <SidebarTooltip description={SECTION_DESCRIPTIONS[section.label]}>
                  <button
                    onClick={() => toggleSection(section.label!)}
                    aria-expanded={!isCollapsed}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      color: hasActiveChild ? '#666' : '#444',
                      fontSize: 9,
                      fontWeight: 600,
                      textTransform: 'uppercase' as const,
                      letterSpacing: '0.08em',
                      padding: '8px 12px 4px',
                      marginTop: 12,
                      fontFamily: "'JetBrains Mono', monospace",
                      cursor: 'pointer',
                      background: 'none',
                      border: 'none',
                      textAlign: 'left' as const,
                    }}
                  >
                    <ChevronRight
                      size={10}
                      style={{
                        transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                        transition: 'transform 150ms ease',
                        flexShrink: 0,
                      }}
                    />
                    {section.label}
                  </button>
                </SidebarTooltip>
              )}
              <div style={{
                display: 'grid',
                gridTemplateRows: isCollapsed ? '0fr' : '1fr',
                transition: 'grid-template-rows 200ms ease',
              }}>
                <div style={{ overflow: 'hidden' }}>
                  {section.items.map(({ href, label, icon: Icon }) => {
                    const active = pathname === href;
                    const showBadge = href === '/alerts' && alertBadge > 0;
                    return (
                      <SidebarTooltip key={href} description={PAGE_DESCRIPTIONS[href]}>
                        <Link
                          href={href}
                          aria-current={active ? 'page' : undefined}
                          onClick={() => { if (isMobile && onClose) onClose(); }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 12px',
                            borderRadius: 8,
                            marginBottom: 1,
                            textDecoration: 'none',
                            backgroundColor: active ? 'rgba(201, 168, 76, 0.1)' : 'transparent',
                            borderLeft: active ? '2px solid #f0c674' : '2px solid transparent',
                            color: active ? '#c9a84c' : '#6b6b80',
                            transition: 'all 0.15s',
                            fontSize: 13,
                            fontWeight: active ? 600 : 400,
                            position: 'relative',
                          }}
                        >
                          <Icon size={15} />
                          {label}
                          {showBadge && (
                            <span style={{
                              marginLeft: 'auto',
                              background: '#f87171',
                              color: '#fff',
                              fontSize: 9,
                              fontWeight: 700,
                              minWidth: 16,
                              height: 16,
                              borderRadius: 8,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: '0 4px',
                              lineHeight: 1,
                            }}>
                              {alertBadge > 9 ? '9+' : alertBadge}
                            </span>
                          )}
                        </Link>
                      </SidebarTooltip>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
        {/* Settings at bottom of nav */}
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #2a2a3a' }}>
          {isCompact ? (
            <SidebarTooltip description={PAGE_DESCRIPTIONS['/settings']}>
              <Link
                href="/settings"
                aria-current={pathname === '/settings' ? 'page' : undefined}
                onClick={() => { if (isMobile && onClose) onClose(); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 36, height: 36, borderRadius: 8, textDecoration: 'none',
                  backgroundColor: pathname === '/settings' ? 'rgba(201, 168, 76, 0.1)' : 'transparent',
                  color: pathname === '/settings' ? '#c9a84c' : '#6b6b80',
                  margin: '0 auto',
                }}
              >
                <Settings size={16} />
              </Link>
            </SidebarTooltip>
          ) : (
            <SidebarTooltip description={PAGE_DESCRIPTIONS['/settings']}>
              <Link
                href="/settings"
                aria-current={pathname === '/settings' ? 'page' : undefined}
                onClick={() => { if (isMobile && onClose) onClose(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', borderRadius: 8, textDecoration: 'none',
                  backgroundColor: pathname === '/settings' ? 'rgba(201, 168, 76, 0.1)' : 'transparent',
                  borderLeft: pathname === '/settings' ? '2px solid #f0c674' : '2px solid transparent',
                  color: pathname === '/settings' ? '#c9a84c' : '#6b6b80',
                  fontSize: 13,
                }}
              >
                <Settings size={15} />
                Settings
              </Link>
            </SidebarTooltip>
          )}
        </div>
      </nav>
      {/* Footer */}
      {!isCompact && (
        <div style={{ color: '#6b6b80', fontSize: 11, paddingLeft: 8, paddingTop: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'rgba(138, 92, 246, 0.1)', border: '1px solid rgba(138, 92, 246, 0.2)',
              borderRadius: 4, padding: '2px 8px', fontSize: 10, color: '#8a5cf6',
              cursor: 'default',
            }}>
              Cmd+K Search
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'rgba(201, 168, 76, 0.1)', border: '1px solid rgba(201, 168, 76, 0.2)',
              borderRadius: 4, padding: '2px 8px', fontSize: 10, color: '#c9a84c',
              cursor: 'default',
            }}>
              ? Shortcuts
            </div>
          </div>
          <div>Paper Trading Active</div>
          <div style={{ color: '#2a2a3a', fontSize: 10, marginTop: 4 }}>v4.0 &bull; 2026</div>
        </div>
      )}
    </aside>
  );
}
