import { NextResponse } from 'next/server';

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || '';

// Simple in-memory cache
let cachedArticles: unknown[] = [];
let cacheTime = 0;
const CACHE_TTL = 120000; // 2 minutes

export async function GET() {
  try {
    if (!FINNHUB_KEY) {
      return NextResponse.json({ articles: [] });
    }

    // Return cached if fresh
    if (Date.now() - cacheTime < CACHE_TTL && cachedArticles.length > 0) {
      return NextResponse.json({ articles: cachedArticles });
    }

    const res = await fetch(
      `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`,
      { next: { revalidate: 120 } }
    );

    if (!res.ok) {
      console.error('Finnhub news error:', res.status);
      return NextResponse.json({ articles: cachedArticles });
    }

    const data = await res.json();
    const articles = (Array.isArray(data) ? data : []).slice(0, 20).map((n: Record<string, unknown>) => ({
      headline: n.headline || '',
      summary: n.summary || '',
      source: n.source || 'Finnhub',
      url: n.url || '',
      symbols: n.related ? String(n.related).split(',').filter(Boolean) : [],
      created_at: n.datetime ? new Date((n.datetime as number) * 1000).toISOString() : new Date().toISOString(),
      image: n.image || null,
      newsSource: 'finnhub',
    }));

    cachedArticles = articles;
    cacheTime = Date.now();

    return NextResponse.json({ articles });
  } catch (error) {
    console.error('Finnhub error:', error);
    return NextResponse.json({ articles: cachedArticles.length > 0 ? cachedArticles : [] });
  }
}
