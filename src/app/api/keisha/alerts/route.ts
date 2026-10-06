import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';
import { internalFetch } from '@/lib/internal-fetch';

interface Alert {
  type: 'opportunity' | 'warning';
  priority: 'high' | 'medium' | 'low';
  title: string;
  message: string;
  symbol?: string;
  link?: string;
  timestamp: string;
}

function getBaseUrl(): string {
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
}

async function GET_impl(request: Request) {
  const { log, request_id } = loggerFor(request, { route: 'keisha/alerts' });
  try {
    const baseUrl = getBaseUrl();
    const supabase = createServiceClient();
    const alerts: Alert[] = [];
    const now = new Date().toISOString();

    // 1. Portfolio position alerts — any holding moving >3% today
    const portfolio = await internalFetch(`/api/portfolio`).then(r => r.ok ? r.json() : null).catch(() => null);
    if (portfolio?.positions) {
      for (const pos of portfolio.positions) {
        const changePct = pos.unrealized_plpc ? parseFloat(pos.unrealized_plpc) * 100 : 0;
        if (Math.abs(changePct) > 3) {
          alerts.push({
            type: changePct > 0 ? 'opportunity' : 'warning',
            priority: Math.abs(changePct) > 5 ? 'high' : 'medium',
            title: `${pos.symbol} ${changePct > 0 ? 'surging' : 'dropping'} ${Math.abs(changePct).toFixed(1)}%`,
            message: `Your ${pos.symbol} position is ${changePct > 0 ? 'up' : 'down'} ${Math.abs(changePct).toFixed(1)}% today. ${changePct < -5 ? 'Consider reviewing your stop loss.' : changePct > 5 ? 'Consider taking partial profits.' : ''}`,
            symbol: pos.symbol,
            link: '/trading',
            timestamp: now,
          });
        }
      }
    }

    // 2. Scanner signal alerts — high-confluence signals
    const scanner = await internalFetch(`/api/scanner?preset=confluence`).then(r => r.ok ? r.json() : null).catch(() => null);
    if (scanner?.signals) {
      // Scanner scores are now 30/60/70/100 by matched checks; 80+ means all
      // three (top gainer, most active, insider buy) matched.
      const hotSignals = scanner.signals.filter((s: any) => s.score >= 80);
      for (const sig of hotSignals.slice(0, 3)) {
        alerts.push({
          type: 'opportunity',
          priority: sig.score >= 90 ? 'high' : 'medium',
          title: `Scanner match: ${sig.symbol} hit all ${sig.sources?.length || 0} screen checks`,
          message: `${sig.thesis || ''} This is a screen match, not a trade recommendation.`,
          symbol: sig.symbol,
          link: '/scanner',
          timestamp: now,
        });
      }
    }

    // 3. GEX regime flip alert
    const gex = await internalFetch(`/api/gex?symbol=SPY`).then(r => r.ok ? r.json() : null).catch(() => null);
    if (gex?.regime === 'negative') {
      // Check if we recently alerted about negative gamma
      let recentlyAlerted = false;
      try {
        const { data } = await (supabase as any).from('keisha_recommendations')
          .select('reasoning')
          .ilike('reasoning', '%negative gamma%')
          .gte('created_at', new Date(Date.now() - 24 * 3600000).toISOString())
          .limit(1);
        recentlyAlerted = (data?.length || 0) > 0;
      } catch { /* ignore */ }

      if (!recentlyAlerted) {
        alerts.push({
          type: 'warning',
          priority: 'high',
          title: 'GEX Regime: Negative Gamma',
          message: 'Market makers are in negative gamma territory. Expect amplified moves. Tighten stops and reduce position sizes.',
          link: '/gex',
          timestamp: now,
        });
      }
    }

    // 4. Earnings on held positions
    const earnings = await internalFetch(`/api/earnings?range=today`).then(r => r.ok ? r.json() : null).catch(() => null);
    if (earnings?.upcoming && portfolio?.positions) {
      const heldSymbols = portfolio.positions.map((p: any) => p.symbol);
      const earningsToday = (earnings.upcoming || []).filter((e: any) => heldSymbols.includes(e.symbol));
      for (const e of earningsToday) {
        alerts.push({
          type: 'warning',
          priority: 'high',
          title: `${e.symbol} reports earnings today`,
          message: `You hold ${e.symbol} and they report ${e.time === 'bmo' ? 'before market open' : 'after close'}. Consider your earnings strategy.`,
          symbol: e.symbol,
          link: '/trading',
          timestamp: now,
        });
      }
    }

    // Sort by priority
    const prioMap: Record<string, number> = { high: 0, medium: 1, low: 2 };
    alerts.sort((a, b) => (prioMap[a.priority] || 2) - (prioMap[b.priority] || 2));

    return NextResponse.json({
      alerts,
      count: alerts.length,
      timestamp: now,
    });
  } catch (error: unknown) {
    const eventId = captureRouteError(error, { request_id, route: 'keisha/alerts' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'keisha alerts failed');
    // p6-15: don't echo raw err.message
    return NextResponse.json({ error: 'Failed to compute alerts', alerts: [], count: 0, sentry_event_id: eventId }, { status: 500 });
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('keisha/alerts', RATE.EXPENSIVE, GET_impl);
