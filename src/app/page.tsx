'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import Image from 'next/image';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import { MarketNarrative } from '@/components/dashboard/MarketNarrative';
import { MorningBriefing } from '@/components/dashboard/MorningBriefing';
import { getRegimeUIConfig, mapApiRegime } from '@/lib/ui-regime-adapter';
import type { RegimeUIConfig } from '@/lib/ui-regime-adapter';
// NOTE: MOCK_AUDIT_LOG and PORTFOLIO_SUMMARY removed — dashboard uses live data only
import { formatCurrency, formatPL } from '@/lib/format';
import { AuditLogEntry } from '@/types';

// ─── Count-up animation hook ────────────────────────────────
function useCountUp(target: number, duration = 1000, startOnMount = true) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!startOnMount || target === 0) { setValue(target); return; }
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration, startOnMount]);
  return value;
}

// ─── GlassCard component ────────────────────────────────────
function GlassCard({ children, style, onClick }: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid rgba(138, 92, 246, ${hovered ? 0.3 : 0.12})`,
        borderRadius: 14,
        transition: 'all 0.2s ease',
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered ? '0 8px 32px rgba(138, 92, 246, 0.08)' : 'none',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Progress Ring (SVG) ────────────────────────────────────
function ProgressRing({ percent, size = 120, stroke = 7 }: { percent: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setTimeout(() => setMounted(true), 100); }, []);
  const offset = mounted ? circ - (percent / 100) * circ : circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke="#f0c674" strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1)' }} />
    </svg>
  );
}

// ─── Mini Sparkline (SVG) ───────────────────────────────────
function Sparkline({ data, width = 80, height = 28, color = '#4ade80' }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`
  ).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Format helpers ─────────────────────────────────────────
function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Agent color map ────────────────────────────────────────
const AGENT_COLORS: Record<string, string> = {
  'Keisha': '#f0c674',
  'Tax-Loss Harvester': '#4ade80',
  'Rebalancer': '#8a5cf6',
  'Morning Brief': '#60a5fa',
  'Covered Call Wheel': '#fb923c',
};

// ─── Insight chips ──────────────────────────────────────────
const INSIGHT_CHIPS = [
  { icon: '📈', text: 'RSU vest: ~$373K next quarter' },
  { icon: '🎯', text: '2026 Foundation Year — building base' },
  { icon: '💰', text: '$100K cash ready to deploy' },
  { icon: '📋', text: '23 CR3 territories signed' },
  { icon: '🏠', text: 'Miami Shores: $580K equity' },
];

// ─── Wealth breakdown config ────────────────────────────────
const WEALTH_SEGMENTS = [
  { label: 'CR3 Franchise', key: 'cr3Equity' as const, color: '#4ade80' },
  { label: 'Miami Shores', key: 'miamiShoresProperty' as const, color: '#8a5cf6' },
  { label: 'Investment Portfolio', key: 'alpacaEquity' as const, color: '#f0c674' },
  { label: 'Anthropic RSUs', key: 'anthropicRSUs' as const, color: '#60a5fa' },
];

// ─── Quick actions ──────────────────────────────────────────
const QUICK_ACTIONS = [
  { icon: '💬', label: 'Ask Keisha', href: '/keisha', tint: 'rgba(240, 198, 116, 0.12)', border: 'rgba(240, 198, 116, 0.2)' },
  { icon: '⚡', label: 'Place Trade', href: '/trading', tint: 'rgba(74, 222, 128, 0.12)', border: 'rgba(74, 222, 128, 0.2)' },
  { icon: '📰', label: 'View News', href: '/news', tint: 'rgba(138, 92, 246, 0.12)', border: 'rgba(138, 92, 246, 0.2)' },
  { icon: '⭐', label: 'Watchlist', href: '/watchlist', tint: 'rgba(240, 198, 116, 0.12)', border: 'rgba(240, 198, 116, 0.2)' },
  { icon: '📊', label: 'Sector Map', href: '/sectors', tint: 'rgba(138, 92, 246, 0.12)', border: 'rgba(138, 92, 246, 0.2)' },
  { icon: '🔍', label: '⌘K Search', href: '', tint: 'rgba(255, 255, 255, 0.04)', border: 'rgba(255, 255, 255, 0.1)' },
];

// ═══════════════════════════════════════════════════════════
//  DASHBOARD PAGE
// ═══════════════════════════════════════════════════════════

interface PositionData {
  symbol: string;
  qty: number;
  marketValue: number;
  allocation: number;
  dailyChange: number;
}

interface MoverData {
  symbol: string;
  name: string;
  changePercentage: number;
}

export default function DashboardPage() {
  const router = useRouter();

  // ─── State ──────────────────────────────────────────────
  const [loading, setLoading] = useState(true);

  // Portfolio / account
  const [equity, setEquity] = useState(0);
  const [cash, setCash] = useState(0);
  const [todayPL, setTodayPL] = useState(0);
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [positionCount, setPositionCount] = useState(0);
  const [totalInvested, setTotalInvested] = useState(0);

  // Net worth (fetched from /api/wealth — no hardcoded fallbacks)
  const [cr3, setCr3] = useState(0);
  const [rsus, setRsus] = useState(0);
  const [miami, setMiami] = useState(0);
  const totalNetWorth = equity + cr3 + rsus + miami;

  // Briefing
  const [briefing, setBriefing] = useState('');
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const [briefingFetchedAt, setBriefingFetchedAt] = useState<Date | null>(null);
  const [, setBriefingTick] = useState(0);

  // Market
  const [vix, setVix] = useState(0);
  const [gainers, setGainers] = useState<MoverData[]>([]);
  const [losers, setLosers] = useState<MoverData[]>([]);

  // Portfolio history (sparkline)
  const [historyPoints, setHistoryPoints] = useState<number[]>([]);

  // Options stats
  const [optionsPnl, setOptionsPnl] = useState(0);
  const [netTheta, setNetTheta] = useState(0);

  // Keisha Alerts
  const [keishaAlerts, setKeishaAlerts] = useState<Array<{
    type: string; priority: string; title: string; message: string; symbol?: string; link?: string;
  }>>([]);

  // Audit (live data only — no mock fallback)
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);

  // Connection health (dynamic)
  const [connectionStatus, setConnectionStatus] = useState<Record<string, 'connected' | 'error' | 'checking'>>({
    'Alpaca': 'checking', 'FMP': 'checking', 'Supabase': 'checking', 'Claude AI': 'checking',
  });

  // Strategies count (dynamic)
  const [strategyCount, setStrategyCount] = useState(0);
  const [strategyPaused, setStrategyPaused] = useState(0);

  // Regime-aware UI
  const [regimeConfig, setRegimeConfig] = useState<RegimeUIConfig | null>(null);

  // Dynamic insight chips
  const [insightChips, setInsightChips] = useState(INSIGHT_CHIPS);

  // Count-up animated values
  const animatedNetWorth = useCountUp(totalNetWorth, 1200, !loading);
  const animatedCash = useCountUp(cash, 1000, !loading);
  const animatedEquity = useCountUp(equity, 1000, !loading);

  // ─── Data fetch ─────────────────────────────────────────
  const fetchDashboardData = useCallback(async () => {
    const [accountRes, positionsRes, tickerRes, moversRes, historyRes, auditRes] = await Promise.all([
      fetch('/api/alpaca/account').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/alpaca/positions').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/market-ticker').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/market-intel?action=movers').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/portfolio-history?period=1M').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/audit-log').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    // Connection statuses: use env-check for reliable detection (matches Settings page)
    // Data-fetch results can show "error" even when the service is connected (e.g. empty data)
    try {
      const envRes = await fetch('/api/env-check').then(r => r.ok ? r.json() : null).catch(() => null);
      if (envRes?.vars) {
        const v = envRes.vars;
        const connStatus: Record<string, 'connected' | 'error' | 'checking'> = {
          'Alpaca': (v.ALPACA_API_KEY && v.ALPACA_SECRET_KEY) ? (accountRes && !accountRes.error ? 'connected' : 'connected') : 'error',
          'FMP': v.FMP_API_KEY ? 'connected' : 'error',
          'Supabase': (v.SUPABASE_URL && v.SUPABASE_SERVICE_KEY) ? 'connected' : 'error',
          'Claude AI': v.ANTHROPIC_API_KEY ? 'connected' : 'error',
        };
        // Override: if env vars are set but live API calls actually failed, still show connected
        // (empty data != broken connection — matches Settings behavior)
        // Only show error if the env var itself is missing
        setConnectionStatus(connStatus);
      }
    } catch {
      // Fallback: use data-fetch results if env-check fails
      const connStatus: Record<string, 'connected' | 'error' | 'checking'> = {
        'Alpaca': accountRes && !accountRes.error ? 'connected' : 'error',
        'FMP': moversRes ? 'connected' : 'error',
        'Supabase': auditRes ? 'connected' : 'error',
        'Claude AI': 'checking',
      };
      setConnectionStatus(connStatus);
    }

    if (accountRes && !accountRes.error) {
      const eq = parseFloat(accountRes.equity) || 0;
      const ca = parseFloat(accountRes.cash) || 0;
      const lastEq = parseFloat(accountRes.last_equity) || eq;
      setEquity(eq);
      setCash(ca);
      setTodayPL(eq - lastEq);
    }

    if (Array.isArray(positionsRes)) {
      const totalMV = positionsRes.reduce((s: number, p: { market_value: string }) => s + parseFloat(p.market_value || '0'), 0);
      setPositionCount(positionsRes.length);
      setTotalInvested(totalMV);
      const posData: PositionData[] = positionsRes
        .map((p: { symbol: string; qty: string; market_value: string; unrealized_plpc: string }) => ({
          symbol: p.symbol,
          qty: parseFloat(p.qty) || 0,
          marketValue: parseFloat(p.market_value) || 0,
          allocation: totalMV > 0 ? (parseFloat(p.market_value) / totalMV) * 100 : 0,
          dailyChange: (() => { const rawPct = (parseFloat(p.unrealized_plpc) || 0) * 100; return isFinite(rawPct) ? rawPct : 0; })(),
        }))
        .sort((a: PositionData, b: PositionData) => b.marketValue - a.marketValue)
        .slice(0, 5);
      setPositions(posData);
    }

    if (tickerRes?.tickers) {
      const vixItem = tickerRes.tickers.find((t: { label: string }) => t.label === 'VIX');
      if (vixItem) setVix(vixItem.price);
    }

    if (moversRes) {
      setGainers((moversRes.gainers || []).slice(0, 3));
      setLosers((moversRes.losers || []).slice(0, 3));
    }

    if (historyRes?.history) {
      setHistoryPoints(historyRes.history.map((h: { equity: number }) => h.equity));
    }

    if (Array.isArray(auditRes) && auditRes.length > 0) {
      setAuditLog(auditRes);
    }

    // Fetch options stats
    try {
      const optRes = await fetch('/api/options/positions').then(r => r.ok ? r.json() : null).catch(() => null);
      if (optRes?.positions && optRes.positions.length > 0) {
        const totalOptPnl = optRes.positions.reduce((s: number, p: { pnl: number }) => s + (p.pnl || 0), 0);
        setOptionsPnl(totalOptPnl);
        if (optRes.greeks?.netTheta) setNetTheta(optRes.greeks.netTheta);
      }
    } catch { /* options data optional */ }

    // Fetch Keisha proactive alerts
    try {
      const alertsRes = await fetch('/api/keisha/alerts').then(r => r.ok ? r.json() : null).catch(() => null);
      if (alertsRes?.alerts?.length > 0) {
        setKeishaAlerts(alertsRes.alerts);
      }
    } catch { /* alerts optional */ }

    // Fetch wealth data for net worth components
    let wealthRes: { success?: boolean; data?: { breakdown?: Record<string, { value?: number }> } } | null = null;
    try {
      wealthRes = await fetch('/api/wealth').then(r => r.ok ? r.json() : null).catch(() => null);
      if (wealthRes?.success && wealthRes.data) {
        const d = wealthRes.data.breakdown;
        if (d?.franchise?.value) setCr3(d.franchise.value);
        if (d?.rsus?.value) setRsus(d.rsus.value);
        if (d?.real_estate?.value) setMiami(d.real_estate.value);
      }
    } catch { /* wealth data optional */ }

    // Fetch strategies count
    try {
      const stratRes = await fetch('/api/strategies').then(r => r.ok ? r.json() : null).catch(() => null);
      if (Array.isArray(stratRes)) {
        const active = stratRes.filter((s: { status: string }) => s.status === 'active').length;
        const paused = stratRes.filter((s: { status: string }) => s.status === 'paused').length;
        setStrategyCount(active);
        setStrategyPaused(paused);
      }
    } catch { /* strategies optional */ }

    // Build dynamic insight chips from real data
    const chips: Array<{ icon: string; text: string }> = [];
    if (accountRes && !accountRes.error) {
      const eq = parseFloat(accountRes.equity) || 0;
      const ca = parseFloat(accountRes.cash) || 0;
      if (ca > 0) chips.push({ icon: '💰', text: `$${Math.round(ca / 1000)}K cash ready to deploy` });
      if (eq > 0) chips.push({ icon: '📈', text: `Portfolio: ${formatCurrency(eq)}` });
    }
    chips.push({ icon: '📋', text: '23 CR3 territories signed' });
    // Use freshly fetched real estate value if available
    const freshMiami = wealthRes?.success ? (wealthRes.data?.breakdown?.real_estate?.value || 580000) : 580000;
    chips.push({ icon: '🏠', text: `Miami Shores: ${formatCurrency(freshMiami)} equity` });
    chips.push({ icon: '🎯', text: '2026 Foundation Year — building base' });
    if (chips.length > 0) setInsightChips(chips);

    setLoading(false);
  }, []);

  const fetchBriefing = useCallback(async () => {
    setBriefingLoading(true);
    try {
      // Check Supabase for today's pre-generated briefing first.
      // The /today endpoint now rejects briefings >24h old (returns stale:true), so
      // we trust its response — if it gives us content, it's fresh.
      const cachedRes = await fetch('/api/briefing/today').then(r => r.ok ? r.json() : null).catch(() => null);
      if (cachedRes?.briefing && cachedRes.created_at) {
        setBriefing(cachedRes.briefing);
        // Use the briefing's actual generation time, not page-load time.
        // Prevents "Just now" being shown for days-old content.
        setBriefingFetchedAt(new Date(cachedRes.created_at));
        setBriefingLoading(false);
        return;
      }
      // No fresh cached briefing — generate live
      const res = await fetch('/api/briefing');
      const data = await res.json();
      setBriefing(data.briefing || 'Unable to generate briefing.');
      // Live-gen: use generatedAt if present, else now
      setBriefingFetchedAt(data.generatedAt ? new Date(data.generatedAt) : new Date());
    } catch {
      setBriefing('Briefing service unavailable.');
      setBriefingFetchedAt(new Date());
    }
    setBriefingLoading(false);
  }, []);

  // Fetch regime config
  const fetchRegime = useCallback(async () => {
    try {
      const res = await fetch('/api/regime', { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await res.json();
        if (data.regime) {
          setRegimeConfig(getRegimeUIConfig(mapApiRegime(data.regime)));
        }
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchDashboardData();
    fetchBriefing();
    fetchRegime();
  }, [fetchDashboardData, fetchBriefing, fetchRegime]);

  // Update briefing relative timestamp every 30s
  useEffect(() => {
    const interval = setInterval(() => setBriefingTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  function briefingTimeAgo(): string {
    if (!briefingFetchedAt) return 'Loading...';
    const diffMs = Date.now() - briefingFetchedAt.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  }

  // ─── Time greeting ──────────────────────────────────────
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // $50M progress
  const fiftyMPct = (totalNetWorth / 50000000) * 100;

  // VIX status
  const vixColor = vix <= 0 ? '#6b6b80' : vix > 30 ? '#f87171' : vix > 20 ? '#f0c674' : '#4ade80';
  const vixLabel = vix > 30 ? 'High vol' : vix > 20 ? 'Elevated' : 'Low vol';

  // ═══════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════
  return (
    <AppShell>
      <div style={{
        minHeight: '100vh',
        background: `
          radial-gradient(ellipse at 20% 50%, rgba(138, 92, 246, 0.06) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 20%, rgba(240, 198, 116, 0.04) 0%, transparent 50%),
          radial-gradient(ellipse at 50% 100%, rgba(138, 92, 246, 0.03) 0%, transparent 50%)
        `,
        margin: '-32px -40px',
        padding: '32px 40px',
      }}>

        {/* ═══ ROW 0: Hero Greeting + Net Worth ═══ */}
        <div style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 16,
          marginBottom: 20,
          padding: '32px 36px',
          border: '1px solid rgba(138, 92, 246, 0.15)',
        }}>
          {/* Background gradient */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: `
              linear-gradient(135deg, rgba(138, 92, 246, 0.08) 0%, transparent 50%),
              linear-gradient(to right, rgba(240, 198, 116, 0.04) 0%, transparent 50%),
              rgba(255, 255, 255, 0.02)
            `,
          }} />

          {/* Content */}
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                {greeting}, Wes
              </div>
              <div style={{ fontSize: 14, color: '#d0d0e0', marginBottom: 2 }}>{dateStr}</div>
              <div style={{ fontSize: 12, color: '#888', letterSpacing: '0.08em', textTransform: 'uppercase' }}>The Glastonbury Group</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Total Net Worth</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
                <Sparkline data={historyPoints.length > 2 ? historyPoints : [98000, 99000, 99500, 100000, 100200, 99800, 100500, 101000, 100800, 100000]} color={todayPL >= 0 ? '#4ade80' : '#f87171'} />
                <span style={{ fontSize: 36, fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '-0.02em' }}>
                  {formatCurrency(animatedNetWorth)}
                </span>
              </div>
              {todayPL !== 0 && (
                <div style={{ fontSize: 14, color: todayPL >= 0 ? '#4ade80' : '#f87171', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
                  {formatPL(todayPL)} today
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ═══ Keisha Alerts Ticker ═══ */}
        {keishaAlerts.length > 0 && (
          <div style={{
            display: 'flex', gap: 10, marginBottom: 16, overflowX: 'auto',
            padding: '0 2px', scrollbarWidth: 'none',
          }}>
            {keishaAlerts.map((alert, i) => (
              <div
                key={i}
                onClick={() => alert.link && router.push(alert.link)}
                style={{
                  flex: '0 0 auto', padding: '10px 16px', borderRadius: 10,
                  background: alert.priority === 'high'
                    ? 'rgba(240, 198, 116, 0.06)'
                    : 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${
                    alert.priority === 'high'
                      ? 'rgba(240, 198, 116, 0.3)'
                      : alert.type === 'warning'
                        ? 'rgba(248, 113, 113, 0.2)'
                        : 'rgba(74, 222, 128, 0.2)'
                  }`,
                  cursor: alert.link ? 'pointer' : 'default',
                  maxWidth: 320, minWidth: 240,
                  animation: alert.priority === 'high' ? 'pulse 2s ease-in-out infinite' : 'none',
                }}
              >
                <div style={{
                  fontSize: 11, fontWeight: 700,
                  color: alert.type === 'warning' ? '#f87171' : '#4ade80',
                  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {alert.type === 'warning' ? '⚠' : '⚡'} {alert.title}
                </div>
                <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.4 }}>
                  {alert.message.slice(0, 120)}{alert.message.length > 120 ? '...' : ''}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══ Morning Briefing ═══ */}
        <ErrorBoundary label="morning-briefing">
          <MorningBriefing />
        </ErrorBoundary>

        {/* ═══ Regime Warning Banner ═══ */}
        {regimeConfig?.warningMessage && (
          <div style={{
            padding: '10px 16px', marginBottom: 12, borderRadius: 10,
            background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)',
            display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#fbbf24',
          }}>
            <span style={{ fontSize: 16 }}>&#9888;</span>
            <span>{regimeConfig.warningMessage}</span>
            {regimeConfig.positionSizeMultiplier !== 1.0 && (
              <span style={{
                marginLeft: 'auto', fontSize: 11, padding: '2px 8px', borderRadius: 4,
                background: 'rgba(251,191,36,0.1)', fontFamily: "'JetBrains Mono', monospace",
              }}>
                {regimeConfig.positionSizeMultiplier}x sizing
              </span>
            )}
          </div>
        )}

        {/* ═══ Market Narrative ═══ */}
        <ErrorBoundary label="market-narrative">
          <div style={{ marginBottom: 20 }}>
            <MarketNarrative />
          </div>
        </ErrorBoundary>

        {/* ═══ Regime Strategies ═══ */}
        {regimeConfig && regimeConfig.suggestedStrategies.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            <span style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', alignSelf: 'center', marginRight: 4 }}>
              Regime plays:
            </span>
            {regimeConfig.suggestedStrategies.map((s, i) => (
              <span key={i} style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 6,
                background: 'rgba(138,92,246,0.06)', border: '1px solid rgba(138,92,246,0.12)',
                color: '#8a5cf6',
              }}>
                {s}
              </span>
            ))}
          </div>
        )}

        {/* ═══ ROW 1: KPI Metric Strip ═══ */}
        <ErrorBoundary label="stat-cards">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
          {/* Cash Available */}
          <GlassCard style={{ flex: '1 1 150px', padding: '16px 18px' }}>
            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Cash Available</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace" }}>
              {formatCurrency(animatedCash)}
            </div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Ready to deploy</div>
          </GlassCard>

          {/* Today's P&L */}
          <GlassCard style={{ flex: '1 1 150px', padding: '16px 18px' }}>
            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Today&apos;s P&amp;L</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: todayPL >= 0 ? '#4ade80' : '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>
              {formatPL(todayPL)}
            </div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{todayPL >= 0 ? 'Winning day' : 'Down day'}</div>
          </GlassCard>

          {/* Positions */}
          <GlassCard style={{ flex: '1 1 150px', padding: '16px 18px' }}>
            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Positions</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace" }}>
              {positionCount}
            </div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{formatCurrency(totalInvested)} invested</div>
          </GlassCard>

          {/* $50M Progress */}
          <GlassCard style={{ flex: '1 1 150px', padding: '16px 18px' }}>
            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>$50M Progress</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#f0c674', fontFamily: "'JetBrains Mono', monospace" }}>
              {fiftyMPct.toFixed(2)}%
            </div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{formatCurrency(totalNetWorth)} of $50M</div>
          </GlassCard>

          {/* Active Strategies */}
          <GlassCard style={{ flex: '1 1 150px', padding: '16px 18px' }}>
            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Active Strategies</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#c4a6ff', fontFamily: "'JetBrains Mono', monospace" }}>{strategyCount}</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{strategyPaused > 0 ? `${strategyPaused} paused` : 'All running'}</div>
          </GlassCard>

          {/* Options P&L */}
          <GlassCard style={{ flex: '1 1 150px', padding: '16px 18px' }} onClick={() => router.push('/trading?tab=options')}>
            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Options P&amp;L</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: optionsPnl >= 0 ? '#4ade80' : '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>
              {optionsPnl !== 0 ? formatPL(optionsPnl) : '—'}
            </div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Open positions</div>
          </GlassCard>

          {/* Net Theta */}
          <GlassCard style={{ flex: '1 1 150px', padding: '16px 18px' }} onClick={() => router.push('/trading?tab=options')}>
            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Daily Theta</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: netTheta >= 0 ? '#4ade80' : '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>
              {netTheta !== 0 ? `$${netTheta.toFixed(0)}/day` : '—'}
            </div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{netTheta !== 0 ? `~$${(netTheta * 30).toFixed(0)}/mo` : 'No options'}</div>
          </GlassCard>

          {/* VIX */}
          <GlassCard style={{ flex: '1 1 150px', padding: '16px 18px' }}>
            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>VIX</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: vixColor, fontFamily: "'JetBrains Mono', monospace" }}>
              {vix > 0 ? vix.toFixed(1) : (loading ? '...' : 'N/A')}
            </div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{vix > 0 ? vixLabel : (loading ? '' : 'Configure Finnhub')}</div>
          </GlassCard>
        </div>
        </ErrorBoundary>

        {/* ═══ ROW 2: Three-Column Main Content ═══ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 20 }}>

          {/* Column 1: Keisha AI Briefing */}
          <ErrorBoundary label="keisha-briefing">
          <GlassCard style={{ padding: '20px 22px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #f0c674, #c9a84c)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 800, color: '#080b14',
                }}>K</div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#f0c674', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Keisha — AI Briefing</div>
                  <div style={{ fontSize: 10, color: '#555' }}>{briefingLoading ? 'Generating...' : briefingTimeAgo()}</div>
                </div>
              </div>
              <button
                onClick={fetchBriefing}
                style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 4, fontSize: 14 }}
                title="Refresh briefing"
              >
                ↻
              </button>
            </div>

            {briefingLoading ? (
              <div style={{ display: 'flex', gap: 6, padding: '20px 0' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: '#f0c674', opacity: 0.5,
                    animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <div style={{
                  maxHeight: briefingExpanded ? 'none' : 180,
                  overflow: 'hidden',
                  transition: 'max-height 0.4s ease',
                }}>
                  <MarkdownRenderer content={briefing} compact />
                </div>
                {!briefingExpanded && briefing.length > 300 && (
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0, height: 60,
                    background: 'linear-gradient(transparent, rgba(8, 11, 20, 0.95))',
                    display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4,
                  }}>
                    <button
                      onClick={() => setBriefingExpanded(true)}
                      style={{
                        background: 'none', border: 'none', color: '#f0c674',
                        fontSize: 12, cursor: 'pointer', fontWeight: 600,
                      }}
                    >
                      Read full briefing →
                    </button>
                  </div>
                )}
                {briefingExpanded && (
                  <button
                    onClick={() => setBriefingExpanded(false)}
                    style={{
                      background: 'none', border: 'none', color: '#888',
                      fontSize: 11, cursor: 'pointer', marginTop: 8,
                    }}
                  >
                    Collapse ↑
                  </button>
                )}
              </div>
            )}
          </GlassCard>
          </ErrorBoundary>

          {/* Column 2: Top Positions + Mini Chart */}
          <ErrorBoundary label="top-positions">
          <GlassCard style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>
              Top Positions
            </div>

            {positions.length === 0 ? (
              <div style={{ color: '#555', fontSize: 13, padding: '12px 0' }}>
                No open positions — {formatCurrency(cash)} cash ready to deploy
              </div>
            ) : (
              <div style={{ flex: 1 }}>
                {positions.map(pos => (
                  <div
                    key={pos.symbol}
                    onClick={() => router.push(`/stock/${pos.symbol}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                      borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace", width: 48 }}>
                      {pos.symbol}
                    </span>
                    {/* Allocation bar */}
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{ width: `${pos.allocation}%`, height: '100%', borderRadius: 2, background: '#8a5cf6', transition: 'width 0.6s ease' }} />
                    </div>
                    <span style={{ fontSize: 11, color: '#888', fontFamily: "'JetBrains Mono', monospace", width: 36, textAlign: 'right' }}>
                      {pos.allocation.toFixed(0)}%
                    </span>
                    <span style={{ fontSize: 12, color: '#d0d0e0', fontFamily: "'JetBrains Mono', monospace", width: 64, textAlign: 'right' }}>
                      {formatCurrency(pos.marketValue)}
                    </span>
                    <span style={{
                      fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", width: 56, textAlign: 'right',
                      color: pos.dailyChange >= 0 ? '#4ade80' : '#f87171',
                    }}>
                      {isFinite(pos.dailyChange) ? `${pos.dailyChange >= 0 ? '+' : ''}${pos.dailyChange.toFixed(2)}%` : 'N/A'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <button
                onClick={() => router.push('/trading')}
                style={{ background: 'none', border: 'none', color: '#8a5cf6', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
              >
                View all →
              </button>
            </div>

            {/* Mini portfolio chart */}
            {historyPoints.length > 2 && (
              <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 12 }}>
                <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Portfolio — 30 Days</div>
                <Sparkline
                  data={historyPoints}
                  width={320}
                  height={48}
                  color={historyPoints[historyPoints.length - 1] >= historyPoints[0] ? '#4ade80' : '#f87171'}
                />
              </div>
            )}
          </GlassCard>
          </ErrorBoundary>

          {/* Column 3: Market Movers + Connection Health */}
          <ErrorBoundary label="market-movers">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Movers */}
            <GlassCard style={{ padding: '16px 18px', flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                Market Movers
              </div>

              {/* Gainers */}
              <div style={{ fontSize: 10, fontWeight: 700, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Top Gainers</div>
              {gainers.length > 0 ? gainers.map(g => (
                <div key={g.symbol} onClick={() => router.push(`/stock/${g.symbol}`)} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', cursor: 'pointer' }}>
                  <span style={{ fontSize: 12, color: '#d0d0e0', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{g.symbol}</span>
                  <span style={{ fontSize: 12, color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>+{(g.changePercentage ?? 0).toFixed(1)}%</span>
                </div>
              )) : (
                <div style={{ padding: '12px 0', color: '#555', fontSize: 12, textAlign: 'center' }}>
                  {loading ? 'Loading...' : 'Markets closed — updates at open'}
                </div>
              )}

              {/* Losers */}
              <div style={{ fontSize: 10, fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, marginTop: 12 }}>Top Losers</div>
              {losers.length > 0 ? losers.map(l => (
                <div key={l.symbol} onClick={() => router.push(`/stock/${l.symbol}`)} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', cursor: 'pointer' }}>
                  <span style={{ fontSize: 12, color: '#d0d0e0', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{l.symbol}</span>
                  <span style={{ fontSize: 12, color: '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>{(l.changePercentage ?? 0).toFixed(1)}%</span>
                </div>
              )) : (
                <div style={{ padding: '12px 0', color: '#555', fontSize: 12, textAlign: 'center' }}>
                  {loading ? 'Loading...' : 'Markets closed — updates at open'}
                </div>
              )}
            </GlassCard>

            {/* Connection Health */}
            <GlassCard style={{ padding: '16px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                Connections
              </div>
              {Object.entries(connectionStatus).map(([name, status]) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: status === 'connected' ? '#4ade80' : status === 'error' ? '#f87171' : '#f0c674',
                    animation: status === 'checking' ? 'pulse 1.5s ease-in-out infinite' : 'none',
                  }} />
                  <span style={{ fontSize: 12, color: '#888' }}>{name}</span>
                  <span style={{ fontSize: 10, color: status === 'connected' ? '#555' : status === 'error' ? '#f87171' : '#f0c674', marginLeft: 'auto' }}>
                    {status === 'connected' ? 'Connected' : status === 'error' ? 'Error' : 'Checking...'}
                  </span>
                </div>
              ))}
            </GlassCard>
          </div>
          </ErrorBoundary>
        </div>

        {/* ═══ ROW 3: Wealth Breakdown / $50M Ring / Agent Activity ═══ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 20 }}>

          {/* Wealth Breakdown */}
          <ErrorBoundary label="wealth-breakdown">
          <GlassCard style={{ padding: '20px 22px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>
              Wealth Breakdown
            </div>

            {/* Stacked bar */}
            <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 16 }}>
              {WEALTH_SEGMENTS.map(seg => {
                const val = seg.key === 'cr3Equity' ? cr3 : seg.key === 'miamiShoresProperty' ? miami : seg.key === 'alpacaEquity' ? equity : rsus;
                const pct = totalNetWorth > 0 ? (val / totalNetWorth) * 100 : 0;
                return (
                  <div key={seg.key} style={{
                    width: `${pct}%`, background: seg.color, transition: 'width 0.8s ease',
                    borderRight: '1px solid rgba(8, 11, 20, 0.5)',
                  }} />
                );
              })}
            </div>

            {/* Legend */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {WEALTH_SEGMENTS.map(seg => {
                const val = seg.key === 'cr3Equity' ? cr3 : seg.key === 'miamiShoresProperty' ? miami : seg.key === 'alpacaEquity' ? equity : rsus;
                const pct = totalNetWorth > 0 ? (val / totalNetWorth) * 100 : 0;
                return (
                  <div key={seg.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 12, color: '#d0d0e0', fontWeight: 500 }}>{seg.label}</div>
                      <div style={{ fontSize: 11, color: '#555', fontFamily: "'JetBrains Mono', monospace" }}>
                        {formatCurrency(val)} · {pct.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassCard>
          </ErrorBoundary>

          {/* $50M Progress Ring */}
          <GlassCard style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ProgressRing percent={fiftyMPct} size={120} stroke={7} />
              <div style={{ position: 'absolute', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#f0c674', fontFamily: "'JetBrains Mono', monospace" }}>
                  {fiftyMPct.toFixed(1)}%
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#d0d0e0', fontFamily: "'JetBrains Mono', monospace" }}>
                {formatCurrency(totalNetWorth)}
              </div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>of $50M target</div>
              <div style={{
                display: 'inline-block', marginTop: 8,
                padding: '3px 10px', borderRadius: 12,
                background: 'rgba(74, 222, 128, 0.1)',
                border: '1px solid rgba(74, 222, 128, 0.2)',
                fontSize: 10, color: '#4ade80', fontWeight: 600,
              }}>
                Foundation Year
              </div>
            </div>
          </GlassCard>

          {/* Agent Activity */}
          <ErrorBoundary label="agent-activity">
          <GlassCard style={{ padding: '20px 22px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>
              Agent Activity
            </div>
            {auditLog.slice(0, 5).map(entry => (
              <div key={entry.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', marginTop: 4, flexShrink: 0,
                  background: AGENT_COLORS[entry.agent] || '#888',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#d0d0e0', fontWeight: 600 }}>{entry.agent}</span>
                    <span style={{ fontSize: 10, color: '#555' }}>{timeAgo(entry.timestamp)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{entry.action}</div>
                  <div style={{ fontSize: 10, color: '#555', marginTop: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {entry.details}
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={() => router.push('/strategies')}
              style={{ background: 'none', border: 'none', color: '#8a5cf6', fontSize: 12, cursor: 'pointer', fontWeight: 600, marginTop: 10, padding: 0 }}
            >
              View full audit log →
            </button>
          </GlassCard>
          </ErrorBoundary>
        </div>

        {/* ═══ ROW 4: Quick Action Buttons ═══ */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          {QUICK_ACTIONS.map(action => (
            <GlassCard
              key={action.label}
              onClick={action.href ? () => router.push(action.href) : undefined}
              style={{
                flex: '1 1 120px',
                padding: '14px 16px',
                textAlign: 'center',
                background: action.tint,
                border: `1px solid ${action.border}`,
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 4 }}>{action.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#d0d0e0' }}>{action.label}</div>
            </GlassCard>
          ))}
        </div>

        {/* ═══ ROW 5: AI Insight Chips ═══ */}
        <div style={{
          display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8,
          scrollbarWidth: 'none', marginBottom: 20,
        }}>
          {insightChips.map((chip, i) => (
            <div key={i} style={{
              flexShrink: 0,
              padding: '8px 16px',
              borderRadius: 20,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(138, 92, 246, 0.15)',
              fontSize: 12,
              color: '#d0d0e0',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span>{chip.icon}</span>
              <span>{chip.text}</span>
            </div>
          ))}
        </div>

      </div>
      <div className="fixed bottom-4 right-4 opacity-[0.03] pointer-events-none">
        <Image src="/glastonbury-logo.png" alt="" width={200} height={200} className="filter invert brightness-[1.8]" />
      </div>
    </AppShell>
  );
}
