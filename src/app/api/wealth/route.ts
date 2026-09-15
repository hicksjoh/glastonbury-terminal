import { NextRequest, NextResponse } from 'next/server';
import { getAccount, getPositions } from '@/lib/alpaca';
import { getServerTradingMode } from '@/lib/trading-mode';
import { createServiceClient } from '@/lib/supabase';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

async function GET_impl(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'wealth' });
  try {
    const supabase = createServiceClient();

    const [account, positions, { data: wealthAssets }] = await Promise.all([
      getAccount().catch(() => null),
      getPositions().catch(() => []),
      supabase.from('wealth_assets').select('*'),
    ]);

    // The Alpaca account is the PAPER account whenever TRADING_MODE !== 'live',
    // and its balance is simulated money (Alpaca seeds paper accounts at
    // $100,000). Summing it into net worth inflated the headline figure by
    // exactly that much and labelled the result "Complete financial picture".
    // Simulated equity is reported separately and never enters the total.
    const tradingMode = getServerTradingMode();
    const brokerageEquity = account ? parseFloat(account.equity) : 0;
    const brokerageEquityIsReal = tradingMode === 'live' && Number.isFinite(brokerageEquity);
    const investmentValue = brokerageEquityIsReal ? brokerageEquity : 0;
    const simulatedEquity = brokerageEquityIsReal ? 0 : (Number.isFinite(brokerageEquity) ? brokerageEquity : 0);

    // `account === null` means the Alpaca call failed, which is not the same
    // as "the brokerage is worth zero". Surfaced so the UI can say "partial"
    // instead of quietly reporting a smaller net worth.
    const brokerageUnavailable = account === null;

    const assets = wealthAssets || [];
    const assetsByClass: Record<string, { value: number; cost_basis: number; items: typeof assets }> = {};
    for (const asset of assets) {
      if (!assetsByClass[asset.asset_class]) {
        assetsByClass[asset.asset_class] = { value: 0, cost_basis: 0, items: [] };
      }
      assetsByClass[asset.asset_class].value += Number(asset.current_value);
      assetsByClass[asset.asset_class].cost_basis += Number(asset.cost_basis || 0);
      assetsByClass[asset.asset_class].items.push(asset);
    }

    const franchiseEquity = assetsByClass['franchise']?.value || 0;
    const realEstate = assetsByClass['real_estate']?.value || 0;
    const rsus = assetsByClass['rsu']?.value || 0;
    const cashReserves = assetsByClass['cash']?.value || 0;

    const totalAssets = investmentValue + franchiseEquity + realEstate + rsus + cashReserves;

    // Liabilities are not tracked anywhere yet. This used to be a hardcoded
    // `0`, which turned "we don't know" into the claim "there is no debt" and
    // made `total_net_worth` a gross-assets figure wearing a net-worth label.
    // null is the honest value; the UI renders a "not tracked" note for it.
    const liabilities: number | null = null;
    const totalNetWorth = totalAssets - (liabilities ?? 0);
    const liquidAssets = investmentValue + cashReserves;

    return NextResponse.json({
      success: true,
      data: {
        total_net_worth: totalNetWorth,
        total_assets: totalAssets,
        liabilities,
        liabilities_tracked: false,
        // True only when every input resolved. The brokerage read failing is
        // the realistic way this total silently shrinks.
        complete: !brokerageUnavailable,
        trading_mode: tradingMode,
        simulated_equity_excluded: simulatedEquity,
        liquidity_ratio: totalNetWorth > 0 ? liquidAssets / totalNetWorth : 0,
        breakdown: {
          investments: {
            value: investmentValue,
            positions: Array.isArray(positions) ? positions.length : 0,
            simulated: !brokerageEquityIsReal,
            unavailable: brokerageUnavailable,
          },
          franchise: { value: franchiseEquity, cost_basis: assetsByClass['franchise']?.cost_basis || 0 },
          real_estate: { value: realEstate, cost_basis: assetsByClass['real_estate']?.cost_basis || 0 },
          rsus: { value: rsus, details: assetsByClass['rsu']?.items || [] },
          cash: { value: cashReserves },
        },
        assets: wealthAssets || [],
      },
    });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'wealth' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'wealth GET failed');
    return NextResponse.json({ success: false, error: 'Failed to fetch wealth data' }, { status: 500 });
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('wealth', RATE.UPSTREAM, GET_impl);
