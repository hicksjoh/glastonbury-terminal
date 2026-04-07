import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getCached, setCache, TTL } from '@/lib/server-cache';
import { rateLimit } from '@/lib/rate-limit';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NarrativeResponse {
  narrative: string;
  timestamp: string;
  regime: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  keyLevels: { symbol: string; level: number; significance: string }[];
}

const CACHE_KEY = 'market-narrative';
const ALPACA_DATA = 'https://data.alpaca.markets';
const FMP_BASE = 'https://financialmodelingprep.com/stable';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchAlpacaSnapshots(symbols: string[]): Promise<Record<string, Record<string, unknown>>> {
  try {
    const qs = symbols.map(s => `symbols=${s}`).join('&');
    const res = await fetch(`${ALPACA_DATA}/v2/stocks/snapshots?${qs}`, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
        'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return {};
    return await res.json() as Record<string, Record<string, unknown>>;
  } catch {
    return {};
  }
}

async function fetchRegime(): Promise<{ regime: string; vix: number; confidence: number }> {
  try {
    const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
    const res = await fetch(`${base}/api/regime`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { regime: 'unknown', vix: 0, confidence: 0 };
    const data = await res.json();
    return { regime: data.regime || 'unknown', vix: data.vix || 0, confidence: data.confidence || 0 };
  } catch {
    return { regime: 'unknown', vix: 0, confidence: 0 };
  }
}

async function fetchSectorPerf(): Promise<string> {
  try {
    const res = await fetch(`${FMP_BASE}/sector-performance?apikey=${process.env.FMP_API_KEY}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return 'Sector data unavailable';
    const data = await res.json() as Array<{ sector: string; changesPercentage: string }>;
    if (!Array.isArray(data) || data.length === 0) return 'No sector data';
    return data.slice(0, 5).map(s => `${s.sector}: ${s.changesPercentage}`).join(', ');
  } catch {
    return 'Sector data unavailable';
  }
}

// ─── Route ──────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  // Rate limit: 12/hour
  const rl = rateLimit('narrative', 12, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', remaining: 0 }, { status: 429 });
  }

  // Check cache (5 min TTL)
  const cached = getCached<NarrativeResponse>(CACHE_KEY);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  try {
    // Gather market context in parallel
    const [snapshots, regimeData, sectors] = await Promise.all([
      fetchAlpacaSnapshots(['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'NVDA', 'TSLA']),
      fetchRegime(),
      fetchSectorPerf(),
    ]);

    // Format snapshot data
    const marketLines: string[] = [];
    for (const [sym, snap] of Object.entries(snapshots)) {
      const daily = snap.dailyBar as Record<string, number> | undefined;
      const latest = snap.latestTrade as Record<string, number> | undefined;
      if (daily && latest) {
        const price = latest.p || 0;
        const prevClose = daily.c || price;
        const change = price - prevClose;
        const changePct = prevClose > 0 ? ((change / prevClose) * 100).toFixed(2) : '0.00';
        marketLines.push(`${sym}: $${price.toFixed(2)} (${change >= 0 ? '+' : ''}${changePct}%)`);
      }
    }

    // ── Fallback: if no live price data, return a calm "markets closed" response ──
    const hasMarketData = marketLines.length > 0;
    const hasSectorData = sectors !== 'Sector data unavailable' && sectors !== 'No sector data';

    if (!hasMarketData) {
      // Determine if it's likely outside market hours (ET: M-F 9:30-16:00)
      const now = new Date();
      const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hour = et.getHours();
      const minute = et.getMinutes();
      const day = et.getDay(); // 0=Sun, 6=Sat
      const isWeekend = day === 0 || day === 6;
      const isBeforeOpen = hour < 9 || (hour === 9 && minute < 30);
      const isAfterClose = hour >= 16;
      const isMarketHours = !isWeekend && !isBeforeOpen && !isAfterClose;

      let fallbackNarrative: string;
      if (isWeekend) {
        fallbackNarrative = 'Markets are closed for the weekend. Trading resumes Monday at 9:30 AM ET. Use this time to review your portfolio positioning and plan your week ahead.';
      } else if (isBeforeOpen) {
        fallbackNarrative = 'Markets have not yet opened for today\'s session. Pre-market trading begins at 4:00 AM ET, with the regular session opening at 9:30 AM ET. Check back after the open for live market analysis.';
      } else if (isAfterClose) {
        fallbackNarrative = 'Regular market hours have ended for today. After-hours trading continues until 8:00 PM ET. Full market analysis will resume with tomorrow\'s session.';
      } else if (isMarketHours) {
        fallbackNarrative = 'Live market data is temporarily unavailable. Price feeds may be delayed — this is usually resolved within a few minutes. Your portfolio data and trade history remain accessible.';
      } else {
        fallbackNarrative = 'Market data feeds are currently offline. This typically occurs outside regular trading hours (M-F 9:30 AM – 4:00 PM ET). Check back during market hours for live analysis.';
      }

      const fallbackResponse: NarrativeResponse = {
        narrative: fallbackNarrative,
        timestamp: new Date().toISOString(),
        regime: regimeData.regime !== 'unknown' ? regimeData.regime : 'neutral',
        sentiment: 'neutral',
        keyLevels: [],
      };
      setCache(CACHE_KEY, fallbackResponse, TTL.SHORT);
      return NextResponse.json({ ...fallbackResponse, cached: false });
    }

    const contextBlock = [
      `Current prices: ${marketLines.join(' | ')}`,
      `Regime: ${regimeData.regime} (VIX: ${regimeData.vix.toFixed(1)}, confidence: ${(regimeData.confidence * 100).toFixed(0)}%)`,
      `Sectors: ${hasSectorData ? sectors : 'Sector breakdown not available for this session'}`,
    ].join('\n');

    // Generate narrative via Claude
    const anthropic = new Anthropic();
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `You are a real-time market analyst for the Glastonbury Terminal. Generate a 3-5 sentence narrative explaining WHAT is happening in the market right now and WHY. Include specific prices and levels. Explain causality — don't just describe, explain the mechanism.

Be concise, authoritative, insightful. Bloomberg anchor style.

IMPORTANT: Only reference data that is actually provided below. If any data is missing or shows as unavailable, simply omit it from your analysis. Do NOT speculate about data outages, blackouts, or system failures. Focus only on the data you have.

Also return:
- sentiment: "bullish", "bearish", or "neutral"
- keyLevels: up to 3 key price levels worth watching (symbol, level, significance)

Current market data:
${contextBlock}

Respond in this exact JSON format:
{
  "narrative": "Your 3-5 sentence market narrative here...",
  "sentiment": "bullish|bearish|neutral",
  "keyLevels": [{"symbol":"SPY","level":520,"significance":"Key support"}]
}`,
        },
      ],
    });

    // Parse response
    const textBlock = msg.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 });
    }

    let parsed: { narrative: string; sentiment: string; keyLevels: NarrativeResponse['keyLevels'] };
    try {
      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : textBlock.text);
    } catch {
      // Fallback: use raw text as narrative
      parsed = { narrative: textBlock.text.slice(0, 500), sentiment: 'neutral', keyLevels: [] };
    }

    const response: NarrativeResponse = {
      narrative: parsed.narrative,
      timestamp: new Date().toISOString(),
      regime: regimeData.regime,
      sentiment: (['bullish', 'bearish', 'neutral'].includes(parsed.sentiment)
        ? parsed.sentiment
        : 'neutral') as NarrativeResponse['sentiment'],
      keyLevels: Array.isArray(parsed.keyLevels) ? parsed.keyLevels.slice(0, 5) : [],
    };

    setCache(CACHE_KEY, response, TTL.MEDIUM);
    return NextResponse.json({ ...response, cached: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Narrative generation failed';
    console.error('[narrative] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
