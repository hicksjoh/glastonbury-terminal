import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeSymbol } from '@/lib/sanitize';
import { getQuote, getProfile } from '@/lib/fmp-client';

interface ActionRequest {
  action: string;
  params: Record<string, any>;
}

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('keisha-actions', 30, 60000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const { action, params }: ActionRequest = await req.json();
    const supabase = createServiceClient();

    switch (action) {
      case 'add_watchlist': {
        const symbol = sanitizeSymbol(params.symbol || '');
        if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });

        // Check if already in watchlist
        const { data: existing } = await supabase.from('watchlist')
          .select('id').eq('symbol', symbol).limit(1);

        if (existing && existing.length > 0) {
          return NextResponse.json({ success: true, message: `${symbol} is already on your watchlist` });
        }

        // Fetch current price and company info via /stable client
        let companyName = symbol;
        let currentPrice = null;
        try {
          const p = await getProfile(symbol);
          if (p) {
            companyName = p.companyName || symbol;
            currentPrice = p.price;
          }
        } catch {}

        const { error } = await supabase.from('watchlist').insert({
          symbol,
          company_name: companyName,
          current_price: currentPrice,
          added_at: new Date().toISOString(),
        });

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, message: `Added ${symbol} (${companyName}) to watchlist` });
      }

      case 'remove_watchlist': {
        const symbol = sanitizeSymbol(params.symbol || '');
        if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });

        const { error } = await supabase.from('watchlist').delete().eq('symbol', symbol);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, message: `Removed ${symbol} from watchlist` });
      }

      case 'set_alert': {
        const symbol = sanitizeSymbol(params.symbol || '');
        const condition = params.condition || 'price_above'; // price_above, price_below, pct_change
        const value = parseFloat(params.value);

        if (!symbol || isNaN(value)) {
          return NextResponse.json({ error: 'Missing symbol or value' }, { status: 400 });
        }

        const { error } = await supabase.from('alerts').insert({
          name: `${symbol} ${condition.replace('_', ' ')} ${value}`,
          symbol,
          rules: [{ metric: condition.startsWith('pct') ? 'pct_change' : 'price', operator: condition.includes('above') || condition.includes('pct') ? '>' : '<', value }],
          logic: 'AND',
          active: true,
          created_at: new Date().toISOString(),
        });

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, message: `Alert set: ${symbol} ${condition.replace('_', ' ')} $${value}` });
      }

      case 'place_order': {
        const symbol = sanitizeSymbol(params.symbol || '');
        const side = params.side?.toLowerCase();
        const qty = parseInt(params.qty || params.quantity || params.shares);
        const orderType = params.orderType || 'market';
        const limitPrice = params.limitPrice ? parseFloat(params.limitPrice) : undefined;

        if (!symbol || !side || !qty || isNaN(qty)) {
          return NextResponse.json({ error: 'Missing symbol, side, or quantity' }, { status: 400 });
        }

        if (!['buy', 'sell'].includes(side)) {
          return NextResponse.json({ error: 'Side must be buy or sell' }, { status: 400 });
        }

        const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
        const orderBody: any = {
          symbol,
          qty: qty.toString(),
          side,
          type: orderType,
          time_in_force: params.timeInForce || 'day',
        };
        if (orderType === 'limit' && limitPrice) {
          orderBody.limit_price = limitPrice.toString();
        }

        const res = await fetch(`${baseUrl}/v2/orders`, {
          method: 'POST',
          headers: {
            'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
            'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(orderBody),
        });

        const data = await res.json();
        if (!res.ok) {
          return NextResponse.json({ error: data.message || 'Order failed', details: data }, { status: res.status });
        }

        // Log the trade to Supabase
        try {
          await supabase.from('trades').insert({
            symbol,
            side,
            qty,
            order_type: orderType,
            limit_price: limitPrice,
            status: data.status || 'new',
            order_id: data.id,
            submitted_at: new Date().toISOString(),
          });
        } catch { /* non-critical */ }

        return NextResponse.json({
          success: true,
          message: `Order placed: ${side.toUpperCase()} ${qty} ${symbol} (${orderType})`,
          orderId: data.id,
          status: data.status,
        });
      }

      case 'lookup_price': {
        const symbol = sanitizeSymbol(params.symbol || '');
        if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });

        const quote = await getQuote(symbol);
        if (!quote) {
          return NextResponse.json({ error: `No data for ${symbol}` }, { status: 404 });
        }

        return NextResponse.json({
          success: true,
          symbol,
          price: quote.price,
          change: quote.change,
          changePct: quote.changePercentage,
          volume: quote.volume,
          marketCap: quote.marketCap,
          dayHigh: quote.dayHigh,
          dayLow: quote.dayLow,
          yearHigh: quote.yearHigh,
          yearLow: quote.yearLow,
        });
      }

      case 'get_position': {
        const symbol = sanitizeSymbol(params.symbol || '');
        if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });

        const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
        const res = await fetch(`${baseUrl}/v2/positions/${symbol}`, {
          headers: {
            'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
            'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
          },
        });

        if (!res.ok) {
          return NextResponse.json({ error: `No position in ${symbol}` }, { status: 404 });
        }

        const pos = await res.json();
        return NextResponse.json({
          success: true,
          symbol: pos.symbol,
          qty: parseFloat(pos.qty),
          marketValue: parseFloat(pos.market_value),
          costBasis: parseFloat(pos.cost_basis),
          unrealizedPl: parseFloat(pos.unrealized_pl),
          unrealizedPlPct: (parseFloat(pos.unrealized_plpc) * 100).toFixed(2) + '%',
          currentPrice: parseFloat(pos.current_price),
          avgEntry: parseFloat(pos.avg_entry_price),
        });
      }

      case 'update_watchlist_target': {
        const symbol = sanitizeSymbol(params.symbol || '');
        const buyTarget = params.buyTarget !== undefined ? parseFloat(params.buyTarget) : undefined;
        const sellTarget = params.sellTarget !== undefined ? parseFloat(params.sellTarget) : undefined;
        const notes = params.notes;

        if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });

        const updates: Record<string, any> = {};
        if (buyTarget !== undefined) updates.buy_target = buyTarget;
        if (sellTarget !== undefined) updates.sell_target = sellTarget;
        if (notes !== undefined) updates.notes = notes;

        const { error } = await supabase.from('watchlist').update(updates).eq('symbol', symbol);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json({ success: true, message: `Updated ${symbol} targets` });
      }

      case 'portfolio_summary': {
        const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
        const headers = {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
          'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
        };

        const [accountRes, positionsRes] = await Promise.all([
          fetch(`${baseUrl}/v2/account`, { headers }),
          fetch(`${baseUrl}/v2/positions`, { headers }),
        ]);

        const account = accountRes.ok ? await accountRes.json() : null;
        const positions = positionsRes.ok ? await positionsRes.json() : [];

        return NextResponse.json({
          success: true,
          equity: account ? parseFloat(account.equity) : null,
          cash: account ? parseFloat(account.cash) : null,
          buyingPower: account ? parseFloat(account.buying_power) : null,
          positionCount: positions.length,
          totalMarketValue: positions.reduce((s: number, p: any) => s + parseFloat(p.market_value || 0), 0),
          totalUnrealizedPl: positions.reduce((s: number, p: any) => s + parseFloat(p.unrealized_pl || 0), 0),
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Action failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
