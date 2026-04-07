import { NextResponse } from 'next/server';
import { apiFetchWithFallback } from '@/lib/api-client';
import { buildMeta } from '@/lib/api-meta';

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

export async function GET() {
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
        image: n.image || null,
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
