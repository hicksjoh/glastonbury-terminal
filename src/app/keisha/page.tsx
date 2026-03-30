'use client';
import { useState, useRef, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ChatMessage } from '@/types';
import { Send } from 'lucide-react';
import MarkdownRenderer from '@/components/MarkdownRenderer';

const SUGGESTED = [
  'What covered call should I write this week?',
  'Am I on track for $50M?',
  'Is IV high enough to sell premium on NVDA?',
  "What's my Greeks exposure?",
  'Build me an income strategy',
  'Should I roll my expiring positions?',
  'Should I diversify my RSUs now?',
  'Tax-loss harvest opportunities?',
];

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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(content: string) {
    if (!content.trim() || loading) return;
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Exclude the initial greeting from API history
      const history = [...messages, userMsg].filter(m => m.id !== '0');
      const res = await fetch('/api/keisha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(m => ({ role: m.role, content: m.content })),
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
  }

  return (
    <AppShell>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Keisha AI</h1>
        <p style={{ color: '#6b6b80', fontSize: 13, marginTop: 4 }}>
          Your personal AI wealth strategist &mdash; powered by Claude
        </p>
      </div>

      {/* Chat Container */}
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 240px)' }}>
        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 16 }}>
          {messages.map(msg => (
            <div
              key={msg.id}
              style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
            >
              {msg.role === 'assistant' && (
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  backgroundColor: '#c9a84c',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 800,
                  color: '#08080d',
                  flexShrink: 0,
                  marginRight: 10,
                  marginTop: 4,
                }}>K</div>
              )}
              <div style={{
                maxWidth: '70%',
                padding: '12px 16px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                backgroundColor: msg.role === 'user' ? '#c9a84c' : '#1a1a24',
                color: msg.role === 'user' ? '#08080d' : '#e8e8e8',
                fontSize: 14,
                lineHeight: 1.6,
                border: msg.role === 'user' ? 'none' : '1px solid #2a2a3a',
                ...(msg.role === 'user' ? { whiteSpace: 'pre-wrap' as const } : {}),
              }}>
                {msg.role === 'assistant' ? (
                  <MarkdownRenderer content={msg.content} />
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                backgroundColor: '#c9a84c',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 800,
                color: '#08080d',
              }}>K</div>
              <div style={{
                display: 'flex',
                gap: 4,
                padding: '12px 16px',
                backgroundColor: '#1a1a24',
                borderRadius: 12,
                border: '1px solid #2a2a3a',
              }}>
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: '#c9a84c',
                      animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Suggested Prompts — only show on first message */}
        {messages.length <= 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {SUGGESTED.map(p => (
              <button
                key={p}
                onClick={() => sendMessage(p)}
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'transparent',
                  border: '1px solid #2a2a3a',
                  borderRadius: 20,
                  color: '#b0b0c0',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        {/* Input Row */}
        <div style={{ display: 'flex', gap: 12, paddingTop: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="Ask Keisha anything about your portfolio..."
            style={{
              flex: 1,
              padding: '12px 16px',
              backgroundColor: '#1a1a24',
              border: '1px solid #2a2a3a',
              borderRadius: 12,
              color: '#e8e8e8',
              fontSize: 14,
              outline: 'none',
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              backgroundColor: '#c9a84c',
              border: 'none',
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: loading || !input.trim() ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            <Send size={18} color="#08080d" />
          </button>
        </div>
      </div>
    </AppShell>
  );
}
