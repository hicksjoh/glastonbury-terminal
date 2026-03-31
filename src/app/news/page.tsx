'use client';

import { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';

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

const SENTIMENT_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  BULLISH: { bg: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', label: 'Bullish' },
  BEARISH: { bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171', label: 'Bearish' },
  NEUTRAL: { bg: 'rgba(255,255,255,0.06)', color: '#888', label: 'Neutral' },
};

export default function NewsPage() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [sentimentFilter, setSentimentFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [scoringSentiment, setScoringSentiment] = useState(false);

  const fetchSentiment = useCallback(async (articles: NewsArticle[]) => {
    // Only score headlines less than 24 hours old
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentArticles = articles.filter(a => new Date(a.created_at).getTime() > cutoff);
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

  const fetchNews = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ limit: '30' });
      if (filter !== 'all' && filter !== 'portfolio') {
        params.set('symbols', filter);
      }

      // Fetch from Benzinga/Alpaca
      const res = await fetch(`/api/news?${params}`);
      let allArticles: NewsArticle[] = [];
      if (res.ok) {
        const data = await res.json();
        allArticles = (data.articles || []).map((a: NewsArticle) => ({ ...a, newsSource: 'benzinga' }));
      }

      // Fetch from Finnhub if available
      try {
        const finnhubRes = await fetch('/api/news/finnhub');
        if (finnhubRes.ok) {
          const finnhubData = await finnhubRes.json();
          const finnhubArticles = (finnhubData.articles || []).map((a: NewsArticle) => ({ ...a, newsSource: 'finnhub' }));
          allArticles = [...allArticles, ...finnhubArticles];
        }
      } catch {
        // Finnhub not available, continue with Benzinga only
      }

      // Sort by timestamp
      allArticles.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setArticles(allArticles);

      // Score sentiment in background
      fetchSentiment(allArticles);
    } catch (err) {
      console.error('News fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [filter, fetchSentiment]);

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 120000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  const filteredArticles = articles.filter(a => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!a.headline.toLowerCase().includes(q) && !a.summary.toLowerCase().includes(q) && !a.symbols.some(s => s.toLowerCase().includes(q))) {
        return false;
      }
    }
    if (sentimentFilter !== 'all' && a.sentiment !== sentimentFilter) return false;
    if (sourceFilter !== 'all' && a.newsSource !== sourceFilter) return false;
    return true;
  });

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

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

  const SOURCE_BADGE: Record<string, { bg: string; color: string }> = {
    benzinga: { bg: 'rgba(249, 115, 22, 0.15)', color: '#f97316' },
    finnhub: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' },
  };

  return (
    <AppShell>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Market News</h1>
            <p style={{ color: '#888', fontSize: 14, margin: '4px 0 0' }}>
              Live feed via Benzinga &bull; Finnhub
              {scoringSentiment && <span style={{ color: '#c9a84c', marginLeft: 8 }}>Scoring sentiment...</span>}
            </p>
          </div>
          <button
            onClick={fetchNews}
            style={{
              background: 'rgba(138, 92, 246, 0.15)',
              border: '1px solid rgba(138, 92, 246, 0.3)',
              borderRadius: 8,
              color: '#c4a6ff',
              padding: '8px 16px',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Refresh
          </button>
        </div>

        {/* Search + Filters */}
        <div style={{ marginBottom: 20 }}>
          <input
            type="text"
            placeholder="Search news by keyword or ticker..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(138, 92, 246, 0.2)',
              borderRadius: 8,
              color: '#fff',
              fontSize: 14,
              marginBottom: 12,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {/* Category filters */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {quickFilters.map(f => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 20,
                  border: filter === f.value ? '1px solid #f0c674' : '1px solid rgba(255,255,255,0.1)',
                  background: filter === f.value ? 'rgba(240, 198, 116, 0.15)' : 'rgba(255,255,255,0.03)',
                  color: filter === f.value ? '#f0c674' : '#888',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          {/* Sentiment + Source filters */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {sentimentFilters.map(f => (
              <button
                key={f.value}
                onClick={() => setSentimentFilter(f.value)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 20,
                  border: sentimentFilter === f.value ? '1px solid #8a5cf6' : '1px solid rgba(255,255,255,0.08)',
                  background: sentimentFilter === f.value ? 'rgba(138, 92, 246, 0.15)' : 'rgba(255,255,255,0.02)',
                  color: sentimentFilter === f.value ? '#c4a6ff' : '#666',
                  fontSize: 11,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {f.label}
              </button>
            ))}
            <span style={{ color: '#333', margin: '0 4px', lineHeight: '28px' }}>|</span>
            {sourceFilters.map(f => (
              <button
                key={f.value}
                onClick={() => setSourceFilter(f.value)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 20,
                  border: sourceFilter === f.value ? '1px solid #8a5cf6' : '1px solid rgba(255,255,255,0.08)',
                  background: sourceFilter === f.value ? 'rgba(138, 92, 246, 0.15)' : 'rgba(255,255,255,0.02)',
                  color: sourceFilter === f.value ? '#c4a6ff' : '#666',
                  fontSize: 11,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* News Articles */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>Loading market news...</div>
        ) : filteredArticles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>No news articles found</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {filteredArticles.map((article, i) => {
              const sentimentInfo = article.sentiment ? SENTIMENT_COLORS[article.sentiment] : null;
              const sourceBadge = article.newsSource ? SOURCE_BADGE[article.newsSource] : null;
              return (
                <a
                  key={i}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    padding: '16px 20px',
                    background: 'rgba(255,255,255,0.02)',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    textDecoration: 'none',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(138, 92, 246, 0.08)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 600, color: '#e0e0e0', margin: 0, lineHeight: 1.4, flex: 1 }}>
                          {article.headline}
                        </h3>
                        {sentimentInfo && (
                          <span style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 4,
                            background: sentimentInfo.bg,
                            color: sentimentInfo.color,
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}>
                            {sentimentInfo.label}
                          </span>
                        )}
                      </div>
                      {article.summary && (
                        <p style={{
                          fontSize: 13,
                          color: '#888',
                          margin: '0 0 8px',
                          lineHeight: 1.5,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}>
                          {article.summary}
                        </p>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11 }}>
                        <span style={{ color: '#8a5cf6', fontWeight: 500 }}>{article.source}</span>
                        {sourceBadge && (
                          <span style={{
                            fontSize: 9,
                            fontWeight: 600,
                            padding: '1px 6px',
                            borderRadius: 3,
                            background: sourceBadge.bg,
                            color: sourceBadge.color,
                            textTransform: 'uppercase',
                          }}>
                            {article.newsSource}
                          </span>
                        )}
                        <span style={{ color: '#555' }}>&bull;</span>
                        <span style={{ color: '#666' }}>{timeAgo(article.created_at)}</span>
                        {article.symbols.length > 0 && (
                          <>
                            <span style={{ color: '#555' }}>&bull;</span>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {article.symbols.slice(0, 4).map(s => (
                                <span key={s} onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/stock/${s}`; }} style={{
                                  background: 'rgba(240, 198, 116, 0.1)',
                                  color: '#f0c674',
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontFamily: "'JetBrains Mono', monospace",
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}>
                                  {s}
                                </span>
                              ))}
                              {article.symbols.length > 4 && (
                                <span style={{ color: '#666', fontSize: 10 }}>+{article.symbols.length - 4}</span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
