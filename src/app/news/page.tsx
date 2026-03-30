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
}

export default function NewsPage() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchNews = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ limit: '30' });
      if (filter !== 'all' && filter !== 'portfolio') {
        params.set('symbols', filter);
      }
      const res = await fetch(`/api/news?${params}`);
      if (res.ok) {
        const data = await res.json();
        setArticles(data.articles || []);
      }
    } catch (err) {
      console.error('News fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 120000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  const filteredArticles = articles.filter(a => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.headline.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q) ||
      a.symbols.some(s => s.toLowerCase().includes(q))
    );
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

  return (
    <AppShell>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Market News</h1>
            <p style={{ color: '#888', fontSize: 14, margin: '4px 0 0' }}>Live feed via Benzinga &bull; Alpaca</p>
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
        </div>

        {/* News Articles */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>
            Loading market news...
          </div>
        ) : filteredArticles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>
            No news articles found
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {filteredArticles.map((article, i) => (
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
                    <h3 style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#e0e0e0',
                      margin: '0 0 6px',
                      lineHeight: 1.4,
                    }}>
                      {article.headline}
                    </h3>
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
                      <span style={{ color: '#555' }}>&bull;</span>
                      <span style={{ color: '#666' }}>{timeAgo(article.created_at)}</span>
                      {article.symbols.length > 0 && (
                        <>
                          <span style={{ color: '#555' }}>&bull;</span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {article.symbols.slice(0, 4).map(s => (
                              <span key={s} onClick={(e) => { e.stopPropagation(); window.location.href = `/stock/${s}`; }} style={{
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
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
