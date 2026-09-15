import { NextResponse } from 'next/server';
import { apiFetchWithFallback } from '@/lib/api-client';
import { buildMeta } from '@/lib/api-meta';
import { signImageUrl } from '@/lib/img-proxy';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

// Live-data endpoint — never let Next static-optimize this at build time
export const dynamic = 'force-dynamic';

interface FinnhubNewsItem {
  headline?: string;
  summary?: string;
  source?: string;
  url?: string;
  related?: string;
  datetime?: number;
  image?: string;
  [k: string]: unknown;
}

async function GET_impl() {
  try {
    if (!process.env.FINNHUB_API_KEY) {
      return NextResponse.json({
        articles: [],
        _meta: buildMeta({ source: 'finnhub', live: false, error: 'FINNHUB_API_KEY not set' }),
      });
    }

    const result = await apiFetchWithFallback<FinnhubNewsItem[]>(
      'finnhub', '/news', { category: 'general' }, [],
      { cacheTtlMs: 5 * 60 * 1000 },
    );

    const articles = (Array.isArray(result.data) ? result.data : [])
      .slice(0, 20)
      .map(n => ({
        headline: n.headline || '',
        summary: n.summary || '',
        source: n.source || 'Finnhub',
        url: n.url || '',
        symbols: n.related ? String(n.related).split(',').filter(Boolean) : [],
        created_at: n.datetime ? new Date(n.datetime * 1000).toISOString() : new Date().toISOString(),
        image: signImageUrl(n.image || null),
        newsSource: 'finnhub',
      }));

    return NextResponse.json({ articles, _meta: result._meta });
  } catch (error) {
    console.error('Finnhub news error:', error);
    return NextResponse.json({
      articles: [],
      _meta: buildMeta({ source: 'finnhub', live: false, error: String(error) }),
    });
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('news/finnhub', RATE.UPSTREAM, GET_impl);
