'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ChatMessage } from '@/types';
import { Send, Mic, MicOff } from 'lucide-react';
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

export default function KeishaPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [domain, setDomain] = useState<Domain>('general');
  const [listening, setListening] = useState(false);
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

    const symbols = [...new Set(symbolMatch)].filter(s =>
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
          Your personal AI wealth strategist &mdash; powered by Claude
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
                {msg.role === 'assistant' ? <MarkdownRenderer content={msg.content} /> : msg.content}
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
    </AppShell>
  );
}
