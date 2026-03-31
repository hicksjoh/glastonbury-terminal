'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { TrendingUp } from 'lucide-react';

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

export default function NewsPage() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [sentimentFilter, setSentimentFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [scoringSentiment, setScoringSentiment] = useState(false);

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

  const fetchNews = useCallback(async () => {
    try {
      setLoading(true);
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
        // Finnhub not available
      }

      allArticles.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setArticles(allArticles);
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
      if (!a.headline.toLowerCase().includes(q) && !a.summary?.toLowerCase().includes(q) && !a.symbols.some(s => s.toLowerCase().includes(q))) {
        return false;
      }
    }
    if (sentimentFilter !== 'all' && a.sentiment !== sentimentFilter) return false;
    if (sourceFilter !== 'all' && a.newsSource !== sourceFilter) return false;
    return true;
  });

  // Sentiment summary stats
  const sentimentStats = useMemo(() => {
    const scored = articles.filter(a => a.sentiment);
    const total = scored.length;
    if (total === 0) return null;
    const bullish = scored.filter(a => a.sentiment === 'BULLISH').length;
    const bearish = scored.filter(a => a.sentiment === 'BEARISH').length;
    const neutral = scored.filter(a => a.sentiment === 'NEUTRAL').length;
    return {
      total,
      bullish,
      bearish,
      neutral,
      bullishPct: Math.round((bullish / total) * 100),
      bearishPct: Math.round((bearish / total) * 100),
      neutralPct: Math.round((neutral / total) * 100),
    };
  }, [articles]);

  // Trending tickers (top 5 most mentioned)
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

  // Featured stories: top 5 most recent
  const featuredArticles = filteredArticles.slice(0, 5);
  const feedArticles = filteredArticles.slice(5);

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
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

  return (
    <AppShell>
      <div style={{ display: 'flex', gap: 24 }}>
        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
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
                borderRadius: 8, color: '#c4a6ff', padding: '8px 16px',
                cursor: 'pointer', fontSize: 13,
              }}
            >
              Refresh
            </button>
          </div>

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
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#888' }}>Today&apos;s Sentiment:</span>
                <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>{sentimentStats.bullishPct}% Bullish</span>
                <span style={{ fontSize: 11, color: '#555' }}>&bull;</span>
                <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{sentimentStats.neutralPct}% Neutral</span>
                <span style={{ fontSize: 11, color: '#555' }}>&bull;</span>
                <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>{sentimentStats.bearishPct}% Bearish</span>
                <span style={{ fontSize: 11, color: '#555' }}>&bull;</span>
                <span style={{ fontSize: 11, color: '#666' }}>{sentimentStats.total} articles analyzed</span>
              </div>
              {/* Stacked sentiment bar */}
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
                    <div style={{ height: 150, background: 'rgba(255,255,255,0.04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
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
                  <div style={{ width: 80, height: 56, borderRadius: 6, background: 'rgba(255,255,255,0.04)', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 12, width: '70%', borderRadius: 4, background: 'rgba(255,255,255,0.06)', marginBottom: 8, animation: 'pulse 1.5s ease-in-out infinite' }} />
                    <div style={{ height: 10, width: '40%', borderRadius: 4, background: 'rgba(255,255,255,0.04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredArticles.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>No news articles found</div>
          ) : (
            <>
              {/* Section 2: Featured Story Cards with Images */}
              <div style={{
                display: 'flex', gap: 12, marginBottom: 24,
                overflowX: 'auto', paddingBottom: 4,
              }}>
                {featuredArticles.map((article, i) => {
                  const si = article.sentiment ? SENTIMENT_COLORS[article.sentiment] : null;
                  const sb = article.newsSource ? SOURCE_BADGE[article.newsSource] : null;
                  const fallbackGradient = si
                    ? `linear-gradient(135deg, ${si.color}22, ${si.color}08)`
                    : 'linear-gradient(135deg, rgba(40,40,60,1), rgba(26,26,46,1))';
                  return (
                    <a
                      key={i}
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        minWidth: 280, maxWidth: 300, flex: '0 0 auto',
                        background: 'rgba(26, 26, 46, 0.8)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: 10, textDecoration: 'none',
                        display: 'flex', flexDirection: 'column',
                        overflow: 'hidden',
                        transition: 'all 0.2s',
                        animation: `fadeSlideIn 0.3s ease ${i * 0.08}s both`,
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'rgba(138, 92, 246, 0.3)';
                        e.currentTarget.style.background = 'rgba(26, 26, 46, 1)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                        e.currentTarget.style.background = 'rgba(26, 26, 46, 0.8)';
                      }}
                    >
                      {/* Card Image */}
                      <div style={{
                        width: '100%', height: 150, position: 'relative',
                        background: fallbackGradient,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        overflow: 'hidden',
                      }}>
                        {article.image ? (
                          <img
                            src={article.image}
                            alt=""
                            loading="lazy"
                            style={{
                              width: '100%', height: '100%',
                              objectFit: 'cover', display: 'block',
                            }}
                            onError={e => {
                              const target = e.currentTarget;
                              target.style.display = 'none';
                              const parent = target.parentElement;
                              if (parent) {
                                parent.style.background = fallbackGradient;
                              }
                            }}
                          />
                        ) : (
                          <span style={{
                            fontSize: 32, fontWeight: 800, color: 'rgba(255,255,255,0.08)',
                            fontFamily: "'JetBrains Mono', monospace",
                          }}>
                            {article.symbols[0] || article.source?.charAt(0) || ''}
                          </span>
                        )}
                        {/* Sentiment dot overlay */}
                        {si && (
                          <div style={{
                            position: 'absolute', top: 8, right: 8,
                            width: 12, height: 12, borderRadius: '50%',
                            background: si.color, border: '2px solid rgba(0,0,0,0.4)',
                          }} />
                        )}
                      </div>

                      {/* Card Content */}
                      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {sb && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                              background: sb.bg, color: sb.color, textTransform: 'uppercase',
                            }}>
                              {article.newsSource}
                            </span>
                          )}
                          <span style={{ fontSize: 10, color: '#666' }}>{timeAgo(article.created_at)}</span>
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

                        {article.symbols.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 'auto' }}>
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
                        )}
                      </div>
                    </a>
                  );
                })}
              </div>

              {/* Section 3: Full Feed with Thumbnails */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {feedArticles.map((article, i) => {
                  const si = article.sentiment ? SENTIMENT_COLORS[article.sentiment] : null;
                  const sb = article.newsSource ? SOURCE_BADGE[article.newsSource] : null;
                  const borderColor = si?.border || '#2a2a3a';
                  return (
                    <a
                      key={i}
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 12,
                        padding: '12px 16px 12px 20px',
                        background: 'rgba(255,255,255,0.02)',
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        borderLeft: `3px solid ${borderColor}`,
                        textDecoration: 'none',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(138, 92, 246, 0.06)';
                        e.currentTarget.style.borderLeftWidth = '5px';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                        e.currentTarget.style.borderLeftWidth = '3px';
                      }}
                    >
                      {/* Row Thumbnail */}
                      <div style={{
                        width: 80, height: 56, borderRadius: 6, flexShrink: 0,
                        overflow: 'hidden',
                        background: si
                          ? `linear-gradient(135deg, ${si.color}22, ${si.color}08)`
                          : 'rgba(255,255,255,0.04)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {article.image ? (
                          <img
                            src={article.image}
                            alt=""
                            loading="lazy"
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            onError={e => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          <span style={{
                            fontSize: 18, fontWeight: 800, color: 'rgba(255,255,255,0.08)',
                            fontFamily: "'JetBrains Mono', monospace",
                          }}>
                            {article.symbols[0]?.charAt(0) || ''}
                          </span>
                        )}
                      </div>

                      {/* Row Content */}
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
                            {sb && (
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                                background: sb.bg, color: sb.color, textTransform: 'uppercase',
                              }}>
                                {article.newsSource}
                              </span>
                            )}
                            <span style={{ color: '#666' }}>{timeAgo(article.created_at)}</span>
                            {article.symbols.length > 0 && (
                              <>
                                <span style={{ color: '#333' }}>&bull;</span>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  {article.symbols.slice(0, 4).map(s => (
                                    <span key={s} onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/stock/${s}`; }} style={{
                                      background: 'rgba(240, 198, 116, 0.1)', color: '#f0c674',
                                      padding: '1px 6px', borderRadius: 3, fontSize: 9,
                                      fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                                      cursor: 'pointer',
                                    }}>{s}</span>
                                  ))}
                                  {article.symbols.length > 4 && (
                                    <span style={{ color: '#555', fontSize: 9 }}>+{article.symbols.length - 4}</span>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                        {/* Sentiment badge */}
                        {si && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: '3px 8px',
                            borderRadius: 4, background: si.bg, color: si.color,
                            textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0,
                            letterSpacing: '0.03em',
                          }}>
                            {si.label}
                          </span>
                        )}
                      </div>
                    </a>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Sidebar: Market Pulse — only on wide viewports */}
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
                {trendingTickers.map((t, i) => (
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

      {/* CSS for animations and responsive sidebar */}
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.7; }
        }
        @media (min-width: 1400px) {
          .news-sidebar { display: block !important; }
        }
      `}</style>
    </AppShell>
  );
}
