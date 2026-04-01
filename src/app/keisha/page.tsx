'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ChatMessage } from '@/types';
import { Send, Mic, MicOff, Zap, AlertTriangle, CheckCircle } from 'lucide-react';
import MarkdownRenderer from '@/components/MarkdownRenderer';

type Domain = 'general' | 'cfo' | 'tax' | 'quant' | 'wealth' | 'strategy';

const DOMAIN_CONFIG: Record<Domain, { label: string; color: string; prompts: string[] }> = {
  general: {
    label: 'General',
    color: '#8a5cf6',
    prompts: [
      'What signals fired today?',
      'What covered call should I write this week?',
      "What's my Greeks exposure?",
      'Should I diversify my RSUs now?',
    ],
  },
  cfo: {
    label: 'CFO',
    color: '#4ade80',
    prompts: [
      'Show me insider buying in my watchlist',
      "When's my next cash crunch?",
      'Opportunity cost of idle cash?',
      'Monthly runway forecast',
    ],
  },
  tax: {
    label: 'Tax',
    color: '#f87171',
    prompts: [
      'Estimated Q2 tax bill?',
      'Optimal RSU sell schedule',
      'Harvest without triggering wash sale',
      'QBI deduction breakdown',
    ],
  },
  quant: {
    label: 'Quant',
    color: '#22d3ee',
    prompts: [
      'Run the confluence scanner',
      'Current market regime?',
      'Size with half-Kelly for NVDA',
      'Portfolio CVaR at 95%?',
    ],
  },
  wealth: {
    label: 'Wealth',
    color: '#f0c674',
    prompts: [
      'CR3 portfolio valuation?',
      'Territory health check',
      'Real vs nominal progress',
      'Net worth breakdown',
    ],
  },
  strategy: {
    label: 'Strategy',
    color: '#c084fc',
    prompts: [
      'Best opportunity from today\'s flow',
      'Am I on track for $50M?',
      'Full risk report',
      'Best deployment of next $100K?',
    ],
  },
};

const INITIAL_MESSAGE: ChatMessage = {
  id: '0',
  role: 'assistant',
  content:
    "Hey Wes! I'm Keisha, your personal wealth strategist. I've got your full portfolio context loaded — CR3 territories, RSU vesting schedule, investment positions, everything. What are we working on today?",
  timestamp: new Date().toISOString(),
};

// ── Trade Action Modal ────────────────────────────────────────────────────
function TradeModal({ action, symbol, crewVerdict, guardCheck, onConfirm, onModify, onCancel }: {
  action: string;
  symbol: string;
  crewVerdict: string;
  guardCheck: string;
  onConfirm: () => void;
  onModify: () => void;
  onCancel: () => void;
}) {
  const [shares, setShares] = useState(10);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#12121e', border: '1px solid #2a2a4a', borderRadius: 16,
        padding: 28, width: 420, maxWidth: '90vw',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Zap size={20} color="#f0c674" />
          <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>
            {action.toUpperCase()} {symbol}
          </span>
        </div>

        {/* Crew & Guard Status */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            background: crewVerdict.includes('go') ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
            border: `1px solid ${crewVerdict.includes('go') ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
          }}>
            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', marginBottom: 4 }}>Crew Verdict</div>
            <div style={{ fontSize: 13, color: crewVerdict.includes('go') ? '#4ade80' : '#f87171', fontWeight: 600 }}>
              {crewVerdict || 'N/A'}
            </div>
          </div>
          <div style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            background: guardCheck === 'pass' ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
            border: `1px solid ${guardCheck === 'pass' ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
          }}>
            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', marginBottom: 4 }}>Guard Check</div>
            <div style={{ fontSize: 13, color: guardCheck === 'pass' ? '#4ade80' : '#f87171', fontWeight: 600 }}>
              {guardCheck || 'N/A'}
            </div>
          </div>
        </div>

        {/* Shares Input */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 6 }}>Shares</label>
          <input
            type="number"
            value={shares}
            onChange={e => setShares(parseInt(e.target.value) || 0)}
            style={{
              width: '100%', padding: '10px 14px', background: '#1a1a2e',
              border: '1px solid #2a2a4a', borderRadius: 8, color: '#fff',
              fontSize: 14, outline: 'none',
            }}
          />
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onConfirm} style={{
            flex: 1, padding: '12px 0', borderRadius: 10, border: 'none',
            background: '#4ade80', color: '#080b14', fontWeight: 700, fontSize: 14,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <CheckCircle size={16} /> Place Order
          </button>
          <button onClick={onModify} style={{
            flex: 1, padding: '12px 0', borderRadius: 10,
            border: '1px solid #8a5cf6', background: 'transparent',
            color: '#8a5cf6', fontWeight: 600, fontSize: 14, cursor: 'pointer',
          }}>
            Modify
          </button>
          <button onClick={onCancel} style={{
            padding: '12px 16px', borderRadius: 10,
            border: '1px solid #333', background: 'transparent',
            color: '#888', fontSize: 14, cursor: 'pointer',
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KeishaPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [domain, setDomain] = useState<Domain>('general');
  const [listening, setListening] = useState(false);
  const [tradeModal, setTradeModal] = useState<{
    action: string; symbol: string; crewVerdict: string; guardCheck: string;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Voice input setup
  useEffect(() => {
    const W = window as unknown as Record<string, unknown>;
    const SpeechRecognitionCtor = (W.SpeechRecognition || W.webkitSpeechRecognition) as (new () => Record<string, unknown>) | undefined;
    if (SpeechRecognitionCtor) {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      recognition.onresult = (e: unknown) => {
        const evt = e as { results: { 0: { 0: { transcript: string } } } };
        const transcript = evt.results[0][0].transcript;
        setInput((prev: string) => prev + transcript);
        setListening(false);
      };
      recognition.onerror = () => setListening(false);
      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition;
    }
  }, []);

  const toggleVoice = () => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) {
      (rec as { stop: () => void }).stop();
      setListening(false);
    } else {
      (rec as { start: () => void }).start();
      setListening(true);
    }
  };

  // Fetch signal context for stock mentions
  const fetchSignalContext = async (text: string): Promise<string> => {
    const symbolMatch = text.match(/\b([A-Z]{1,5})\b/g);
    if (!symbolMatch) return '';

    const symbols = Array.from(new Set(symbolMatch)).filter(s =>
      s.length >= 2 && !['AM', 'PM', 'FOR', 'THE', 'AND', 'NOT', 'BUT', 'ALL', 'ANY', 'RUN', 'CFO', 'CEO', 'AI', 'IV', 'PE', 'RSU', 'QBI'].includes(s)
    ).slice(0, 3);

    if (symbols.length === 0) return '';

    const contexts: string[] = [];
    for (const symbol of symbols) {
      try {
        const [sentimentRes, insiderRes] = await Promise.all([
          fetch(`/api/sentiment?symbol=${symbol}`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`/api/insider?symbol=${symbol}&days=30`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);

        const parts: string[] = [`[SIGNAL CONTEXT for ${symbol}]`];
        if (sentimentRes?.compositeScore) {
          parts.push(`Sentiment: ${sentimentRes.compositeScore}/10 (${sentimentRes.trendDirection})`);
        }
        if (insiderRes?.insiderTrades?.length) {
          const buys = insiderRes.insiderTrades.filter((t: { transactionType: string }) => t.transactionType === 'buy').length;
          parts.push(`Insider activity: ${insiderRes.insiderTrades.length} trades (${buys} buys) in 30d`);
        }
        if (insiderRes?.congressTrades?.length) {
          parts.push(`Congressional trades: ${insiderRes.congressTrades.length}`);
        }
        if (insiderRes?.signals?.length) {
          parts.push(`Signals: ${insiderRes.signals.map((s: { type: string }) => s.type).join(', ')}`);
        }
        if (parts.length > 1) contexts.push(parts.join(' | '));
      } catch {
        // Skip context for this symbol
      }
    }

    return contexts.length > 0 ? '\n\n' + contexts.join('\n') : '';
  };

  // Parse trade action cards from Keisha's response
  const parseTradeAction = (content: string) => {
    const match = content.match(/\*\*TRADE DETECTED: (\w+) ([A-Z]{1,5})\*\*/);
    if (!match) return null;

    const crewMatch = content.match(/Crew Verdict: (.+)/);
    const guardMatch = content.match(/Guard Check: (.+)/);

    return {
      action: match[1],
      symbol: match[2],
      crewVerdict: crewMatch?.[1]?.trim() || 'N/A',
      guardCheck: guardMatch?.[1]?.trim() || 'N/A',
    };
  };

  // Render message content with trade action buttons
  const renderMessageContent = (content: string, msgId: string) => {
    // Check for trade action markers
    const hasTradeAction = content.includes('[Confirm & Execute]');

    if (!hasTradeAction) {
      return <MarkdownRenderer content={content} />;
    }

    // Split at the trade card
    const parts = content.split('---\n**TRADE DETECTED:');
    const mainContent = parts[0];
    const tradeInfo = parseTradeAction(content);

    return (
      <>
        <MarkdownRenderer content={mainContent} />
        {tradeInfo && (
          <div style={{
            marginTop: 12, padding: '14px 16px', borderRadius: 10,
            background: 'rgba(240, 198, 116, 0.06)',
            border: '1px solid rgba(240, 198, 116, 0.2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Zap size={16} color="#f0c674" />
              <span style={{ fontSize: 14, fontWeight: 700, color: '#f0c674' }}>
                TRADE: {tradeInfo.action} {tradeInfo.symbol}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 10 }}>
              Crew: {tradeInfo.crewVerdict} | Guard: {tradeInfo.guardCheck}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setTradeModal(tradeInfo)}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: '#4ade80', color: '#080b14', fontWeight: 600,
                  fontSize: 12, cursor: 'pointer',
                }}
              >
                Confirm & Execute
              </button>
              <button
                onClick={() => window.location.href = `/trading?symbol=${tradeInfo.symbol}&side=${tradeInfo.action.toLowerCase()}`}
                style={{
                  padding: '8px 16px', borderRadius: 8,
                  border: '1px solid #8a5cf6', background: 'transparent',
                  color: '#8a5cf6', fontWeight: 600, fontSize: 12, cursor: 'pointer',
                }}
              >
                Modify
              </button>
              <button
                onClick={() => {
                  // Remove trade card from message
                  setMessages(prev => prev.map(m =>
                    m.id === msgId
                      ? { ...m, content: mainContent.trim() }
                      : m
                  ));
                }}
                style={{
                  padding: '8px 16px', borderRadius: 8,
                  border: '1px solid #333', background: 'transparent',
                  color: '#888', fontSize: 12, cursor: 'pointer',
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </>
    );
  };

  const handleTradeConfirm = async () => {
    if (!tradeModal) return;
    try {
      const res = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          symbol: tradeModal.symbol,
          shares: 10,
          side: tradeModal.action.toLowerCase().includes('buy') ? 'buy' : 'sell',
        }),
      });
      const data = await res.json();
      setTradeModal(null);

      const statusMsg = res.ok
        ? `Order placed: ${tradeModal.action} ${tradeModal.symbol}. Order ID: ${data.executed?.[0]?.orderId || 'pending'}`
        : `Order failed: ${data.error || 'Unknown error'}`;

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: statusMsg,
        timestamp: new Date().toISOString(),
      }]);
    } catch {
      setTradeModal(null);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'Order submission failed — check your connection.',
        timestamp: new Date().toISOString(),
      }]);
    }
  };

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || loading) return;

    // Fetch signal context in background
    const signalContext = await fetchSignalContext(content);

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: `[${domain.toUpperCase()} MODE] ${content}${signalContext}`,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, { ...userMsg, content }]);
    setInput('');
    setLoading(true);

    try {
      const history = [...messages, userMsg].filter(m => m.id !== '0');
      const res = await fetch('/api/keisha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(m => ({ role: m.role, content: m.content })),
          domain,
        }),
      });
      const data = await res.json();
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.content || data.error || 'Something went wrong.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Connection error — check your ANTHROPIC_API_KEY.',
          timestamp: new Date().toISOString(),
        },
      ]);
    }
    setLoading(false);
  }, [loading, messages, domain]);

  const config = DOMAIN_CONFIG[domain];

  return (
    <AppShell>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Keisha AI</h1>
        <p style={{ color: '#6b6b80', fontSize: 13, marginTop: 4 }}>
          Your personal AI wealth strategist &mdash; powered by Claude | Memory + Behavioral Intelligence + NLP Trading
        </p>
      </div>

      {/* Domain Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {(Object.keys(DOMAIN_CONFIG) as Domain[]).map(d => {
          const c = DOMAIN_CONFIG[d];
          const active = domain === d;
          return (
            <button
              key={d}
              onClick={() => setDomain(d)}
              style={{
                padding: '7px 16px', borderRadius: 8, border: `1px solid ${active ? c.color : '#1e1e35'}`,
                background: active ? `${c.color}18` : 'rgba(255,255,255,0.03)',
                color: active ? c.color : '#8888a8', fontSize: 12, fontWeight: active ? 600 : 400,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Chat Container */}
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 300px)' }}>
        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 16 }}>
          {messages.map(msg => (
            <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {msg.role === 'assistant' && (
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', backgroundColor: config.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 800, color: '#08080d', flexShrink: 0, marginRight: 10, marginTop: 4,
                }}>K</div>
              )}
              <div style={{
                maxWidth: '70%', padding: '12px 16px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                backgroundColor: msg.role === 'user' ? config.color : '#1a1a24',
                color: msg.role === 'user' ? '#08080d' : '#e8e8e8',
                fontSize: 14, lineHeight: 1.6,
                border: msg.role === 'user' ? 'none' : '1px solid #2a2a3a',
                ...(msg.role === 'user' ? { whiteSpace: 'pre-wrap' as const } : {}),
              }}>
                {msg.role === 'assistant' ? renderMessageContent(msg.content, msg.id) : msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', backgroundColor: config.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 800, color: '#08080d',
              }}>K</div>
              <div style={{ display: 'flex', gap: 4, padding: '12px 16px', backgroundColor: '#1a1a24', borderRadius: 12, border: '1px solid #2a2a3a' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: config.color, animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Quick Prompts */}
        {messages.length <= 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {config.prompts.map(p => (
              <button
                key={p}
                onClick={() => sendMessage(p)}
                style={{
                  padding: '6px 12px', backgroundColor: 'transparent',
                  border: `1px solid ${config.color}40`, borderRadius: 20,
                  color: config.color, fontSize: 12, cursor: 'pointer',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        {/* Input Row */}
        <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
          <button
            onClick={toggleVoice}
            style={{
              width: 48, height: 48, borderRadius: 12, border: `1px solid ${listening ? '#f87171' : '#1e1e35'}`,
              background: listening ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.03)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            {listening ? <MicOff size={18} color="#f87171" /> : <Mic size={18} color="#555570" />}
          </button>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder={`Ask Keisha (${config.label} mode)...`}
            style={{
              flex: 1, padding: '12px 16px', backgroundColor: '#1a1a24',
              border: `1px solid ${config.color}30`, borderRadius: 12,
              color: '#e8e8e8', fontSize: 14, outline: 'none',
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            style={{
              width: 48, height: 48, borderRadius: 12, backgroundColor: config.color,
              border: 'none', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: loading || !input.trim() ? 0.5 : 1, flexShrink: 0,
            }}
          >
            <Send size={18} color="#08080d" />
          </button>
        </div>
      </div>

      {/* Trade Execution Modal */}
      {tradeModal && (
        <TradeModal
          action={tradeModal.action}
          symbol={tradeModal.symbol}
          crewVerdict={tradeModal.crewVerdict}
          guardCheck={tradeModal.guardCheck}
          onConfirm={handleTradeConfirm}
          onModify={() => {
            window.location.href = `/trading?symbol=${tradeModal.symbol}&side=${tradeModal.action.toLowerCase()}`;
          }}
          onCancel={() => setTradeModal(null)}
        />
      )}
    </AppShell>
  );
}
