import { NextResponse } from 'next/server';
import { getAccount, getPositions } from '@/lib/alpaca';
import { createServiceClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = createServiceClient();

    const [account, positions, { data: wealthAssets }] = await Promise.all([
      getAccount().catch(() => null),
      getPositions().catch(() => []),
      supabase.from('wealth_assets').select('*'),
    ]);

    const investmentValue = account ? parseFloat(account.equity) : 0;

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
    const liabilities = 0; // TODO: pull from supabase
    const totalNetWorth = totalAssets - liabilities;
    const liquidAssets = investmentValue + cashReserves;

    return NextResponse.json({
      success: true,
      data: {
        total_net_worth: totalNetWorth,
        total_assets: totalAssets,
        liabilities,
        liquidity_ratio: totalNetWorth > 0 ? liquidAssets / totalNetWorth : 0,
        breakdown: {
          investments: { value: investmentValue, positions: Array.isArray(positions) ? positions.length : 0 },
          franchise: { value: franchiseEquity, cost_basis: assetsByClass['franchise']?.cost_basis || 0 },
          real_estate: { value: realEstate, cost_basis: assetsByClass['real_estate']?.cost_basis || 0 },
          rsus: { value: rsus, details: assetsByClass['rsu']?.items || [] },
          cash: { value: cashReserves },
        },
        assets: wealthAssets || [],
      },
    });
  } catch (error) {
    console.error('Wealth API error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch wealth data' }, { status: 500 });
  }
}
