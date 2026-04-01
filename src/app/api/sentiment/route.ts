import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const FMP_KEY = process.env.FMP_API_KEY;
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// GET /api/sentiment?symbol=AAPL — Enhanced AI Sentiment Engine
export async function GET(req: NextRequest) {
  try {
    const symbol = req.nextUrl.searchParams.get('symbol');
    if (!symbol) {
      return NextResponse.json({ error: 'symbol parameter required' }, { status: 400 });
    }
    if (!FMP_KEY) {
      return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });
    }

    const [socialRes, newsRes, pressRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/api/v4/social-sentiment?symbol=${symbol}&limit=100&apikey=${FMP_KEY}`).catch(() => null),
      fetch(`https://financialmodelingprep.com/api/v3/stock_news?tickers=${symbol}&limit=50&apikey=${FMP_KEY}`).catch(() => null),
      fetch(`https://financialmodelingprep.com/api/v3/press-releases/${symbol}?limit=20&apikey=${FMP_KEY}`).catch(() => null),
    ]);

    const socialData = socialRes?.ok ? await socialRes.json() : [];
    const newsData = newsRes?.ok ? await newsRes.json() : [];
    const _pressData = pressRes?.ok ? await pressRes.json() : [];

    // Social sentiment score (1-10)
    let socialSentiment = 5;
    if (Array.isArray(socialData) && socialData.length > 0) {
      const sentiments = socialData.map((s: { stocktwitsSentiment?: number; twitterSentiment?: number }) =>
        (s.stocktwitsSentiment || 0) + (s.twitterSentiment || 0)
      );
      const avg = sentiments.reduce((a: number, b: number) => a + b, 0) / sentiments.length;
      socialSentiment = Math.max(1, Math.min(10, Math.round(5 + avg * 5)));
    }

    // News sentiment
    let newsSentiment = 5;
    const recentNews: { title: string; sentiment: string; date: string; url: string }[] = [];
    if (Array.isArray(newsData)) {
      let pos = 0, neg = 0;
      for (const article of newsData.slice(0, 20)) {
        const title = (article.title || '').toLowerCase();
        const bullish = /surge|rally|beat|upgrade|bull|record|growth|strong|outperform|buy/i.test(title);
        const bearish = /drop|fall|miss|downgrade|bear|loss|weak|underperform|sell|crash/i.test(title);
        let sentiment = 'neutral';
        if (bullish && !bearish) { sentiment = 'positive'; pos++; }
        else if (bearish && !bullish) { sentiment = 'negative'; neg++; }
        recentNews.push({ title: article.title || '', sentiment, date: article.publishedDate || '', url: article.url || '' });
      }
      const total = pos + neg;
      if (total > 0) newsSentiment = Math.round(1 + (pos / total) * 9);
    }

    // AI analysis
    let aiAnalysis = 5;
    const flags: string[] = [];
    if (recentNews.length > 0) {
      try {
        const headlines = recentNews.slice(0, 10).map(n => `- ${n.title} (${n.sentiment})`).join('\n');
        const message = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{ role: 'user', content: `Analyze headlines for ${symbol}. Score sentiment 1-10. Return JSON: {"score": number, "flags": string[], "summary": string}\n\n${headlines}` }],
        });
        const text = message.content[0].type === 'text' ? message.content[0].text : '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          aiAnalysis = Math.max(1, Math.min(10, parsed.score || 5));
          if (Array.isArray(parsed.flags)) flags.push(...parsed.flags);
        }
      } catch { /* fallback */ }
    }

    const compositeScore = Math.round((socialSentiment * 0.4 + newsSentiment * 0.3 + aiAnalysis * 0.3) * 10) / 10;
    const trendDirection = compositeScore >= 7 ? 'improving' : compositeScore <= 3 ? 'declining' : 'stable';

    return NextResponse.json({
      symbol, compositeScore, socialSentiment, newsSentiment, aiAnalysis,
      trendDirection, recentNews: recentNews.slice(0, 10), flags,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// In-memory cache keyed by headline hash
const sentimentCache = new Map<string, { sentiment: string; confidence: number }>();

function hashHeadline(headline: string): string {
  let hash = 0;
  for (let i = 0; i < headline.length; i++) {
    const char = headline.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

export async function POST(req: NextRequest) {
  try {
    const { headlines } = await req.json() as { headlines: string[] };
    if (!headlines || !Array.isArray(headlines) || headlines.length === 0) {
      return NextResponse.json({ results: [] });
    }

    // Check cache first
    const results: { index: number; sentiment: string; confidence: number }[] = [];
    const uncached: { index: number; headline: string }[] = [];

    headlines.forEach((h, i) => {
      const key = hashHeadline(h);
      const cached = sentimentCache.get(key);
      if (cached) {
        results.push({ index: i, ...cached });
      } else {
        uncached.push({ index: i, headline: h });
      }
    });

    if (uncached.length > 0) {
      // Batch in groups of 20
      const batches: typeof uncached[] = [];
      for (let i = 0; i < uncached.length; i += 20) {
        batches.push(uncached.slice(i, i + 20));
      }

      for (const batch of batches) {
        try {
          const headlineList = batch.map((h, i) => `${i}. ${h.headline}`).join('\n');
          const message = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            messages: [{
              role: 'user',
              content: `Classify each headline as BULLISH, BEARISH, or NEUTRAL. Return ONLY a JSON array with format: [{"index":0,"sentiment":"BULLISH","confidence":0.85}]\n\nHeadlines:\n${headlineList}`,
            }],
          });

          const text = message.content[0].type === 'text' ? message.content[0].text : '[]';
          // Extract JSON from response
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as { index: number; sentiment: string; confidence: number }[];
            parsed.forEach((p) => {
              const original = batch[p.index];
              if (original) {
                const result = { sentiment: p.sentiment, confidence: p.confidence || 0.7 };
                sentimentCache.set(hashHeadline(original.headline), result);
                results.push({ index: original.index, ...result });
              }
            });
          }
        } catch (err) {
          console.error('Sentiment batch error:', err);
          // Mark uncached as NEUTRAL on error
          batch.forEach(h => {
            results.push({ index: h.index, sentiment: 'NEUTRAL', confidence: 0.5 });
          });
        }
      }
    }

    // Sort by original index
    results.sort((a, b) => a.index - b.index);
    return NextResponse.json({ results });
  } catch (error) {
    console.error('Sentiment error:', error);
    return NextResponse.json({ results: [] });
  }
}
