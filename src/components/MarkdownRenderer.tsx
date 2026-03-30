'use client';

import ReactMarkdown from 'react-markdown';
import React from 'react';

interface MarkdownRendererProps {
  content: string;
  compact?: boolean;
}

export default function MarkdownRenderer({ content, compact = false }: MarkdownRendererProps) {
  return (
    <div className={compact ? 'markdown-compact' : 'markdown-full'}>
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 style={{
              fontSize: compact ? 16 : 20,
              fontWeight: 700,
              color: '#f0c674',
              marginTop: compact ? 12 : 20,
              marginBottom: compact ? 6 : 10,
              paddingBottom: 6,
              borderBottom: '1px solid rgba(240, 198, 116, 0.2)',
            }}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 style={{
              fontSize: compact ? 14 : 17,
              fontWeight: 700,
              color: '#f0c674',
              marginTop: compact ? 10 : 18,
              marginBottom: compact ? 4 : 8,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 style={{
              fontSize: compact ? 13 : 15,
              fontWeight: 600,
              color: '#c4a6ff',
              marginTop: compact ? 8 : 14,
              marginBottom: compact ? 4 : 6,
            }}>
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p style={{
              color: '#d0d0e0',
              fontSize: compact ? 13 : 14,
              lineHeight: compact ? 1.5 : 1.7,
              marginTop: compact ? 4 : 8,
              marginBottom: compact ? 4 : 8,
            }}>
              {children}
            </p>
          ),
          strong: ({ children }) => (
            <strong style={{
              color: '#f0c674',
              fontWeight: 600,
            }}>
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em style={{ color: '#c4a6ff' }}>{children}</em>
          ),
          ul: ({ children }) => (
            <ul style={{
              paddingLeft: compact ? 16 : 20,
              marginTop: compact ? 4 : 8,
              marginBottom: compact ? 4 : 8,
              listStyleType: 'none',
            }}>
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol style={{
              paddingLeft: compact ? 16 : 20,
              marginTop: compact ? 4 : 8,
              marginBottom: compact ? 4 : 8,
              color: '#d0d0e0',
              fontSize: compact ? 13 : 14,
            }}>
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li style={{
              color: '#d0d0e0',
              fontSize: compact ? 13 : 14,
              lineHeight: compact ? 1.5 : 1.7,
              marginBottom: compact ? 2 : 4,
              paddingLeft: 4,
              position: 'relative' as const,
            }}>
              <span style={{
                color: '#f0c674',
                position: 'absolute' as const,
                left: -14,
                fontWeight: 'bold',
              }}>&#8226;</span>
              {children}
            </li>
          ),
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-');
            if (isBlock) {
              return (
                <code style={{
                  display: 'block',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(138, 92, 246, 0.2)',
                  borderRadius: 8,
                  padding: compact ? 8 : 12,
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: '#c4a6ff',
                  overflowX: 'auto' as const,
                  marginTop: 8,
                  marginBottom: 8,
                }}>
                  {children}
                </code>
              );
            }
            return (
              <code style={{
                background: 'rgba(138, 92, 246, 0.15)',
                color: '#c4a6ff',
                padding: '2px 6px',
                borderRadius: 4,
                fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {children}
              </code>
            );
          },
          blockquote: ({ children }) => (
            <blockquote style={{
              borderLeft: '3px solid #f0c674',
              paddingLeft: 12,
              marginLeft: 0,
              marginTop: 8,
              marginBottom: 8,
              color: '#b0b0c0',
              fontStyle: 'italic',
            }}>
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr style={{
              border: 'none',
              borderTop: '1px solid rgba(138, 92, 246, 0.3)',
              margin: compact ? '8px 0' : '16px 0',
            }} />
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#8a5cf6',
                textDecoration: 'underline',
                textDecorationColor: 'rgba(138, 92, 246, 0.4)',
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
