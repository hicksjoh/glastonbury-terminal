// Sentiment Engine — aggregates news sentiment from multiple sources
// NewsAPI + GNews + Finnhub news, with composite scoring

import { apiFetchWithFallback, type ApiResult } from './api-client';
import { buildMeta, type ApiMeta } from './api-meta';

export interface SentimentArticle {
  headline: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore: number; // -1 to 1
  provider: string;
}

export interface SentimentSummary {
  symbol: string;
  articles: SentimentArticle[];
  composite: {
    score: number;        // -100 to 100
    label: 'very_bullish' | 'bullish' | 'neutral' | 'bearish' | 'very_bearish';
    articleCount: number;
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
  };
  sources: string[];
}

// Simple keyword-based sentiment scoring
const BULLISH_WORDS = [
  'surge', 'rally', 'soar', 'jump', 'gain', 'rise', 'beat', 'exceed',
  'bullish', 'upgrade', 'buy', 'outperform', 'strong', 'growth', 'record',
  'profit', 'boost', 'optimistic', 'breakout', 'momentum',
];

const BEARISH_WORDS = [
  'crash', 'plunge', 'drop', 'fall', 'decline', 'miss', 'loss', 'sell',
  'bearish', 'downgrade', 'weak', 'recession', 'warning', 'risk', 'fear',
  'concern', 'cut', 'layoff', 'default', 'bankruptcy',
];

function scoreSentiment(text: string): { score: number; label: 'bullish' | 'bearish' | 'neutral' } {
  const lower = text.toLowerCase();
  let bullish = 0;
  let bearish = 0;

  for (const word of BULLISH_WORDS) {
    if (lower.includes(word)) bullish++;
  }
  for (const word of BEARISH_WORDS) {
    if (lower.includes(word)) bearish++;
  }

  const total = bullish + bearish;
  if (total === 0) return { score: 0, label: 'neutral' };

  const score = (bullish - bearish) / total;
  if (score > 0.2) return { score, label: 'bullish' };
  if (score < -0.2) return { score, label: 'bearish' };
  return { score, label: 'neutral' };
}

// ---------------------------------------------------------------------------
// NewsAPI (requires NEWSAPI_KEY)
// ---------------------------------------------------------------------------

interface NewsApiArticle {
  title?: string;
  source?: { name?: string };
  url?: string;
  publishedAt?: string;
  description?: string;
}

async function fetchNewsApi(query: string): Promise<{ articles: SentimentArticle[]; meta: ApiMeta }> {
  if (!process.env.NEWSAPI_KEY) {
    return { articles: [], meta: buildMeta({ source: 'newsapi', live: false, error: 'No API key' }) };
  }

  const result = await apiFetchWithFallback<{ articles?: NewsApiArticle[] }>(
    'newsapi', '/everything',
    { q: query, language: 'en', sortBy: 'publishedAt', pageSize: '20' },
    { articles: [] },
    { cacheTtlMs: 10 * 60 * 1000 },
  );

  const articles = (result.data.articles ?? []).map(a => {
    const text = `${a.title || ''} ${a.description || ''}`;
    const { score, label } = scoreSentiment(text);
    return {
      headline: a.title || '',
      source: a.source?.name || 'NewsAPI',
      url: a.url || '',
      publishedAt: a.publishedAt || '',
      sentiment: label,
      sentimentScore: score,
      provider: 'newsapi',
    };
  });

  return { articles, meta: result._meta };
}

// ---------------------------------------------------------------------------
// GNews (requires GNEWS_API_KEY)
// ---------------------------------------------------------------------------

interface GNewsArticle {
  title?: string;
  source?: { name?: string };
  url?: string;
  publishedAt?: string;
  description?: string;
}

async function fetchGNews(query: string): Promise<{ articles: SentimentArticle[]; meta: ApiMeta }> {
  if (!process.env.GNEWS_API_KEY) {
    return { articles: [], meta: buildMeta({ source: 'gnews', live: false, error: 'No API key' }) };
  }

  const result = await apiFetchWithFallback<{ articles?: GNewsArticle[] }>(
    'gnews', '/search',
    { q: query, lang: 'en', max: '10' },
    { articles: [] },
    { cacheTtlMs: 10 * 60 * 1000 },
  );

  const articles = (result.data.articles ?? []).map(a => {
    const text = `${a.title || ''} ${a.description || ''}`;
    const { score, label } = scoreSentiment(text);
    return {
      headline: a.title || '',
      source: a.source?.name || 'GNews',
      url: a.url || '',
      publishedAt: a.publishedAt || '',
      sentiment: label,
      sentimentScore: score,
      provider: 'gnews',
    };
  });

  return { articles, meta: result._meta };
}

// ---------------------------------------------------------------------------
// Finnhub News (uses existing FINNHUB_API_KEY)
// ---------------------------------------------------------------------------

interface FinnhubNewsItem {
  headline?: string;
  source?: string;
  url?: string;
  datetime?: number;
  summary?: string;
  related?: string;
}

async function fetchFinnhubSentiment(symbol: string): Promise<{ articles: SentimentArticle[]; meta: ApiMeta }> {
  if (!process.env.FINNHUB_API_KEY) {
    return { articles: [], meta: buildMeta({ source: 'finnhub', live: false, error: 'No API key' }) };
  }

  const from = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const to = new Date().toISOString().split('T')[0];

  const result = await apiFetchWithFallback<FinnhubNewsItem[]>(
    'finnhub', '/company-news',
    { symbol, from, to },
    [],
    { cacheTtlMs: 10 * 60 * 1000 },
  );

  const articles = (Array.isArray(result.data) ? result.data : []).slice(0, 20).map(n => {
    const text = `${n.headline || ''} ${n.summary || ''}`;
    const { score, label } = scoreSentiment(text);
    return {
      headline: n.headline || '',
      source: n.source || 'Finnhub',
      url: n.url || '',
      publishedAt: n.datetime ? new Date(n.datetime * 1000).toISOString() : '',
      sentiment: label,
      sentimentScore: score,
      provider: 'finnhub',
    };
  });

  return { articles, meta: result._meta };
}

// ---------------------------------------------------------------------------
// Composite sentiment for a symbol
// ---------------------------------------------------------------------------

export async function getSymbolSentiment(symbol: string): Promise<{
  summary: SentimentSummary;
  metas: ApiMeta[];
}> {
  // Fetch from all available sources in parallel
  const [newsApi, gNews, finnhub] = await Promise.all([
    fetchNewsApi(symbol),
    fetchGNews(symbol),
    fetchFinnhubSentiment(symbol),
  ]);

  const allArticles = [
    ...finnhub.articles,
    ...newsApi.articles,
    ...gNews.articles,
  ];

  const bullish = allArticles.filter(a => a.sentiment === 'bullish').length;
  const bearish = allArticles.filter(a => a.sentiment === 'bearish').length;
  const neutral = allArticles.filter(a => a.sentiment === 'neutral').length;
  const total = allArticles.length || 1;

  const avgScore = allArticles.reduce((sum, a) => sum + a.sentimentScore, 0) / total;
  const compositeScore = Math.round(avgScore * 100);

  let label: SentimentSummary['composite']['label'];
  if (compositeScore > 40) label = 'very_bullish';
  else if (compositeScore > 15) label = 'bullish';
  else if (compositeScore < -40) label = 'very_bearish';
  else if (compositeScore < -15) label = 'bearish';
  else label = 'neutral';

  const sources = [];
  if (finnhub.articles.length > 0) sources.push('finnhub');
  if (newsApi.articles.length > 0) sources.push('newsapi');
  if (gNews.articles.length > 0) sources.push('gnews');

  return {
    summary: {
      symbol,
      articles: allArticles.slice(0, 30),
      composite: {
        score: compositeScore,
        label,
        articleCount: allArticles.length,
        bullishCount: bullish,
        bearishCount: bearish,
        neutralCount: neutral,
      },
      sources,
    },
    metas: [finnhub.meta, newsApi.meta, gNews.meta],
  };
}

// Market-wide sentiment (not symbol-specific)
export async function getMarketSentiment(): Promise<{
  summary: SentimentSummary;
  metas: ApiMeta[];
}> {
  return getSymbolSentiment('stock market');
}
