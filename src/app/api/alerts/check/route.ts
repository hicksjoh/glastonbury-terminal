import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { sendPushNotification, PushSubscriptionData } from '@/lib/web-push';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_API_KEY || '';
const ALPACA_DATA_URL = 'https://data.alpaca.markets';
const ALPACA_API_KEY = process.env.ALPACA_API_KEY || '';
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY || '';

const alpacaHeaders: Record<string, string> = {
  'APCA-API-KEY-ID': ALPACA_API_KEY,
  'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
};

// Symbols that use FMP instead of Alpaca
const FMP_SYMBOLS = new Set(['^GSPC', '^DJI', '^IXIC', '^VIX', 'GCUSD', 'BTCUSD', 'ETHUSD', 'VIX']);

interface AlertCondition {
  symbol: string;
  metric: string;
  operator: string;
  value: number;
}

interface Alert {
  id: string;
  name: string;
  conditions: AlertCondition[];
  logic: string;
  action: string;
  is_active: boolean;
}

interface PriceData {
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
}

async function fetchCurrentPrice(symbol: string): Promise<PriceData | null> {
  try {
    if (FMP_SYMBOLS.has(symbol)) {
      if (!FMP_KEY) return null;
      const res = await fetch(
        `${FMP_BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return {
          price: data[0].price || 0,
          change: data[0].change || 0,
          changePercent: data[0].changePercentage || 0,
          volume: data[0].volume || 0,
        };
      }
    } else {
      if (!ALPACA_API_KEY) return null;
      const res = await fetch(
        `${ALPACA_DATA_URL}/v2/stocks/${encodeURIComponent(symbol)}/snapshot`,
        { headers: alpacaHeaders, cache: 'no-store' }
      );
      if (!res.ok) return null;
      const snap = await res.json();
      const price = snap.latestTrade?.p || snap.dailyBar?.c || 0;
      const prevClose = snap.prevDailyBar?.c || snap.dailyBar?.o || price;
      const change = price - prevClose;
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
      return {
        price,
        change,
        changePercent,
        volume: snap.dailyBar?.v || 0,
      };
    }
  } catch {
    // skip
  }
  return null;
}

function evaluateCondition(condition: AlertCondition, marketData: PriceData): boolean {
  let actual: number;
  switch (condition.metric) {
    case 'price':
      actual = marketData.price;
      break;
    case 'changePercent':
      actual = marketData.changePercent;
      break;
    case 'volume':
      actual = marketData.volume || 0;
      break;
    default:
      return false; // RSI and others not supported in real-time check yet
  }

  switch (condition.operator) {
    case '>': return actual > condition.value;
    case '<': return actual < condition.value;
    case '>=': return actual >= condition.value;
    case '<=': return actual <= condition.value;
    default: return false;
  }
}

export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data: alerts, error } = await supabase
      .from('alerts')
      .select('*')
      .eq('is_active', true);

    if (error || !alerts || alerts.length === 0) {
      return NextResponse.json({ triggered: [], checked: 0 });
    }

    // Collect unique symbols
    const symbolSet = new Set<string>();
    for (const alert of alerts as Alert[]) {
      for (const cond of alert.conditions) {
        if (cond.symbol) symbolSet.add(cond.symbol);
      }
    }

    // Fetch all prices in parallel
    const priceMap = new Map<string, PriceData>();
    await Promise.all(
      Array.from(symbolSet).map(async (symbol) => {
        const data = await fetchCurrentPrice(symbol);
        if (data) priceMap.set(symbol, data);
      })
    );

    // Evaluate each alert
    const triggered: Array<{ id: string; name: string; action: string; conditions: AlertCondition[] }> = [];

    for (const alert of alerts as Alert[]) {
      const results = alert.conditions.map(cond => {
        const data = priceMap.get(cond.symbol);
        if (!data) return false;
        return evaluateCondition(cond, data);
      });

      const met = alert.logic === 'OR'
        ? results.some(Boolean)
        : results.every(Boolean);

      if (met) {
        triggered.push({
          id: alert.id,
          name: alert.name,
          action: alert.action,
          conditions: alert.conditions,
        });

        // Mark as triggered in DB
        await supabase
          .from('alerts')
          .update({ last_triggered: new Date().toISOString() })
          .eq('id', alert.id);

        // Also insert a notification into the notifications table (best-effort)
        try {
          await supabase.from('notifications').insert({
            type: 'alert',
            priority: 'P1',
            title: `Alert Triggered: ${alert.name}`,
            message: alert.conditions
              .map(c => `${c.symbol} ${c.metric} ${c.operator} ${c.value}`)
              .join(alert.logic === 'OR' ? ' OR ' : ' AND '),
            read: false,
            link: '/alerts',
          });
        } catch {
          // best-effort
        }

        // Send Web Push to all registered subscriptions
        try {
          const { data: subs } = await supabase
            .from('push_subscriptions')
            .select('endpoint, p256dh, auth');

          if (subs && subs.length > 0) {
            const pushPayload = {
              title: `Alert: ${alert.name}`,
              body: alert.conditions
                .map(c => `${c.symbol} ${c.metric} ${c.operator} ${c.value}`)
                .join(alert.logic === 'OR' ? ' OR ' : ' AND '),
              icon: '/icon-192.png',
              url: '/alerts',
            };

            const results = await Promise.all(
              subs.map(async (sub) => {
                const subscription: PushSubscriptionData = {
                  endpoint: sub.endpoint,
                  keys: { p256dh: sub.p256dh, auth: sub.auth },
                };
                const ok = await sendPushNotification(subscription, pushPayload);
                return { endpoint: sub.endpoint, ok };
              })
            );

            // Remove expired subscriptions
            const expired = results.filter(r => !r.ok).map(r => r.endpoint);
            if (expired.length > 0) {
              await supabase
                .from('push_subscriptions')
                .delete()
                .in('endpoint', expired);
            }
          }
        } catch {
          // best-effort push delivery
        }
      }
    }

    return NextResponse.json({
      triggered,
      checked: alerts.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Alert check error:', error);
    return NextResponse.json({ triggered: [], checked: 0, error: 'Check failed' });
  }
}
