import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

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
