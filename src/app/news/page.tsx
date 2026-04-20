'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  TrendingUp, Bookmark, BookmarkCheck, Copy, Mail, Check,
  ArrowUpCircle, Zap, Clock,
} from 'lucide-react';

interface NewsArticle {
  headline: string;
  summary: string;
  source: string;
  url: string;
  symbols: string[];
  created_at: string;
  image?: string;
  sentiment?: string;
  sentimentConfidence?: number;
  newsSource?: string;
}

const SENTIMENT_COLORS: Record<string, { bg: string; color: string; label: string; border: string }> = {
  BULLISH: { bg: 'rgba(34, 197, 94, 0.10)', color: '#22c55e', label: 'Bullish', border: '#22c55e' },
  BEARISH: { bg: 'rgba(239, 68, 68, 0.10)', color: '#ef4444', label: 'Bearish', border: '#ef4444' },
  NEUTRAL: { bg: 'rgba(107, 114, 128, 0.10)', color: '#6b7280', label: 'Neutral', border: '#6b7280' },
};

const SOURCE_BADGE: Record<string, { bg: string; color: string }> = {
  benzinga: { bg: 'rgba(249, 115, 22, 0.15)', color: '#f97316' },
  finnhub: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' },
};

const PLACEHOLDER_IMG = '/news-placeholder.svg';
const SAVED_KEY = 'gt-saved-news-v1';
const RELEVANCE_RE = /\b(florida|roofing|hurricane|storm|permit|miami|fort lauderdale|west palm|construction|glastonbury|cr3|tampa|orlando|jacksonville|palm beach|broward|dade)\b/i;
const WPM = 220;

function articleKey(a: NewsArticle): string {
  return a.url || a.headline;
}

function isRelevant(a: NewsArticle): boolean {
  return RELEVANCE_RE.test(a.headline || '') || RELEVANCE_RE.test(a.summary || '');
}

function readingMin(a: NewsArticle): number {
  const text = `${a.headline || ''} ${a.summary || ''}`.trim();
  if (!text) return 1;
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WPM));
}

function loadSaved(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistSaved(s: Set<string>): void {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(Array.from(s))); } catch { /* noop */ }
}

function ArticleImage({
  src, alt, fallbackGradient, className, onLoadComplete,
}: {
  src?: string;
  alt: string;
  fallbackGradient: string;
  className?: string;
  onLoadComplete?: () => void;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>(src ? 'loading' : 'error');
  const imgSrc = src || PLACEHOLDER_IMG;
  return (
    <>
      {state === 'loading' && (
        <div
          className="news-img-skeleton"
          style={{ position: 'absolute', inset: 0 }}
          aria-hidden
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={state === 'error' ? PLACEHOLDER_IMG : imgSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={className}
        style={{
          width: '100%', height: '100%',
          objectFit: 'cover', display: 'block',
          opacity: state === 'loaded' || state === 'error' ? 1 : 0,
          transition: 'opacity 0.25s ease',
          background: state === 'error' ? fallbackGradient : undefined,
        }}
        onLoad={() => { setState('loaded'); onLoadComplete?.(); }}
        onError={() => {
          if (state !== 'error') setState('error');
        }}
      />
    </>
  );
}

function ShareRow({
  article, copied, onCopy,
}: {
  article: NewsArticle;
  copied: boolean;
  onCopy: () => void;
}) {
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  const shareUrl = article.url;
  const twitter = `https://twitter.com/intent/tweet?text=${encodeURIComponent(article.headline)}&url=${encodeURIComponent(shareUrl)}`;
  const mail = `mailto:?subject=${encodeURIComponent(article.headline)}&body=${encodeURIComponent(`${article.headline}\n\n${shareUrl}`)}`;
  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 24, height: 24, borderRadius: 4, border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.03)', color: '#888', cursor: 'pointer',
    textDecoration: 'none', transition: 'all 0.15s',
  };
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <button
        type="button"
        aria-label="Copy link"
        title={copied ? 'Copied!' : 'Copy link'}
        onClick={e => { stop(e); onCopy(); }}
        style={btn}
      >
        {copied ? <Check size={12} color="#22c55e" /> : <Copy size={12} />}
      </button>
      <a
        href={twitter}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stop}
        aria-label="Share on X"
        title="Share on X"
        style={btn}
      >
        <span style={{ fontSize: 11, fontWeight: 800 }}>𝕏</span>
      </a>
      <a
        href={mail}
        onClick={stop}
        aria-label="Email this"
        title="Email this"
        style={btn}
      >
        <Mail size={12} />
      </a>
    </div>
  );
}

export default function NewsPage() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [pendingArticles, setPendingArticles] = useState<NewsArticle[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [sentimentFilter, setSentimentFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [scoringSentiment, setScoringSentiment] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'feed' | 'saved'>('feed');
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [relevantOnly, setRelevantOnly] = useState<boolean>(false);
  const articlesRef = useRef<NewsArticle[]>([]);
  articlesRef.current = articles;

  useEffect(() => { setSavedIds(loadSaved()); }, []);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const toggleSave = useCallback((key: string) => {
    setSavedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      persistSaved(next);
      return next;
    });
  }, []);

  const handleCopy = useCallback(async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(c => (c === key ? null : c)), 1500);
    } catch { /* noop */ }
  }, []);

  const fetchSentiment = useCallback(async (arts: NewsArticle[]) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentArticles = arts.filter(a => new Date(a.created_at).getTime() > cutoff);
    if (recentArticles.length === 0) return;

    setScoringSentiment(true);
    try {
      const res = await fetch('/api/sentiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headlines: recentArticles.map(a => a.headline) }),
      });
      if (res.ok) {
        const data = await res.json();
        const results = data.results as { index: number; sentiment: string; confidence: number }[];
        setArticles(prev => {
          const updated = [...prev];
          results.forEach(r => {
            const article = recentArticles[r.index];
            if (article) {
              const idx = updated.findIndex(a => a.headline === article.headline);
              if (idx !== -1) {
                updated[idx] = { ...updated[idx], sentiment: r.sentiment, sentimentConfidence: r.confidence };
              }
            }
          });
          return updated;
        });
      }
    } catch (err) {
      console.error('Sentiment fetch error:', err);
    } finally {
      setScoringSentiment(false);
    }
  }, []);

  const fetchNews = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const params = new URLSearchParams({ limit: '30' });
      if (filter !== 'all' && filter !== 'portfolio') {
        params.set('symbols', filter);
      }

      const res = await fetch(`/api/news?${params}`);
      let allArticles: NewsArticle[] = [];
      if (res.ok) {
        const data = await res.json();
        allArticles = (data.articles || []).map((a: NewsArticle) => ({ ...a, newsSource: 'benzinga' }));
      }

      try {
        const finnhubRes = await fetch('/api/news/finnhub');
        if (finnhubRes.ok) {
          const finnhubData = await finnhubRes.json();
          const finnhubArticles = (finnhubData.articles || []).map((a: NewsArticle) => ({ ...a, newsSource: 'finnhub' }));
          allArticles = [...allArticles, ...finnhubArticles];
        }
      } catch {
        /* Finnhub not available */
      }

      allArticles.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (isBackground && articlesRef.current.length > 0) {
        const existingKeys = new Set(articlesRef.current.map(articleKey));
        const freshCount = allArticles.filter(a => !existingKeys.has(articleKey(a))).length;
        if (freshCount > 0) {
          setPendingArticles(allArticles);
          return;
        }
        setArticles(allArticles);
        setLastUpdated(Date.now());
        return;
      }

      setArticles(allArticles);
      setLastUpdated(Date.now());
      setPendingArticles(null);
      fetchSentiment(allArticles);
    } catch (err) {
      console.error('News fetch error:', err);
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [filter, fetchSentiment]);

  // Initial + filter-change fetch
  useEffect(() => {
    fetchNews(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Background auto-refresh every 2 minutes (no scroll jump)
  useEffect(() => {
    const interval = setInterval(() => fetchNews(true), 120_000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  const applyPending = useCallback(() => {
    if (!pendingArticles) return;
    setArticles(pendingArticles);
    setLastUpdated(Date.now());
    fetchSentiment(pendingArticles);
    setPendingArticles(null);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [pendingArticles, fetchSentiment]);

  const savedCount = savedIds.size;

  const sourceArticles = useMemo(() => {
    if (activeTab === 'saved') return articles.filter(a => savedIds.has(articleKey(a)));
    return articles;
  }, [articles, savedIds, activeTab]);

  const filteredArticles = useMemo(() => sourceArticles.filter(a => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!a.headline.toLowerCase().includes(q)
        && !a.summary?.toLowerCase().includes(q)
        && !a.symbols.some(s => s.toLowerCase().includes(q))) {
        return false;
      }
    }
    if (sentimentFilter !== 'all' && a.sentiment !== sentimentFilter) return false;
    if (sourceFilter !== 'all' && a.newsSource !== sourceFilter) return false;
    if (relevantOnly && !isRelevant(a)) return false;
    return true;
  }), [sourceArticles, searchQuery, sentimentFilter, sourceFilter, relevantOnly]);

  const sentimentStats = useMemo(() => {
    const scored = articles.filter(a => a.sentiment);
    const total = scored.length;
    if (total === 0) return null;
    const bullish = scored.filter(a => a.sentiment === 'BULLISH').length;
    const bearish = scored.filter(a => a.sentiment === 'BEARISH').length;
    const neutral = scored.filter(a => a.sentiment === 'NEUTRAL').length;
    return {
      total,
      bullish, bearish, neutral,
      bullishPct: Math.round((bullish / total) * 100),
      bearishPct: Math.round((bearish / total) * 100),
      neutralPct: Math.round((neutral / total) * 100),
    };
  }, [articles]);

  const trendingTickers = useMemo(() => {
    const counts: Record<string, number> = {};
    articles.forEach(a => {
      a.symbols.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([symbol, count]) => ({ symbol, count }));
  }, [articles]);

  const relevantCount = useMemo(() => articles.filter(isRelevant).length, [articles]);

  const featuredArticles = filteredArticles.slice(0, 5);
  const feedArticles = filteredArticles.slice(5);

  const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const lastUpdatedLabel = useMemo(() => {
    const diffSec = Math.max(0, Math.floor((nowTick - lastUpdated) / 1000));
    if (diffSec < 10) return 'Updated just now';
    if (diffSec < 60) return `Updated ${diffSec}s ago`;
    const m = Math.floor(diffSec / 60);
    if (m < 60) return `Updated ${m}m ago`;
    const h = Math.floor(m / 60);
    return `Updated ${h}h ago`;
  }, [nowTick, lastUpdated]);

  const quickFilters = [
    { label: 'All News', value: 'all' },
    { label: 'Tech', value: 'AAPL,MSFT,GOOGL,META,AMZN,NVDA' },
    { label: 'Finance', value: 'JPM,GS,BAC,MS,WFC' },
    { label: 'Energy', value: 'XOM,CVX,COP,SLB' },
    { label: 'Crypto', value: 'BTC,ETH,COIN' },
  ];

  const sentimentFilters = [
    { label: 'All Sentiment', value: 'all' },
    { label: 'Bullish', value: 'BULLISH' },
    { label: 'Bearish', value: 'BEARISH' },
    { label: 'Neutral', value: 'NEUTRAL' },
  ];

  const sourceFilters = [
    { label: 'All Sources', value: 'all' },
    { label: 'Benzinga', value: 'benzinga' },
    { label: 'Finnhub', value: 'finnhub' },
  ];

  return (
    <AppShell>
      <ErrorBoundary label="News">
        <div style={{ display: 'flex', gap: 24 }}>
          {/* Main content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
              <div>
                <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Market News</h1>
                <p style={{ color: '#888', fontSize: 13, margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>Live feed via Benzinga &bull; Finnhub</span>
                  <span style={{ color: '#555' }}>&bull;</span>
                  <span style={{ color: '#c9a84c' }}>{lastUpdatedLabel}</span>
                  {scoringSentiment && <><span style={{ color: '#555' }}>&bull;</span><span style={{ color: '#c4a6ff' }}>Scoring sentiment...</span></>}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  display: 'inline-flex', padding: 3, borderRadius: 8,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <button
                    onClick={() => setActiveTab('feed')}
                    style={{
                      padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12,
                      background: activeTab === 'feed' ? 'rgba(138, 92, 246, 0.2)' : 'transparent',
                      color: activeTab === 'feed' ? '#c4a6ff' : '#888',
                      fontWeight: activeTab === 'feed' ? 600 : 500,
                    }}
                  >
                    Feed
                  </button>
                  <button
                    onClick={() => setActiveTab('saved')}
                    style={{
                      padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12,
                      background: activeTab === 'saved' ? 'rgba(240, 198, 116, 0.2)' : 'transparent',
                      color: activeTab === 'saved' ? '#f0c674' : '#888',
                      fontWeight: activeTab === 'saved' ? 600 : 500,
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    <Bookmark size={11} />
                    Saved
                    {savedCount > 0 && (
                      <span style={{
                        background: 'rgba(240, 198, 116, 0.25)', color: '#f0c674',
                        padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                      }}>{savedCount}</span>
                    )}
                  </button>
                </div>
                <button
                  onClick={() => fetchNews(false)}
                  style={{
                    background: 'rgba(138, 92, 246, 0.15)',
                    border: '1px solid rgba(138, 92, 246, 0.3)',
                    borderRadius: 8, color: '#c4a6ff', padding: '8px 16px',
                    cursor: 'pointer', fontSize: 13,
                  }}
                >
                  Refresh
                </button>
              </div>
            </div>

            {/* New articles available banner */}
            {pendingArticles && (
              <button
                onClick={applyPending}
                style={{
                  width: '100%', marginBottom: 16, padding: '10px 14px',
                  background: 'linear-gradient(90deg, rgba(138, 92, 246, 0.18), rgba(240, 198, 116, 0.12))',
                  border: '1px solid rgba(138, 92, 246, 0.4)', borderRadius: 8,
                  color: '#e0e0e0', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  animation: 'slideDown 0.3s ease',
                }}
              >
                <ArrowUpCircle size={15} color="#c4a6ff" />
                <span>{pendingArticles.length} new articles available &mdash; click to refresh</span>
              </button>
            )}

            {/* Filters */}
            <div style={{ marginBottom: 16 }}>
              <input
                type="text"
                placeholder="Search news by keyword or ticker..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%', padding: '10px 14px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(138, 92, 246, 0.2)',
                  borderRadius: 8, color: '#fff', fontSize: 14,
                  marginBottom: 10, outline: 'none', boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
                {quickFilters.map(f => (
                  <button key={f.value} onClick={() => setFilter(f.value)} style={{
                    padding: '5px 12px', borderRadius: 20,
                    border: filter === f.value ? '1px solid #f0c674' : '1px solid rgba(255,255,255,0.1)',
                    background: filter === f.value ? 'rgba(240, 198, 116, 0.15)' : 'rgba(255,255,255,0.03)',
                    color: filter === f.value ? '#f0c674' : '#888',
                    fontSize: 11, fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s',
                  }}>
                    {f.label}
                  </button>
                ))}
                <button
                  onClick={() => setRelevantOnly(v => !v)}
                  title="Show only Florida / roofing / storm / construction stories"
                  style={{
                    padding: '5px 12px', borderRadius: 20,
                    border: relevantOnly ? '1px solid #f0c674' : '1px solid rgba(240, 198, 116, 0.25)',
                    background: relevantOnly
                      ? 'linear-gradient(90deg, rgba(240, 198, 116, 0.25), rgba(240, 198, 116, 0.12))'
                      : 'rgba(240, 198, 116, 0.05)',
                    color: relevantOnly ? '#f0c674' : '#c9a84c',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Zap size={11} />
                  Relevant{relevantCount > 0 && ` (${relevantCount})`}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {sentimentFilters.map(f => (
                  <button key={f.value} onClick={() => setSentimentFilter(f.value)} style={{
                    padding: '4px 10px', borderRadius: 20,
                    border: sentimentFilter === f.value ? '1px solid #8a5cf6' : '1px solid rgba(255,255,255,0.08)',
                    background: sentimentFilter === f.value ? 'rgba(138, 92, 246, 0.15)' : 'rgba(255,255,255,0.02)',
                    color: sentimentFilter === f.value ? '#c4a6ff' : '#666',
                    fontSize: 10, cursor: 'pointer', transition: 'all 0.2s',
                  }}>
                    {f.label}
                  </button>
                ))}
                <span style={{ color: '#333', margin: '0 2px', lineHeight: '24px' }}>|</span>
                {sourceFilters.map(f => (
                  <button key={f.value} onClick={() => setSourceFilter(f.value)} style={{
                    padding: '4px 10px', borderRadius: 20,
                    border: sourceFilter === f.value ? '1px solid #8a5cf6' : '1px solid rgba(255,255,255,0.08)',
                    background: sourceFilter === f.value ? 'rgba(138, 92, 246, 0.15)' : 'rgba(255,255,255,0.02)',
                    color: sourceFilter === f.value ? '#c4a6ff' : '#666',
                    fontSize: 10, cursor: 'pointer', transition: 'all 0.2s',
                  }}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sentiment Summary Bar */}
            {sentimentStats && (
              <div style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 10, padding: '12px 16px', marginBottom: 20,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#888' }}>Today&apos;s Sentiment:</span>
                  <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>{sentimentStats.bullishPct}% Bullish</span>
                  <span style={{ fontSize: 11, color: '#555' }}>&bull;</span>
                  <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{sentimentStats.neutralPct}% Neutral</span>
                  <span style={{ fontSize: 11, color: '#555' }}>&bull;</span>
                  <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>{sentimentStats.bearishPct}% Bearish</span>
                  <span style={{ fontSize: 11, color: '#555' }}>&bull;</span>
                  <span style={{ fontSize: 11, color: '#666' }}>{sentimentStats.total} articles analyzed</span>
                </div>
                <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }}>
                  {sentimentStats.bullishPct > 0 && (
                    <div style={{ width: `${sentimentStats.bullishPct}%`, background: '#22c55e', transition: 'width 0.5s ease' }} />
                  )}
                  {sentimentStats.neutralPct > 0 && (
                    <div style={{ width: `${sentimentStats.neutralPct}%`, background: '#6b7280', transition: 'width 0.5s ease' }} />
                  )}
                  {sentimentStats.bearishPct > 0 && (
                    <div style={{ width: `${sentimentStats.bearishPct}%`, background: '#ef4444', transition: 'width 0.5s ease' }} />
                  )}
                </div>
              </div>
            )}

            {loading ? (
              /* Loading skeletons */
              <div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 24, overflowX: 'auto' }}>
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} style={{
                      minWidth: 280, borderRadius: 10, overflow: 'hidden',
                      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      <div className="news-img-skeleton" style={{ height: 150 }} />
                      <div style={{ padding: 14 }}>
                        <div style={{ height: 12, width: '80%', borderRadius: 4, background: 'rgba(255,255,255,0.06)', marginBottom: 8, animation: 'pulse 1.5s ease-in-out infinite' }} />
                        <div style={{ height: 10, width: '60%', borderRadius: 4, background: 'rgba(255,255,255,0.04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
                      </div>
                    </div>
                  ))}
                </div>
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} style={{
                    display: 'flex', gap: 12, padding: '12px 16px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <div className="news-img-skeleton" style={{ width: 80, height: 56, borderRadius: 6, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 12, width: '70%', borderRadius: 4, background: 'rgba(255,255,255,0.06)', marginBottom: 8, animation: 'pulse 1.5s ease-in-out infinite' }} />
                      <div style={{ height: 10, width: '40%', borderRadius: 4, background: 'rgba(255,255,255,0.04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredArticles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>
                {activeTab === 'saved'
                  ? 'No saved articles yet. Click the bookmark icon on any article to save it for later.'
                  : 'No news articles match your filters.'}
              </div>
            ) : (
              <>
                {/* Featured Story Cards */}
                <div style={{
                  display: 'flex', gap: 12, marginBottom: 24,
                  overflowX: 'auto', paddingBottom: 4,
                }}>
                  {featuredArticles.map((article, i) => {
                    const si = article.sentiment ? SENTIMENT_COLORS[article.sentiment] : null;
                    const sb = article.newsSource ? SOURCE_BADGE[article.newsSource] : null;
                    const key = articleKey(article);
                    const saved = savedIds.has(key);
                    const relevant = isRelevant(article);
                    const fallbackGradient = si
                      ? `linear-gradient(135deg, ${si.color}22, ${si.color}08)`
                      : 'linear-gradient(135deg, rgba(40,40,60,1), rgba(26,26,46,1))';
                    return (
                      <a
                        key={`${key}-${i}`}
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          minWidth: 280, maxWidth: 300, flex: '0 0 auto',
                          background: 'rgba(26, 26, 46, 0.8)',
                          border: relevant ? '1px solid rgba(240, 198, 116, 0.55)' : '1px solid rgba(255,255,255,0.06)',
                          boxShadow: relevant ? '0 0 0 1px rgba(240, 198, 116, 0.15), 0 4px 14px rgba(240, 198, 116, 0.08)' : undefined,
                          borderRadius: 10, textDecoration: 'none',
                          display: 'flex', flexDirection: 'column',
                          overflow: 'hidden',
                          transition: 'all 0.2s',
                          animation: `fadeSlideIn 0.3s ease ${i * 0.08}s both`,
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.borderColor = relevant ? '#f0c674' : 'rgba(138, 92, 246, 0.3)';
                          e.currentTarget.style.background = 'rgba(26, 26, 46, 1)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.borderColor = relevant ? 'rgba(240, 198, 116, 0.55)' : 'rgba(255,255,255,0.06)';
                          e.currentTarget.style.background = 'rgba(26, 26, 46, 0.8)';
                        }}
                      >
                        <div style={{
                          width: '100%', height: 150, position: 'relative',
                          background: fallbackGradient,
                          overflow: 'hidden',
                        }}>
                          <ArticleImage
                            src={article.image}
                            alt={article.headline}
                            fallbackGradient={fallbackGradient}
                          />
                          {si && (
                            <div style={{
                              position: 'absolute', top: 8, right: 8,
                              width: 12, height: 12, borderRadius: '50%',
                              background: si.color, border: '2px solid rgba(0,0,0,0.4)',
                            }} />
                          )}
                          {relevant && (
                            <div style={{
                              position: 'absolute', top: 8, left: 8,
                              padding: '3px 7px', borderRadius: 4,
                              background: 'rgba(240, 198, 116, 0.92)',
                              color: '#1a1030', fontSize: 9, fontWeight: 800,
                              textTransform: 'uppercase', letterSpacing: '0.06em',
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                            }}>
                              <Zap size={10} strokeWidth={2.8} /> Relevant
                            </div>
                          )}
                          <button
                            type="button"
                            aria-label={saved ? 'Remove from saved' : 'Save for later'}
                            onClick={e => { e.preventDefault(); e.stopPropagation(); toggleSave(key); }}
                            style={{
                              position: 'absolute', bottom: 8, right: 8,
                              width: 28, height: 28, borderRadius: 6,
                              background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.12)',
                              color: saved ? '#f0c674' : '#ccc', cursor: 'pointer',
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              backdropFilter: 'blur(4px)',
                            }}
                          >
                            {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                          </button>
                        </div>

                        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            {sb && (
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                                background: sb.bg, color: sb.color, textTransform: 'uppercase',
                              }}>
                                {article.newsSource}
                              </span>
                            )}
                            <span style={{ fontSize: 10, color: '#666' }}>{timeAgo(article.created_at)}</span>
                            <span style={{ fontSize: 10, color: '#666', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <Clock size={9} />~{readingMin(article)} min read
                            </span>
                          </div>

                          <h3 style={{
                            fontSize: 14, fontWeight: 600, color: '#e0e0e0',
                            margin: 0, lineHeight: 1.4,
                            display: '-webkit-box', WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          }}>
                            {article.headline}
                          </h3>

                          {article.summary && (
                            <p style={{
                              fontSize: 11, color: '#555', margin: 0, lineHeight: 1.4,
                              display: '-webkit-box', WebkitLineClamp: 1,
                              WebkitBoxOrient: 'vertical', overflow: 'hidden',
                            }}>
                              {article.summary}
                            </p>
                          )}

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 'auto' }}>
                            {article.symbols.length > 0 ? (
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {article.symbols.slice(0, 3).map(s => (
                                  <span key={s} style={{
                                    background: 'rgba(240, 198, 116, 0.1)', color: '#f0c674',
                                    padding: '1px 6px', borderRadius: 3, fontSize: 9,
                                    fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                                  }}>{s}</span>
                                ))}
                                {article.symbols.length > 3 && (
                                  <span style={{ color: '#555', fontSize: 9 }}>+{article.symbols.length - 3}</span>
                                )}
                              </div>
                            ) : <span />}
                            <ShareRow
                              article={article}
                              copied={copiedKey === key}
                              onCopy={() => handleCopy(key, article.url)}
                            />
                          </div>
                        </div>
                      </a>
                    );
                  })}
                </div>

                {/* Feed Rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {feedArticles.map((article, i) => {
                    const si = article.sentiment ? SENTIMENT_COLORS[article.sentiment] : null;
                    const sb = article.newsSource ? SOURCE_BADGE[article.newsSource] : null;
                    const borderColor = si?.border || '#2a2a3a';
                    const key = articleKey(article);
                    const saved = savedIds.has(key);
                    const relevant = isRelevant(article);
                    const fallbackGradient = si
                      ? `linear-gradient(135deg, ${si.color}22, ${si.color}08)`
                      : 'rgba(255,255,255,0.04)';
                    return (
                      <a
                        key={`${key}-${i}`}
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 12,
                          padding: '12px 16px 12px 20px',
                          background: relevant ? 'rgba(240, 198, 116, 0.04)' : 'rgba(255,255,255,0.02)',
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          borderLeft: `3px solid ${relevant ? '#f0c674' : borderColor}`,
                          textDecoration: 'none',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'rgba(138, 92, 246, 0.06)';
                          e.currentTarget.style.borderLeftWidth = '5px';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = relevant ? 'rgba(240, 198, 116, 0.04)' : 'rgba(255,255,255,0.02)';
                          e.currentTarget.style.borderLeftWidth = '3px';
                        }}
                      >
                        <div style={{
                          width: 80, height: 56, borderRadius: 6, flexShrink: 0,
                          position: 'relative',
                          overflow: 'hidden',
                          background: typeof fallbackGradient === 'string' && fallbackGradient.startsWith('rgba')
                            ? fallbackGradient
                            : fallbackGradient,
                        }}>
                          <ArticleImage
                            src={article.image}
                            alt={article.headline}
                            fallbackGradient={typeof fallbackGradient === 'string' ? fallbackGradient : 'rgba(255,255,255,0.04)'}
                          />
                        </div>

                        <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <h3 style={{
                              fontSize: 14, fontWeight: 600, color: '#e0e0e0',
                              margin: '0 0 3px', lineHeight: 1.4,
                              display: '-webkit-box', WebkitLineClamp: 1,
                              WebkitBoxOrient: 'vertical', overflow: 'hidden',
                            }}>
                              {article.headline}
                            </h3>
                            {article.summary && (
                              <p style={{
                                fontSize: 12, color: '#555', margin: '0 0 5px',
                                lineHeight: 1.4, whiteSpace: 'nowrap',
                                overflow: 'hidden', textOverflow: 'ellipsis',
                                maxWidth: '100%',
                              }}>
                                {article.summary.slice(0, 100)}{article.summary.length > 100 ? '...' : ''}
                              </p>
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, flexWrap: 'wrap' }}>
                              {sb && (
                                <span style={{
                                  fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                                  background: sb.bg, color: sb.color, textTransform: 'uppercase',
                                }}>
                                  {article.newsSource}
                                </span>
                              )}
                              <span style={{ color: '#666' }}>{timeAgo(article.created_at)}</span>
                              <span style={{ color: '#666', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <Clock size={9} />~{readingMin(article)}m
                              </span>
                              {relevant && (
                                <span style={{
                                  fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
                                  background: 'rgba(240, 198, 116, 0.18)', color: '#f0c674',
                                  textTransform: 'uppercase', letterSpacing: '0.05em',
                                  display: 'inline-flex', alignItems: 'center', gap: 3,
                                }}>
                                  <Zap size={9} /> Relevant
                                </span>
                              )}
                              {article.symbols.length > 0 && (
                                <>
                                  <span style={{ color: '#333' }}>&bull;</span>
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    {article.symbols.slice(0, 4).map(s => (
                                      <span
                                        key={s}
                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/stock/${s}`; }}
                                        style={{
                                          background: 'rgba(240, 198, 116, 0.1)', color: '#f0c674',
                                          padding: '1px 6px', borderRadius: 3, fontSize: 9,
                                          fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                                          cursor: 'pointer',
                                        }}
                                      >{s}</span>
                                    ))}
                                    {article.symbols.length > 4 && (
                                      <span style={{ color: '#555', fontSize: 9 }}>+{article.symbols.length - 4}</span>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            {si && (
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: '3px 8px',
                                borderRadius: 4, background: si.bg, color: si.color,
                                textTransform: 'uppercase', whiteSpace: 'nowrap',
                                letterSpacing: '0.03em',
                              }}>
                                {si.label}
                              </span>
                            )}
                            <ShareRow
                              article={article}
                              copied={copiedKey === key}
                              onCopy={() => handleCopy(key, article.url)}
                            />
                            <button
                              type="button"
                              aria-label={saved ? 'Remove from saved' : 'Save for later'}
                              onClick={e => { e.preventDefault(); e.stopPropagation(); toggleSave(key); }}
                              style={{
                                width: 24, height: 24, borderRadius: 4,
                                background: saved ? 'rgba(240, 198, 116, 0.15)' : 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                color: saved ? '#f0c674' : '#888', cursor: 'pointer',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              }}
                            >
                              {saved ? <BookmarkCheck size={12} /> : <Bookmark size={12} />}
                            </button>
                          </div>
                        </div>
                      </a>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Sidebar: Market Pulse */}
          <div style={{
            width: 200, flexShrink: 0,
            display: 'none',
          }} className="news-sidebar">
            <div style={{
              position: 'sticky', top: 24,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10, padding: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <TrendingUp size={14} color="#c9a84c" />
                <span style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Trending Tickers
                </span>
              </div>
              {trendingTickers.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {trendingTickers.map(t => (
                    <div key={t.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <a href={`/stock/${t.symbol}`} style={{
                        color: '#f0c674', fontSize: 12, fontWeight: 600,
                        fontFamily: "'JetBrains Mono', monospace", textDecoration: 'none',
                      }}>
                        {t.symbol}
                      </a>
                      <span style={{ fontSize: 10, color: '#555' }}>{t.count} mentions</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 11, color: '#555', margin: 0 }}>No ticker data yet</p>
              )}
            </div>
          </div>
        </div>

        <style>{`
          @keyframes fadeSlideIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes slideDown {
            from { opacity: 0; transform: translateY(-8px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 0.7; }
          }
          @keyframes newsShimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
          }
          .news-img-skeleton {
            background: linear-gradient(
              90deg,
              rgba(26, 26, 46, 1) 0%,
              rgba(42, 42, 62, 1) 50%,
              rgba(26, 26, 46, 1) 100%
            );
            background-size: 200% 100%;
            animation: newsShimmer 1.5s infinite linear;
          }
          @media (min-width: 1400px) {
            .news-sidebar { display: block !important; }
          }
        `}</style>
      </ErrorBoundary>
    </AppShell>
  );
}
