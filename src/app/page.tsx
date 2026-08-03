'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MarketNarrative } from '@/components/dashboard/MarketNarrative';
import { MorningBriefing } from '@/components/dashboard/MorningBriefing';
import { BriefingCard } from '@/components/keisha/BriefingCard';
import {
  Card, HeroCard, MetricTile, PillBadge, StatusDot, SectionHeader,
} from '@/components/ui';
import { color, font, size as sz, space, weight, tracking, radius } from '@/lib/design-tokens';
import { getRegimeUIConfig, mapApiRegime } from '@/lib/ui-regime-adapter';
import type { RegimeUIConfig } from '@/lib/ui-regime-adapter';
import { formatCurrency, formatPL } from '@/lib/format';
import { AuditLogEntry } from '@/types';

// ─── Count-up hook (ease-out cubic) ─────────────────────────────
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

// ─── Progress Ring (SVG, gold) ─────────────────────────────────
function ProgressRing({ percent, size = 120, stroke = 7 }: { percent: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setTimeout(() => setMounted(true), 100); }, []);
  const offset = mounted ? circ - (percent / 100) * circ : circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke={color.borderFaint} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke={color.gold} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 1.5s cubic-bezier(0.16, 1, 0.3, 1)' }} />
    </svg>
  );
}

// ─── Sparkline (SVG) ────────────────────────────────────────────
function Sparkline({ data, width = 80, height = 28, stroke = color.positive }: { data: number[]; width?: number; height?: number; stroke?: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`
  ).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Helpers ────────────────────────────────────────────────────
function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Agent color map (retired the purple/blue drift) ────────────
const AGENT_COLORS: Record<string, string> = {
  'Keisha':               color.gold,
  'Tax-Loss Harvester':   color.positive,
  'Rebalancer':           color.info,
  'Morning Brief':        color.info,
  'Covered Call Wheel':   color.warning,
};

// ─── Wealth breakdown config (single-hue palette + gold + green) ─
const WEALTH_SEGMENTS = [
  { label: 'CR3 Franchise',        key: 'cr3Equity' as const,           colorToken: color.positive },
  { label: 'Miami Shores',         key: 'miamiShoresProperty' as const, colorToken: color.info },
  { label: 'Investment Portfolio', key: 'alpacaEquity' as const,        colorToken: color.gold },
  { label: 'Anthropic RSUs',       key: 'anthropicRSUs' as const,       colorToken: color.warning },
];

// ─── Quick actions — single treatment, gold accent, tone by role ─
const QUICK_ACTIONS: Array<{ icon: string; label: string; href: string; tone: 'gold' | 'positive' | 'neutral' }> = [
  { icon: '💬', label: 'Ask Keisha',   href: '/keisha',    tone: 'gold' },
  { icon: '⚡', label: 'Place Trade',  href: '/trading',   tone: 'positive' },
  { icon: '📰', label: 'View News',    href: '/news',      tone: 'neutral' },
  { icon: '⭐', label: 'Watchlist',    href: '/watchlist', tone: 'gold' },
  { icon: '📊', label: 'Sector Map',   href: '/sectors',   tone: 'neutral' },
  { icon: '🔍', label: '⌘K Search',    href: '',           tone: 'neutral' },
];

interface PositionData { symbol: string; qty: number; marketValue: number; allocation: number; dailyChange: number; }
interface MoverData { symbol: string; name: string; changePercentage: number; }

export default function DashboardPage() {
  const router = useRouter();

  // ─── State ────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);

  const [equity, setEquity] = useState(0);
  const [cash, setCash] = useState(0);
  const [todayPL, setTodayPL] = useState(0);
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [positionCount, setPositionCount] = useState(0);
  const [totalInvested, setTotalInvested] = useState(0);

  const [cr3, setCr3] = useState(0);
  const [rsus, setRsus] = useState(0);
  const [miami, setMiami] = useState(0);
  const totalNetWorth = equity + cr3 + rsus + miami;

  const [vix, setVix] = useState(0);
  const [gainers, setGainers] = useState<MoverData[]>([]);
  const [losers, setLosers] = useState<MoverData[]>([]);
  const [historyPoints, setHistoryPoints] = useState<number[]>([]);
  const [optionsPnl, setOptionsPnl] = useState(0);
  const [netTheta, setNetTheta] = useState(0);

  const [keishaAlerts, setKeishaAlerts] = useState<Array<{
    type: string; priority: string; title: string; message: string; symbol?: string; link?: string;
  }>>([]);

  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);

  const [connectionStatus, setConnectionStatus] = useState<Record<string, 'connected' | 'error' | 'checking'>>({
    'Alpaca': 'checking', 'FMP': 'checking', 'Supabase': 'checking', 'Claude AI': 'checking',
  });

  const [strategyCount, setStrategyCount] = useState(0);
  const [strategyPaused, setStrategyPaused] = useState(0);
  const [regimeConfig, setRegimeConfig] = useState<RegimeUIConfig | null>(null);
  const [insightChips, setInsightChips] = useState<Array<{ icon: string; text: string }>>([
    { icon: '📈', text: 'RSU vest: ~$373K next quarter' },
    { icon: '🎯', text: '2026 Foundation Year — building base' },
    { icon: '💰', text: '$100K cash ready to deploy' },
    { icon: '📋', text: '23 CR3 territories signed' },
    { icon: '🏠', text: 'Miami Shores: $580K equity' },
  ]);

  const animatedNetWorth = useCountUp(totalNetWorth, 1200, !loading);
  const animatedCash     = useCountUp(cash, 1000, !loading);

  // ─── Data fetch ───────────────────────────────────────────────
  const fetchDashboardData = useCallback(async () => {
    const [accountRes, positionsRes, tickerRes, moversRes, historyRes, auditRes] = await Promise.all([
      fetch('/api/alpaca/account').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/alpaca/positions').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/market-ticker').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/market-intel?action=movers').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/portfolio-history?period=1M').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/audit-log').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    try {
      const healthRes = await fetch('/api/health').then(r => r.json()).catch(() => null);
      const svc = healthRes?.services ?? {};
      const toUi = (s: string | undefined): 'connected' | 'error' | 'checking' => {
        if (s === 'ok' || s === 'degraded') return 'connected';
        return 'error';
      };
      setConnectionStatus({
        'Alpaca': toUi(svc.alpaca),
        'FMP': toUi(svc.fmp),
        'Supabase': toUi(svc.supabase),
        'Claude AI': toUi(svc.claude),
      });
    } catch {
      setConnectionStatus({
        'Alpaca': accountRes && !accountRes.error ? 'connected' : 'error',
        'FMP': moversRes ? 'connected' : 'error',
        'Supabase': auditRes ? 'connected' : 'error',
        'Claude AI': 'checking',
      });
    }

    if (accountRes && !accountRes.error) {
      const eq = parseFloat(accountRes.equity) || 0;
      const ca = parseFloat(accountRes.cash) || 0;
      const lastEq = parseFloat(accountRes.last_equity) || eq;
      setEquity(eq); setCash(ca); setTodayPL(eq - lastEq);
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

    if (Array.isArray(auditRes) && auditRes.length > 0) setAuditLog(auditRes);

    try {
      const optRes = await fetch('/api/options/positions').then(r => r.ok ? r.json() : null).catch(() => null);
      if (optRes?.positions?.length > 0) {
        const totalOptPnl = optRes.positions.reduce((s: number, p: { pnl: number }) => s + (p.pnl || 0), 0);
        setOptionsPnl(totalOptPnl);
        if (optRes.greeks?.netTheta) setNetTheta(optRes.greeks.netTheta);
      }
    } catch { /* options optional */ }

    try {
      const alertsRes = await fetch('/api/keisha/alerts').then(r => r.ok ? r.json() : null).catch(() => null);
      if (alertsRes?.alerts?.length > 0) setKeishaAlerts(alertsRes.alerts);
    } catch { /* alerts optional */ }

    let wealthRes: { success?: boolean; data?: { breakdown?: Record<string, { value?: number }> } } | null = null;
    try {
      wealthRes = await fetch('/api/wealth').then(r => r.ok ? r.json() : null).catch(() => null);
      if (wealthRes?.success && wealthRes.data) {
        const d = wealthRes.data.breakdown;
        if (d?.franchise?.value)    setCr3(d.franchise.value);
        if (d?.rsus?.value)         setRsus(d.rsus.value);
        if (d?.real_estate?.value)  setMiami(d.real_estate.value);
      }
    } catch { /* wealth optional */ }

    try {
      const stratRes = await fetch('/api/strategies').then(r => r.ok ? r.json() : null).catch(() => null);
      if (Array.isArray(stratRes)) {
        setStrategyCount(stratRes.filter((s: { status: string }) => s.status === 'active').length);
        setStrategyPaused(stratRes.filter((s: { status: string }) => s.status === 'paused').length);
      }
    } catch { /* strategies optional */ }

    const chips: Array<{ icon: string; text: string }> = [];
    if (accountRes && !accountRes.error) {
      const eq = parseFloat(accountRes.equity) || 0;
      const ca = parseFloat(accountRes.cash) || 0;
      if (ca > 0) chips.push({ icon: '💰', text: `$${Math.round(ca / 1000)}K cash ready to deploy` });
      if (eq > 0) chips.push({ icon: '📈', text: `Portfolio: ${formatCurrency(eq)}` });
    }
    chips.push({ icon: '📋', text: '23 CR3 territories signed' });
    const freshMiami = wealthRes?.success ? (wealthRes.data?.breakdown?.real_estate?.value || 580000) : 580000;
    chips.push({ icon: '🏠', text: `Miami Shores: ${formatCurrency(freshMiami)} equity` });
    chips.push({ icon: '🎯', text: '2026 Foundation Year — building base' });
    if (chips.length > 0) setInsightChips(chips);

    setLoading(false);
  }, []);

  const fetchRegime = useCallback(async () => {
    try {
      const res = await fetch('/api/regime', { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await res.json();
        if (data.regime) setRegimeConfig(getRegimeUIConfig(mapApiRegime(data.regime)));
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchDashboardData();
    fetchRegime();
  }, [fetchDashboardData, fetchRegime]);

  // ─── Greeting + progress ─────────────────────────────────────
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const fiftyMPct = (totalNetWorth / 50000000) * 100;

  // VIX tone
  const vixTone: 'positive' | 'negative' | 'warning' | 'neutral' =
    vix <= 0 ? 'neutral' : vix > 30 ? 'negative' : vix > 20 ? 'warning' : 'positive';
  const vixLabel = vix > 30 ? 'High vol' : vix > 20 ? 'Elevated' : 'Low vol';
  const vixEmptyLabel = connectionStatus['FMP'] === 'error' ? 'Market data unavailable' : 'Awaiting next tick';

  return (
    <AppShell>
      {/* ═══ HERO ═══ */}
      <HeroCard
        eyebrow="The Glastonbury Group"
        title={`${greeting}, Wes`}
        subtitle={dateStr}
        metric={formatCurrency(animatedNetWorth)}
        right={
          <Sparkline
            data={historyPoints.length > 2 ? historyPoints : [98000, 99000, 99500, 100000, 100200, 99800, 100500, 101000, 100800, 100000]}
            stroke={todayPL >= 0 ? color.positive : color.negative}
          />
        }
        delta={
          todayPL !== 0 ? (
            <span style={{
              fontFamily: font.mono,
              fontSize: sz.base.fontSize,
              fontWeight: weight.semibold,
              color: todayPL >= 0 ? color.positive : color.negative,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {formatPL(todayPL)} today
            </span>
          ) : (
            <PillBadge tone="neutral" size="sm" uppercase>Net Worth</PillBadge>
          )
        }
      />

      {/* ═══ Keisha Alerts Ticker ═══ */}
      {keishaAlerts.length > 0 && (
        <div style={{
          display: 'flex', gap: space[3], marginBottom: space[4], overflowX: 'auto',
          padding: '0 2px', scrollbarWidth: 'none',
        }}>
          {keishaAlerts.map((alert, i) => (
            <Card
              key={i}
              size="sm"
              tone={alert.priority === 'high' ? 'aiAccent' : 'default'}
              onClick={alert.link ? () => router.push(alert.link!) : undefined}
              interactive={!!alert.link}
              style={{ flex: '0 0 auto', maxWidth: 340, minWidth: 240 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[1] }}>
                <PillBadge tone={alert.type === 'warning' ? 'negative' : 'positive'} size="sm" uppercase>
                  {alert.type === 'warning' ? 'Warning' : 'Signal'}
                </PillBadge>
                <span style={{ fontSize: sz.body.fontSize, color: color.text, fontWeight: weight.semibold }}>{alert.title}</span>
              </div>
              <div style={{ fontSize: sz.label.fontSize, color: color.textMuted, lineHeight: 1.5 }}>
                {alert.message.slice(0, 120)}{alert.message.length > 120 ? '…' : ''}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ═══ Morning Briefing ═══ */}
      <ErrorBoundary label="morning-briefing">
        <MorningBriefing />
      </ErrorBoundary>

      {/* ═══ Regime Warning ═══ */}
      {regimeConfig?.warningMessage && (
        <Card size="sm" tone="default" style={{
          background: color.warningSubtle, border: `1px solid ${color.warning}30`,
          marginBottom: space[3], display: 'flex', alignItems: 'center', gap: space[3],
        }}>
          <span style={{ fontSize: 16, color: color.warning }}>⚠</span>
          <span style={{ fontSize: sz.bodyLg.fontSize, color: color.warning }}>{regimeConfig.warningMessage}</span>
          {regimeConfig.positionSizeMultiplier !== 1.0 && (
            <span style={{ marginLeft: 'auto' }}>
              <PillBadge tone="warning" size="sm">
                <span style={{ fontFamily: font.mono, fontVariantNumeric: 'tabular-nums' }}>
                  {regimeConfig.positionSizeMultiplier}x sizing
                </span>
              </PillBadge>
            </span>
          )}
        </Card>
      )}

      {/* ═══ Market Narrative ═══ */}
      <ErrorBoundary label="market-narrative">
        <div style={{ marginBottom: space[5] }}>
          <MarketNarrative />
        </div>
      </ErrorBoundary>

      {/* ═══ Regime Strategies ═══ */}
      {regimeConfig && regimeConfig.suggestedStrategies.length > 0 && (
        <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', marginBottom: space[4], alignItems: 'center' }}>
          <span style={{
            fontSize: sz.micro.fontSize, color: color.textDim, textTransform: 'uppercase',
            fontWeight: weight.semibold, letterSpacing: tracking.eyebrow, marginRight: space[1],
          }}>
            Regime plays:
          </span>
          {regimeConfig.suggestedStrategies.map((s, i) => (
            <PillBadge key={i} tone="gold" size="sm">{s}</PillBadge>
          ))}
        </div>
      )}

      {/* ═══ KPI STRIP ═══ */}
      <ErrorBoundary label="stat-cards">
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: space[3],
          marginBottom: space[5],
        }}>
          <MetricTile label="Cash Available" value={formatCurrency(animatedCash)} caption="Ready to deploy" />
          <MetricTile
            label="Today's P&L"
            value={formatPL(todayPL)}
            caption={todayPL >= 0 ? 'Winning day' : 'Down day'}
            tone={todayPL >= 0 ? 'positive' : 'negative'}
          />
          <MetricTile
            label="Positions"
            value={positionCount}
            caption={`${formatCurrency(totalInvested)} invested`}
          />
          <MetricTile
            label="$50M Progress"
            value={`${fiftyMPct.toFixed(2)}%`}
            caption={`${formatCurrency(totalNetWorth)} of $50M`}
            tone="gold"
          />
          <MetricTile
            label="Active Strategies"
            value={strategyCount}
            caption={strategyPaused > 0 ? `${strategyPaused} paused` : 'All running'}
          />
          <MetricTile
            label="Options P&L"
            value={optionsPnl !== 0 ? formatPL(optionsPnl) : '—'}
            caption="Open positions"
            tone={optionsPnl > 0 ? 'positive' : optionsPnl < 0 ? 'negative' : 'neutral'}
            onClick={() => router.push('/trading?tab=options')}
          />
          <MetricTile
            label="Daily Theta"
            value={netTheta !== 0 ? `$${netTheta.toFixed(0)}/day` : '—'}
            caption={netTheta !== 0 ? `~$${(netTheta * 30).toFixed(0)}/mo` : 'No options'}
            tone={netTheta > 0 ? 'positive' : netTheta < 0 ? 'negative' : 'neutral'}
            onClick={() => router.push('/trading?tab=options')}
          />
          <MetricTile
            label="VIX"
            value={vix > 0 ? vix.toFixed(1) : (loading ? '…' : 'N/A')}
            caption={vix > 0 ? vixLabel : (loading ? '' : vixEmptyLabel)}
            tone={vixTone}
          />
        </div>
      </ErrorBoundary>

      {/* ═══ ROW 2: Briefing / Positions / Movers ═══ */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: space[4],
        marginBottom: space[5],
      }}>
        <ErrorBoundary label="keisha-briefing">
          <BriefingCard />
        </ErrorBoundary>

        <ErrorBoundary label="top-positions">
          <Card size="lg" style={{ display: 'flex', flexDirection: 'column' }}>
            <SectionHeader>Top Positions</SectionHeader>

            {positions.length === 0 ? (
              <div style={{ color: color.textDim, fontSize: sz.bodyLg.fontSize, padding: `${space[3]}px 0` }}>
                No open positions — {formatCurrency(cash)} cash ready to deploy
              </div>
            ) : (
              <div style={{ flex: 1 }}>
                {positions.map(pos => (
                  <div
                    key={pos.symbol}
                    onClick={() => router.push(`/stock/${pos.symbol}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: space[3], padding: `${space[2]}px 0`,
                      borderBottom: `1px solid ${color.borderFaint}`, cursor: 'pointer',
                    }}
                  >
                    <span style={{
                      fontSize: sz.bodyLg.fontSize, fontWeight: weight.bold, color: color.text,
                      fontFamily: font.mono, width: 48,
                    }}>
                      {pos.symbol}
                    </span>
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: color.glassMd, overflow: 'hidden' }}>
                      <div style={{
                        width: `${pos.allocation}%`, height: '100%', borderRadius: 2,
                        background: color.gold, transition: 'width 0.6s ease',
                      }} />
                    </div>
                    <span style={{ fontSize: sz.label.fontSize, color: color.textMuted, fontFamily: font.mono, width: 36, textAlign: 'right' }}>
                      {pos.allocation.toFixed(0)}%
                    </span>
                    <span style={{ fontSize: sz.body.fontSize, color: color.text, fontFamily: font.mono, width: 72, textAlign: 'right' }}>
                      {formatCurrency(pos.marketValue)}
                    </span>
                    <span style={{
                      fontSize: sz.body.fontSize, fontWeight: weight.semibold, fontFamily: font.mono,
                      width: 60, textAlign: 'right',
                      color: pos.dailyChange >= 0 ? color.positive : color.negative,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {isFinite(pos.dailyChange) ? `${pos.dailyChange >= 0 ? '+' : ''}${pos.dailyChange.toFixed(2)}%` : 'N/A'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: space[3] }}>
              <button
                onClick={() => router.push('/trading')}
                style={{
                  background: 'none', border: 'none', color: color.gold, fontSize: sz.body.fontSize,
                  cursor: 'pointer', fontWeight: weight.semibold, padding: 0,
                }}
              >
                View all →
              </button>
            </div>

            {historyPoints.length > 2 && (
              <div style={{ marginTop: space[3], borderTop: `1px solid ${color.borderFaint}`, paddingTop: space[3] }}>
                <div style={{
                  fontSize: sz.micro.fontSize, color: color.textDim, textTransform: 'uppercase',
                  letterSpacing: tracking.eyebrow, marginBottom: space[2],
                }}>
                  Portfolio — 30 Days
                </div>
                <Sparkline
                  data={historyPoints}
                  width={320}
                  height={48}
                  stroke={historyPoints[historyPoints.length - 1] >= historyPoints[0] ? color.positive : color.negative}
                />
              </div>
            )}
          </Card>
        </ErrorBoundary>

        <ErrorBoundary label="market-movers">
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[4] }}>
            <Card size="md">
              <SectionHeader>Market Movers</SectionHeader>

              <div style={{
                fontSize: sz.micro.fontSize, fontWeight: weight.bold, color: color.positive,
                textTransform: 'uppercase', letterSpacing: tracking.eyebrow, marginBottom: space[1],
              }}>
                Top Gainers
              </div>
              {gainers.length > 0 ? gainers.map(g => (
                <div
                  key={g.symbol}
                  onClick={() => router.push(`/stock/${g.symbol}`)}
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: sz.body.fontSize, color: color.text, fontFamily: font.mono, fontWeight: weight.semibold }}>{g.symbol}</span>
                  <span style={{ fontSize: sz.body.fontSize, color: color.positive, fontFamily: font.mono, fontVariantNumeric: 'tabular-nums' }}>
                    +{(g.changePercentage ?? 0).toFixed(1)}%
                  </span>
                </div>
              )) : (
                <div style={{ padding: '12px 0', color: color.textDim, fontSize: sz.body.fontSize, textAlign: 'center' }}>
                  {loading ? 'Loading…' : 'Markets closed — updates at open'}
                </div>
              )}

              <div style={{
                fontSize: sz.micro.fontSize, fontWeight: weight.bold, color: color.negative,
                textTransform: 'uppercase', letterSpacing: tracking.eyebrow, marginBottom: space[1], marginTop: space[3],
              }}>
                Top Losers
              </div>
              {losers.length > 0 ? losers.map(l => (
                <div
                  key={l.symbol}
                  onClick={() => router.push(`/stock/${l.symbol}`)}
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: sz.body.fontSize, color: color.text, fontFamily: font.mono, fontWeight: weight.semibold }}>{l.symbol}</span>
                  <span style={{ fontSize: sz.body.fontSize, color: color.negative, fontFamily: font.mono, fontVariantNumeric: 'tabular-nums' }}>
                    {(l.changePercentage ?? 0).toFixed(1)}%
                  </span>
                </div>
              )) : (
                <div style={{ padding: '12px 0', color: color.textDim, fontSize: sz.body.fontSize, textAlign: 'center' }}>
                  {loading ? 'Loading…' : 'Markets closed — updates at open'}
                </div>
              )}
            </Card>

            <Card size="md">
              <SectionHeader>Connections</SectionHeader>
              {Object.entries(connectionStatus).map(([name, status]) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: space[2], padding: '3px 0' }}>
                  <StatusDot status={status} />
                  <span style={{ fontSize: sz.body.fontSize, color: color.textMuted }}>{name}</span>
                  <span style={{
                    fontSize: sz.micro.fontSize, marginLeft: 'auto',
                    color: status === 'connected' ? color.textDim : status === 'error' ? color.negative : color.warning,
                  }}>
                    {status === 'connected' ? 'Connected' : status === 'error' ? 'Error' : 'Checking…'}
                  </span>
                </div>
              ))}
            </Card>
          </div>
        </ErrorBoundary>
      </div>

      {/* ═══ ROW 3: Wealth / Progress / Activity ═══ */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: space[4],
        marginBottom: space[5],
      }}>
        <ErrorBoundary label="wealth-breakdown">
          <Card size="lg">
            <SectionHeader>Wealth Breakdown</SectionHeader>

            <div style={{ display: 'flex', height: 12, borderRadius: radius.chip, overflow: 'hidden', marginBottom: space[4] }}>
              {WEALTH_SEGMENTS.map(seg => {
                const val = seg.key === 'cr3Equity' ? cr3
                  : seg.key === 'miamiShoresProperty' ? miami
                  : seg.key === 'alpacaEquity' ? equity : rsus;
                const pct = totalNetWorth > 0 ? (val / totalNetWorth) * 100 : 0;
                return (
                  <div key={seg.key} style={{
                    width: `${pct}%`, background: seg.colorToken, transition: 'width 0.8s ease',
                    borderRight: `1px solid ${color.bg}80`,
                  }} />
                );
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space[2] }}>
              {WEALTH_SEGMENTS.map(seg => {
                const val = seg.key === 'cr3Equity' ? cr3
                  : seg.key === 'miamiShoresProperty' ? miami
                  : seg.key === 'alpacaEquity' ? equity : rsus;
                const pct = totalNetWorth > 0 ? (val / totalNetWorth) * 100 : 0;
                return (
                  <div key={seg.key} style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: 2, background: seg.colorToken, flexShrink: 0,
                    }} />
                    <div>
                      <div style={{ fontSize: sz.body.fontSize, color: color.text, fontWeight: weight.medium }}>{seg.label}</div>
                      <div style={{
                        fontSize: sz.label.fontSize, color: color.textDim, fontFamily: font.mono,
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {formatCurrency(val)} · {pct.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </ErrorBoundary>

        <Card size="lg" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ProgressRing percent={fiftyMPct} size={120} stroke={7} />
            <div style={{ position: 'absolute', textAlign: 'center' }}>
              <div style={{
                fontSize: 20, fontWeight: weight.bold, color: color.gold, fontFamily: font.mono,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {fiftyMPct.toFixed(1)}%
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: space[3] }}>
            <div style={{
              fontSize: sz.base.fontSize, fontWeight: weight.semibold, color: color.text,
              fontFamily: font.mono, fontVariantNumeric: 'tabular-nums',
            }}>
              {formatCurrency(totalNetWorth)}
            </div>
            <div style={{ fontSize: sz.label.fontSize, color: color.textDim, marginTop: 2 }}>of $50M target</div>
            <div style={{ marginTop: space[2] }}>
              <PillBadge tone="positive" size="sm">Foundation Year</PillBadge>
            </div>
          </div>
        </Card>

        <ErrorBoundary label="agent-activity">
          <Card size="lg">
            <SectionHeader>Agent Activity</SectionHeader>
            {auditLog.slice(0, 5).map(entry => (
              <div
                key={entry.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: space[3], padding: `${space[2]}px 0`,
                  borderBottom: `1px solid ${color.borderFaint}`,
                }}
              >
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', marginTop: 4, flexShrink: 0,
                  background: AGENT_COLORS[entry.agent] || color.textDim,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: sz.body.fontSize, color: color.text, fontWeight: weight.semibold }}>{entry.agent}</span>
                    <span style={{ fontSize: sz.micro.fontSize, color: color.textDim }}>{timeAgo(entry.timestamp)}</span>
                  </div>
                  <div style={{ fontSize: sz.label.fontSize, color: color.textMuted, marginTop: 1 }}>{entry.action}</div>
                  <div style={{
                    fontSize: sz.micro.fontSize, color: color.textDim, marginTop: 1,
                    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  }}>
                    {entry.details}
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={() => router.push('/strategies')}
              style={{
                background: 'none', border: 'none', color: color.gold, fontSize: sz.body.fontSize,
                cursor: 'pointer', fontWeight: weight.semibold, marginTop: space[3], padding: 0,
              }}
            >
              View full audit log →
            </button>
          </Card>
        </ErrorBoundary>
      </div>

      {/* ═══ Quick Actions ═══ */}
      <div style={{ display: 'flex', gap: space[3], marginBottom: space[5], flexWrap: 'wrap' }}>
        {QUICK_ACTIONS.map(action => (
          <Card
            key={action.label}
            size="md"
            tone={action.tone === 'gold' ? 'aiAccent' : action.tone === 'positive' ? 'positive' : 'default'}
            onClick={action.href ? () => router.push(action.href) : undefined}
            interactive={!!action.href}
            style={{ flex: '1 1 120px', textAlign: 'center' }}
          >
            <div style={{ fontSize: 20, marginBottom: 4 }}>{action.icon}</div>
            <div style={{ fontSize: sz.body.fontSize, fontWeight: weight.semibold, color: color.text }}>{action.label}</div>
          </Card>
        ))}
      </div>

      {/* ═══ AI Insight Chips ═══ */}
      <div style={{
        display: 'flex', gap: space[3], overflowX: 'auto', paddingBottom: space[2],
        scrollbarWidth: 'none', marginBottom: space[5],
      }}>
        {insightChips.map((chip, i) => (
          <PillBadge key={i} tone="gold" size="md">
            <span style={{ fontSize: 14, marginRight: 6 }}>{chip.icon}</span>
            {chip.text}
          </PillBadge>
        ))}
      </div>

      <div className="fixed bottom-4 right-4 opacity-[0.03] pointer-events-none">
        <Image src="/glastonbury-logo.png" alt="" width={200} height={200} className="filter invert brightness-[1.8]" />
      </div>
    </AppShell>
  );
}
