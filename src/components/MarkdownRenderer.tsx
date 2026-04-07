'use client';

import ReactMarkdown from 'react-markdown';
import React, { ReactNode } from 'react';
import { GlossaryTerm } from '@/components/keisha/GlossaryTerm';
import { GLOSSARY } from '@/lib/glossary';

interface MarkdownRendererProps {
  content: string;
  compact?: boolean;
  enableGlossary?: boolean;
}

/**
 * Process a React children tree and wrap glossary terms in GlossaryTerm components.
 * Only processes string children — leaves other React elements untouched.
 */
function processGlossaryTerms(children: ReactNode, glossaryPattern: RegExp | null): ReactNode {
  if (!glossaryPattern) return children;

  return React.Children.map(children, (child) => {
    if (typeof child !== 'string') return child;

    // Split text on glossary term matches
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Reset regex state
    glossaryPattern.lastIndex = 0;

    while ((match = glossaryPattern.exec(child)) !== null) {
      const term = match[0];
      const termKey = term.toLowerCase();

      // Check this is actually in our glossary
      if (!GLOSSARY[termKey]) continue;

      // Add text before match
      if (match.index > lastIndex) {
        parts.push(child.slice(lastIndex, match.index));
      }

      // Add wrapped term
      parts.push(
        <GlossaryTerm key={`${termKey}-${match.index}`} term={termKey}>
          {term}
        </GlossaryTerm>
      );

      lastIndex = match.index + term.length;
    }

    // Add remaining text
    if (lastIndex < child.length) {
      parts.push(child.slice(lastIndex));
    }

    return parts.length > 0 ? <>{parts}</> : child;
  });
}

// Build glossary pattern once (module-level, not per-render)
let _glossaryPattern: RegExp | null = null;
function getGlossaryPattern(): RegExp | null {
  if (_glossaryPattern) return _glossaryPattern;
  const keys = Object.keys(GLOSSARY);
  if (keys.length === 0) return null;
  const sorted = [...keys].sort((a, b) => b.length - a.length);
  const escaped = sorted.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  _glossaryPattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  return _glossaryPattern;
}

export default function MarkdownRenderer({ content, compact = false, enableGlossary = false }: MarkdownRendererProps) {
  const glossaryPattern = enableGlossary ? getGlossaryPattern() : null;

  const wrapChildren = (children: ReactNode): ReactNode => {
    return enableGlossary ? processGlossaryTerms(children, glossaryPattern) : children;
  };

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
              {wrapChildren(children)}
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
              {wrapChildren(children)}
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
              {wrapChildren(children)}
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
              {wrapChildren(children)}
            </p>
          ),
          strong: ({ children }) => (
            <strong style={{
              color: '#f0c674',
              fontWeight: 600,
            }}>
              {wrapChildren(children)}
            </strong>
          ),
          em: ({ children }) => (
            <em style={{ color: '#c4a6ff' }}>{wrapChildren(children)}</em>
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
              {wrapChildren(children)}
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
          pre: ({ children }) => (
            <pre style={{
              margin: '8px 0',
              padding: 0,
              background: 'transparent',
              overflow: 'hidden',
              whiteSpace: 'pre-wrap' as const,
              wordBreak: 'break-word' as const,
            }}>
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div style={{ overflowX: 'auto', maxWidth: '100%', marginTop: 8, marginBottom: 8 }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: compact ? 12 : 13,
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead style={{ borderBottom: '1px solid rgba(138, 92, 246, 0.3)' }}>
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th style={{
              padding: '6px 10px',
              textAlign: 'left',
              color: '#f0c674',
              fontWeight: 600,
              fontSize: compact ? 11 : 12,
              whiteSpace: 'nowrap',
            }}>
              {wrapChildren(children)}
            </th>
          ),
          td: ({ children }) => (
            <td style={{
              padding: '5px 10px',
              color: '#d0d0e0',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}>
              {wrapChildren(children)}
            </td>
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
