import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { sanitizeSymbol } from '@/lib/sanitize';
import { getQuote, getProfile } from '@/lib/fmp-client';
import { assertPaperTrading, submitOrder, AlpacaError } from '@/lib/alpaca';
import { consumePendingOrder } from '@/lib/keisha/pending-orders';
import { alpacaOrderRequestSchema } from '@/lib/order-schemas';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

interface ActionRequest {
  action: string;
  params?: Record<string, any>;
  pendingOrderId?: string;
}

export async function POST(req: NextRequest) {
  // P0-6: durable session-keyed limit (places real Alpaca orders).
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('keisha-actions', key, 30, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const body = (await req.json()) as ActionRequest;
    const action = body.action;
    const params = body.params ?? {};
    const pendingOrderId = body.pendingOrderId;
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
        // SECURITY: place_order MUST go through the pending-order store. The
        // client never supplies the params used to submit the order — those
        // come from the server-side row Keisha persisted when the agent
        // proposed the trade. Without this, a logged-in client could skip
        // the agent and POST any order body straight to Alpaca.
        const { log, request_id } = loggerFor(req, { route: 'keisha/actions:place_order' });

        if (!pendingOrderId) {
          return NextResponse.json(
            { error: 'pendingOrderId is required for place_order' },
            { status: 400 },
          );
        }

        let storedParams: Record<string, any>;
        try {
          const consumed = await consumePendingOrder(supabase, pendingOrderId);
          if (consumed.toolName !== 'place_order') {
            return NextResponse.json(
              { error: 'Pending order is not a place_order' },
              { status: 400 },
            );
          }
          storedParams = consumed.params;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Pending order invalid';
          return NextResponse.json({ error: msg }, { status: 400 });
        }

        // p6-11 (Codex #1, money-moving HIGH): the pre-fix code manually
        // parsed storedParams with `String(...)` and `parseInt`, accepted
        // arbitrary `orderType`, and submitted the result via raw fetch
        // — bypassing the hardened submitOrder + Zod validation that
        // /api/alpaca/orders uses. Now we go through alpacaOrderRequestSchema
        // and submitOrder so every order path enforces the same rules
        // (symbol shape, side enum, type+limit/stop coupling, qty bounds).
        const candidateOrder = {
          symbol: sanitizeSymbol(String(storedParams.symbol || '')),
          qty: Number(storedParams.qty ?? storedParams.quantity ?? storedParams.shares ?? NaN),
          side: String(storedParams.side || '').toLowerCase(),
          type: String(storedParams.orderType || 'market'),
          time_in_force: String(storedParams.timeInForce || 'day'),
          limit_price: storedParams.limitPrice !== undefined && storedParams.limitPrice !== null
            ? Number(storedParams.limitPrice)
            : undefined,
          stop_price: storedParams.stopPrice !== undefined && storedParams.stopPrice !== null
            ? Number(storedParams.stopPrice)
            : undefined,
        };
        const parsed = alpacaOrderRequestSchema.safeParse(candidateOrder);
        if (!parsed.success) {
          log.warn(
            { issues: parsed.error.issues, candidate: { ...candidateOrder, qty: candidateOrder.qty } },
            'keisha place_order failed schema validation',
          );
          return NextResponse.json(
            { error: 'Order validation failed', issues: parsed.error.issues },
            { status: 400 },
          );
        }

        // Defense-in-depth: hard-block any attempt to submit to a non-paper host.
        try {
          assertPaperTrading();
        } catch (lockErr) {
          const msg = lockErr instanceof Error ? lockErr.message : 'paper-trading lock engaged';
          log.error({ err: msg }, 'keisha place_order blocked by paper-trading lock');
          return NextResponse.json(
            { error: 'Paper-trading lock engaged' },
            { status: 500 }
          );
        }

        // submitOrder now uses the hardened alpacaFetch (timeouts, typed
        // errors, per-request env reads — see p6-10).
        let data: { id?: string; status?: string; symbol?: string };
        try {
          data = await submitOrder({
            symbol: parsed.data.symbol,
            qty: parsed.data.qty,
            side: parsed.data.side,
            type: parsed.data.type,
            time_in_force: parsed.data.time_in_force,
            limit_price: parsed.data.limit_price,
            stop_price: parsed.data.stop_price,
          }) as { id?: string; status?: string; symbol?: string };
        } catch (err) {
          if (err instanceof AlpacaError) {
            // p6-11 (Codex): NO MORE raw broker error echo. The public
            // response gets a generic message; full upstream body goes to
            // Sentry only. Eventid lets us cross-correlate.
            const eventId = captureRouteError(err, {
              request_id,
              route: 'keisha/actions:place_order',
              alpaca_status: err.status,
              alpaca_code: err.code,
              upstream_body: err.upstreamBody,
            });
            log.error({ alpaca_code: err.code, alpaca_status: err.status, sentry_event_id: eventId }, 'keisha place_order alpaca error');
            return NextResponse.json(
              { error: err.public(), sentry_event_id: eventId },
              { status: err.status >= 500 ? 502 : err.status },
            );
          }
          throw err;
        }

        // Log the trade to Supabase
        try {
          await supabase.from('trades').insert({
            symbol: parsed.data.symbol,
            side: parsed.data.side,
            qty: parsed.data.qty,
            order_type: parsed.data.type,
            limit_price: parsed.data.limit_price,
            status: data.status || 'new',
            order_id: data.id,
            submitted_at: new Date().toISOString(),
          });
        } catch { /* non-critical */ }

        return NextResponse.json({
          success: true,
          message: `Order placed: ${parsed.data.side.toUpperCase()} ${parsed.data.qty} ${parsed.data.symbol} (${parsed.data.type})`,
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
