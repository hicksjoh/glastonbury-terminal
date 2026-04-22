import { NextRequest, NextResponse } from 'next/server';
import { fetchFedMonetaryFeed, fetchPressReleaseBody } from '@/lib/fed/feed';
import { scoreFedStatement } from '@/lib/fed/scorer';
import { createServiceClient } from '@/lib/supabase';
import { getCached, setCache } from '@/lib/server-cache';

// F7 — AI Fed hawkish/dovish sentiment scorer
//
// GET /api/fed-sentiment
// GET /api/fed-sentiment?rescore=true   — re-fetch the feed and score any new
//                                         statements (pays Claude tokens).
//
// Normal behavior: return the 10 most recent scores from Supabase. The
// table is empty until the first ?rescore=true pass populates it (or until
// a future cron does). Failure modes degrade to `{ scores: [] }` so the
// dashboard can render a placeholder instead of erroring out.
//
// Supabase table: fed_sentiment_scores (see 20260422_fed_sentiment.sql)

const LIST_CACHE_TTL_MS = 5 * 60 * 1000;

interface SentimentRow {
  url: string;
  title: string;
  published_at: string;
  score: number;
  confidence: number;
  key_phrases: unknown;
  reasoning: string;
  model_used: string;
  scored_at: string;
}

async function loadScoresFromSupabase(limit: number): Promise<SentimentRow[]> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('fed_sentiment_scores')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as unknown as SentimentRow[];
  } catch {
    return [];
  }
}

async function scoreMissing(maxToScore: number): Promise<{ scored: number; skipped: number }> {
  const feed = await fetchFedMonetaryFeed(10);
  if (feed.length === 0) return { scored: 0, skipped: 0 };

  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from('fed_sentiment_scores')
    .select('url');
  const existingUrls = new Set<string>(
    ((existing as { url: string }[] | null) ?? []).map(r => r.url),
  );

  let scored = 0;
  let skipped = 0;

  for (const item of feed) {
    if (existingUrls.has(item.url)) {
      skipped++;
      continue;
    }
    if (scored >= maxToScore) break;

    const body = await fetchPressReleaseBody(item.url);
    if (!body) {
      skipped++;
      continue;
    }
    const result = await scoreFedStatement(item.title, body);
    if (!result) {
      skipped++;
      continue;
    }

    const { error } = await supabase.from('fed_sentiment_scores').insert({
      url: item.url,
      title: item.title,
      published_at: item.publishedAt,
      score: result.score,
      confidence: result.confidence,
      key_phrases: result.keyPhrases,
      reasoning: result.reasoning,
      source_excerpt: body.slice(0, 4_000),
      model_used: result.modelUsed,
    });
    if (error) {
      skipped++;
      continue;
    }
    scored++;
  }

  return { scored, skipped };
}

export async function GET(req: NextRequest) {
  const rescore = req.nextUrl.searchParams.get('rescore') === 'true';
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 10), 50);

  const cacheKey = `fed-sentiment:${limit}:${rescore}`;
  if (!rescore) {
    const cached = getCached<unknown>(cacheKey);
    if (cached) return NextResponse.json(cached);
  }

  let rescoreSummary: { scored: number; skipped: number } | null = null;
  if (rescore) {
    rescoreSummary = await scoreMissing(5); // cap Claude calls per request
  }

  const rows = await loadScoresFromSupabase(limit);
  const scores = rows.map(r => ({
    url: r.url,
    title: r.title,
    publishedAt: r.published_at,
    score: Number(r.score),
    confidence: Number(r.confidence),
    keyPhrases: Array.isArray(r.key_phrases) ? r.key_phrases : [],
    reasoning: r.reasoning,
    modelUsed: r.model_used,
    scoredAt: r.scored_at,
  }));

  const avgScore = scores.length > 0
    ? scores.reduce((s, x) => s + x.score * x.confidence, 0) /
      Math.max(1, scores.reduce((s, x) => s + x.confidence, 0))
    : null;

  const payload = {
    scores,
    summary: {
      count: scores.length,
      weightedAverageScore: avgScore !== null ? Math.round(avgScore * 1000) / 1000 : null,
      latestAt: scores[0]?.publishedAt ?? null,
    },
    ...(rescoreSummary ? { rescore: rescoreSummary } : {}),
    source: 'federalreserve.gov + Claude',
  };

  if (!rescore) setCache(cacheKey, payload, LIST_CACHE_TTL_MS);
  return NextResponse.json(payload);
}
