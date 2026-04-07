'use client';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ChatMessage } from '@/types';
import type { ExplanationLevel } from '@/types/keisha';
import { Send, Mic, MicOff, Zap, CheckCircle, Plus, Trash2, PanelLeftClose, PanelLeft, Volume2, VolumeX, Copy, Check, Search, Square, RefreshCw, Download, ImagePlus } from 'lucide-react';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import { parseSlashCommand, getMatchingCommands, SLASH_COMMANDS } from '@/lib/slash-commands';
import SparklineChart from '@/components/SparklineChart';
import { ExplainButton } from '@/components/keisha/ExplainButton';
import { GlossaryTerm } from '@/components/keisha/GlossaryTerm';
import { TradeCard, PortfolioSnapshotCard, OptionsCard, GuardCard, GEXCard, InsiderCard } from '@/components/keisha';
import { GLOSSARY, getGlossaryKeys } from '@/lib/glossary';
import type { RenderCard, TradeCardData, PortfolioCardData, OptionsCardData, GuardCardData, GEXCardData, InsiderCardData } from '@/types/keisha';

type Domain = 'general' | 'cfo' | 'tax' | 'quant' | 'wealth' | 'strategy';

interface ConversationSummary {
  id: string;
  persona: string;
  title: string;
  preview: string;
  messageCount: number;
  created_at: string;
  updated_at: string;
}

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
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ConversationSummary[]>([]);
  const [pendingOrder, setPendingOrder] = useState<{ type: string; params: Record<string, string> } | null>(null);
  const [confirmingOrder, setConfirmingOrder] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<Record<string, unknown> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendMessageRef = useRef<(content: string) => void>(() => {});
  const [pendingRegenContent, setPendingRegenContent] = useState<string | null>(null);
  const [slashMatches, setSlashMatches] = useState<Array<{name: string; description: string; usage: string}>>([]);
  const [pendingImage, setPendingImage] = useState<{base64: string; mediaType: string; preview: string} | null>(null);
  const [actionButtons, setActionButtons] = useState<Array<{label: string; action: string; params: Record<string, unknown>}>>([]);
  const [sparklineData, setSparklineData] = useState<Record<string, number[]>>({});
  const [messageCards, setMessageCards] = useState<Record<string, RenderCard[]>>({});
  const imageInputRef = useRef<HTMLInputElement>(null);

  // ── Explanation level (Plain Talk mode) ─────────────────────────────────
  const [explanationLevel, setExplanationLevel] = useState<ExplanationLevel>('balanced');

  // Load explanation level from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('keisha-explanation-level');
      if (saved === 'technical' || saved === 'balanced' || saved === 'plain_talk') {
        setExplanationLevel(saved);
      }
    } catch { /* ignore */ }
  }, []);

  const handleExplanationChange = useCallback((level: ExplanationLevel) => {
    setExplanationLevel(level);
    try {
      localStorage.setItem('keisha-explanation-level', level);
    } catch { /* ignore */ }
  }, []);

  // ── Glossary term processing ───────────────────────────────────────────
  const glossaryKeys = useMemo(() => getGlossaryKeys(), []);
  const glossaryPattern = useMemo(() => {
    if (glossaryKeys.length === 0) return null;
    // Sort by length descending to match longer terms first
    const sorted = [...glossaryKeys].sort((a, b) => b.length - a.length);
    // Escape special regex chars and build pattern
    const escaped = sorted.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  }, [glossaryKeys]);

  useEffect(() => { document.title = 'Keisha AI | Glastonbury Terminal'; }, []);

  // ── Conversation persistence state ──────────────────────────────────────
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loadingConvos, setLoadingConvos] = useState(false);
  const savingRef = useRef(false);

  // ── Load conversations for current persona ──────────────────────────────
  const loadConversations = useCallback(async (persona: string) => {
    setLoadingConvos(true);
    try {
      const res = await fetch(`/api/keisha/conversations?persona=${persona}`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch {
      // Silently fail — sidebar just stays empty
    }
    setLoadingConvos(false);
  }, []);

  // Load conversations when domain changes
  useEffect(() => {
    loadConversations(domain);
    // Start fresh when switching personas
    setActiveConvoId(null);
    setMessages([INITIAL_MESSAGE]);
  }, [domain, loadConversations]);

  // ── Create a new conversation in Supabase ───────────────────────────────
  const createConversation = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/keisha/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: domain }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.conversation?.id || null;
      }
    } catch {
      // Fall through
    }
    return null;
  }, [domain]);

  // ── Save messages to active conversation ────────────────────────────────
  const saveMessages = useCallback(async (convoId: string, msgs: ChatMessage[]) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      // Strip the initial greeting from saved messages
      const toSave = msgs.filter(m => m.id !== '0').map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      }));

      // Generate title from first user message
      const firstUserMsg = toSave.find(m => m.role === 'user');
      const title = firstUserMsg?.content?.slice(0, 60) || 'New Conversation';

      await fetch(`/api/keisha/conversations/${convoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages_json: toSave,
          title,
        }),
      });

      // Refresh sidebar
      loadConversations(domain);
    } catch {
      // Non-critical
    }
    savingRef.current = false;
  }, [domain, loadConversations]);

  // ── Load a specific conversation ────────────────────────────────────────
  const loadConversation = useCallback(async (convoId: string) => {
    try {
      const res = await fetch(`/api/keisha/conversations/${convoId}`);
      if (res.ok) {
        const data = await res.json();
        const savedMsgs: ChatMessage[] = data.conversation?.messages_json || [];
        setMessages([INITIAL_MESSAGE, ...savedMsgs]);
        setActiveConvoId(convoId);
      }
    } catch {
      // Silently fail
    }
  }, []);

  // ── Delete a conversation ───────────────────────────────────────────────
  const deleteConversation = useCallback(async (convoId: string) => {
    try {
      await fetch(`/api/keisha/conversations/${convoId}`, { method: 'DELETE' });
      if (activeConvoId === convoId) {
        setActiveConvoId(null);
        setMessages([INITIAL_MESSAGE]);
      }
      loadConversations(domain);
    } catch {
      // Silently fail
    }
  }, [activeConvoId, domain, loadConversations]);

  // ── Clear all conversations for persona ─────────────────────────────────
  const clearAllConversations = useCallback(async () => {
    if (!confirm(`Delete all ${DOMAIN_CONFIG[domain].label} conversations?`)) return;
    try {
      await fetch(`/api/keisha/conversations?persona=${domain}`, { method: 'DELETE' });
      setConversations([]);
      setActiveConvoId(null);
      setMessages([INITIAL_MESSAGE]);
    } catch {
      // Silently fail
    }
  }, [domain]);

  // ── Start a new conversation ────────────────────────────────────────────
  const startNewConversation = useCallback(() => {
    setActiveConvoId(null);
    setMessages([INITIAL_MESSAGE]);
  }, []);

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

  // ── Voice output (TTS) ──────────────────────────────────────────────────
  const speakMessage = (text: string, msgId: string) => {
    if (speaking === msgId) {
      speechSynthesis.cancel();
      setSpeaking(null);
      return;
    }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 1.0;
    const voices = speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name.includes('Samantha') || v.name.includes('Karen') || v.name.includes('Zira'));
    if (preferred) utterance.voice = preferred;
    utterance.onend = () => setSpeaking(null);
    setSpeaking(msgId);
    speechSynthesis.speak(utterance);
  };

  // ── Copy message to clipboard ──────────────────────────────────────────
  const copyMessage = async (content: string, msgId: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(msgId);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // ── Regenerate last assistant message ─────────────────────────────────
  const regenerateMessage = useCallback((assistantMsgId: string) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === assistantMsgId);
      if (idx < 0) return prev;
      // Find the user message immediately before this assistant message
      let userContent = '';
      for (let i = idx - 1; i >= 0; i--) {
        if (prev[i].role === 'user') {
          userContent = prev[i].content;
          break;
        }
      }
      if (!userContent) return prev;
      // Remove the assistant message and queue regeneration
      setPendingRegenContent(userContent);
      return prev.filter(m => m.id !== assistantMsgId);
    });
  }, []);

  // ── Export conversation as markdown ────────────────────────────────────
  const exportConversation = useCallback(() => {
    const date = new Date().toISOString().slice(0, 10);
    const lines = [`# Keisha AI Conversation — ${DOMAIN_CONFIG[domain].label} Mode`, `**Date:** ${date}`, '---'];
    for (const msg of messages) {
      if (msg.id === '0') continue;
      const speaker = msg.role === 'user' ? 'Wes' : 'Keisha';
      lines.push(`**${speaker}:** ${msg.content}`, '');
    }
    lines.push('---');
    const markdown = lines.join('\n');
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keisha-${domain}-${date}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [messages, domain]);

  // ── Search conversations ───────────────────────────────────────────────
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/keisha/conversations/search?q=${encodeURIComponent(searchQuery)}&persona=${domain}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.conversations || []);
        }
      } catch {
        // Silently fail
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, domain]);

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
    const showGlossary = explanationLevel !== 'technical';

    // Check for trade action markers
    const hasTradeAction = content.includes('[Confirm & Execute]');

    if (!hasTradeAction) {
      return <MarkdownRenderer content={content} enableGlossary={showGlossary} />;
    }

    // Split at the trade card
    const parts = content.split('---\n**TRADE DETECTED:');
    const mainContent = parts[0];
    const tradeInfo = parseTradeAction(content);

    return (
      <>
        <MarkdownRenderer content={mainContent} enableGlossary={showGlossary} />
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

  const handleOrderConfirm = async () => {
    if (!pendingOrder) return;
    setConfirmingOrder(true);
    try {
      const res = await fetch('/api/keisha/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: pendingOrder.type, params: pendingOrder.params }),
      });
      const data = await res.json();
      const statusIcon = res.ok ? '\u2705' : '\u274c';
      const statusMsg = data.message || data.error || 'Order processed';
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `${statusIcon} **Order Executed:** ${statusMsg}`,
        timestamp: new Date().toISOString(),
      }]);
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: '\u274c Order submission failed — check your connection.',
        timestamp: new Date().toISOString(),
      }]);
    }
    setPendingOrder(null);
    setConfirmingOrder(false);
  };

  const handleOrderCancel = () => {
    setPendingOrder(null);
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'assistant',
      content: 'Order cancelled. No trade was placed.',
      timestamp: new Date().toISOString(),
    }]);
  };

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || loading) return;

    // Clear previous suggestions
    setSuggestions([]);

    // Fetch signal context in background
    const signalContext = await fetchSignalContext(content);

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: `[${domain.toUpperCase()} MODE] ${content}${signalContext}`,
      timestamp: new Date().toISOString(),
    };
    const displayUserMsg: ChatMessage = { ...userMsg, content };
    setMessages(prev => [...prev, displayUserMsg]);
    setInput('');
    setLoading(true);

    // Clear action buttons on new message
    setActionButtons([]);

    // ── Slash command handling ────────────────────────────────────────
    const parsed = parseSlashCommand(content);
    if (parsed) {
      const { command, args } = parsed;

      // /help — show available commands inline
      if (command.name === 'Help') {
        const helpText = Object.entries(SLASH_COMMANDS)
          .map(([key, cmd]) => `**${key}** — ${cmd.description}`)
          .join('\n');
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(), role: 'assistant',
          content: `### Slash Commands\n\n${helpText}`, timestamp: new Date().toISOString(),
        }]);
        setLoading(false); return;
      }

      // /export — client-side
      if (command.name === 'Export Chat') {
        exportConversation();
        setLoading(false); return;
      }

      // /brief — hit the briefing API
      if (command.name === 'Morning Briefing') {
        try {
          const res = await fetch('/api/keisha/briefing');
          const data = await res.json();
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(), role: 'assistant',
            content: data.briefing || data.error || 'Briefing unavailable',
            timestamp: new Date().toISOString(),
          }]);
        } catch {
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(), role: 'assistant',
            content: 'Failed to generate briefing.', timestamp: new Date().toISOString(),
          }]);
        }
        setLoading(false); return;
      }

      // Tools-based slash commands
      if (command.tool) {
        const params = command.parseArgs(args);
        try {
          const res = await fetch('/api/keisha/slash', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: command.tool, input: params }),
          });
          const data = await res.json();
          const resultText = data.success !== false
            ? '```json\n' + JSON.stringify(data.result || data, null, 2) + '\n```'
            : `Error: ${data.result?.error || data.error || 'Unknown error'}`;
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(), role: 'assistant',
            content: `**${command.name}**\n\n${resultText}`,
            timestamp: new Date().toISOString(),
          }]);
        } catch {
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(), role: 'assistant',
            content: `Failed to execute ${command.name}`, timestamp: new Date().toISOString(),
          }]);
        }
        setLoading(false); return;
      }
    }

    // Ensure we have a conversation ID
    let convoId = activeConvoId;
    if (!convoId) {
      convoId = await createConversation();
      if (convoId) setActiveConvoId(convoId);
    }

    const history = [...messages, userMsg].filter(m => m.id !== '0');

    // Read settings from localStorage
    let parsedSettings: { riskTolerance?: string; commStyle?: string; paperMode?: boolean } = {};
    try {
      const raw = localStorage.getItem('glastonbury-settings');
      if (raw) parsedSettings = JSON.parse(raw);
    } catch { /* ignore parse errors */ }

    const requestBodyObj: Record<string, unknown> = {
      messages: history.map(m => ({ role: m.role, content: m.content })),
      domain,
      conversationId: convoId,
      settings: {
        riskTolerance: parsedSettings.riskTolerance,
        commStyle: parsedSettings.commStyle,
        paperMode: parsedSettings.paperMode,
        explanationLevel,
      },
    };

    // Add image to request body if attached
    if (pendingImage) {
      requestBodyObj.image = { base64: pendingImage.base64, mediaType: pendingImage.mediaType };
      setPendingImage(null);
    }

    const requestBody = JSON.stringify(requestBodyObj);

    // ── Try streaming endpoint first ──────────────────────────────────
    let streamed = false;
    try {
      abortRef.current = new AbortController();
      const res = await fetch('/api/keisha/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        signal: abortRef.current.signal,
      });

      if (res.ok && res.body) {
        streamed = true;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        const assistantId = (Date.now() + 1).toString();

        setMessages(prev => [...prev, {
          id: assistantId, role: 'assistant', content: '', timestamp: new Date().toISOString(),
        }]);
        setLoading(false);

        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep incomplete last line in buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                fullText += data.text;
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullText } : m));
              }
              if (data.toolsRunning) {
                // Keisha is chaining tools — show thinking indicator
                if (!fullText.endsWith('\n\n')) fullText += '\n\n';
                fullText += '_Pulling live data..._\n\n';
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullText } : m));
              }
              if (data.suggestions) {
                setSuggestions(data.suggestions);
              }
              if (data.action) {
                // Tool was executed by Keisha — show result inline
                const a = data.action;
                const statusIcon = a.success ? '\u2705' : '\u274c';
                const statusMsg = a.result?.message || a.result?.error || `${a.type} completed`;
                // Remove the "Pulling live data..." placeholder if present
                fullText = fullText.replace(/_Pulling live data\.\.\._\n\n$/, '');
                fullText += `\n\n${statusIcon} **${a.type}:** ${statusMsg}`;
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullText } : m));

                // Store sparkline data if available
                if (a.result?.bars && Array.isArray(a.result.bars)) {
                  setSparklineData(prev => ({ ...prev, [a.params?.symbol || '']: a.result.bars }));
                }
                // For batch_lookup, extract bars from each symbol
                if (a.type === 'batch_lookup' && a.result?.results) {
                  const newBars: Record<string, number[]> = {};
                  for (const [sym, symData] of Object.entries(a.result.results as Record<string, { bars?: number[] }>)) {
                    if (symData.bars && Array.isArray(symData.bars)) newBars[sym] = symData.bars;
                  }
                  if (Object.keys(newBars).length > 0) setSparklineData(prev => ({ ...prev, ...newBars }));
                }
              }
              // Inline rich card from tool result
              if (data.renderCard) {
                setMessageCards(prev => ({
                  ...prev,
                  [assistantId]: [...(prev[assistantId] || []), data.renderCard as RenderCard],
                }));
              }
              if (data.actionButtons) {
                setActionButtons(data.actionButtons);
              }
              if (data.pendingConfirmation) {
                // Dangerous action (e.g. place_order) — requires user confirmation
                const pc = data.pendingConfirmation;
                setPendingOrder({ type: pc.type, params: pc.params });
              }
              if (data.trade) {
                const tradeInfo = data.trade;
                setTradeModal({
                  action: tradeInfo.action,
                  symbol: tradeInfo.symbol,
                  crewVerdict: tradeInfo.crewVerdict || 'N/A',
                  guardCheck: tradeInfo.guardCheck || 'N/A',
                });
              }
              if (data.done) break;
            } catch {
              // Skip malformed SSE lines
            }
          }
        }

        // Final update with complete text
        abortRef.current = null;
        setMessages(prev => {
          const updated = prev.map(m => m.id === assistantId ? { ...m, content: fullText } : m);
          if (convoId) saveMessages(convoId, updated);
          return updated;
        });
      }
    } catch (err: unknown) {
      // If user aborted, just stop — partial text stays in chat
      if (err instanceof DOMException && err.name === 'AbortError') {
        abortRef.current = null;
        setLoading(false);
        return;
      }
      abortRef.current = null;
      // Streaming failed — fall through to non-streaming
    }

    // ── Fallback to non-streaming endpoint ────────────────────────────
    if (!streamed) {
      try {
        const res = await fetch('/api/keisha', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
        });
        const data = await res.json();
        const assistantMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.content || data.error || 'Something went wrong.',
          timestamp: new Date().toISOString(),
        };

        const updatedMessages = [...messages, displayUserMsg, assistantMsg];
        setMessages(updatedMessages);

        // Handle pending confirmations from non-streaming response
        if (data.pendingConfirmations?.length > 0) {
          setPendingOrder(data.pendingConfirmations[0]);
        }

        if (convoId) {
          saveMessages(convoId, updatedMessages);
        }
      } catch {
        const errorMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Connection error — check your ANTHROPIC_API_KEY.',
          timestamp: new Date().toISOString(),
        };
        const updatedMessages = [...messages, displayUserMsg, errorMsg];
        setMessages(updatedMessages);

        if (convoId) {
          saveMessages(convoId, updatedMessages);
        }
      }
      setLoading(false);
    }
  }, [loading, messages, domain, activeConvoId, createConversation, saveMessages, exportConversation, pendingImage]);

  // Keep sendMessageRef in sync for regenerateMessage
  sendMessageRef.current = sendMessage;

  // Fire pending regeneration after the assistant message has been removed from state
  useEffect(() => {
    if (pendingRegenContent) {
      setPendingRegenContent(null);
      sendMessageRef.current(pendingRegenContent);
    }
  }, [pendingRegenContent]);

  const config = DOMAIN_CONFIG[domain];

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+Shift+N = new conversation
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'n') {
        e.preventDefault();
        startNewConversation();
      }
      // Cmd/Ctrl+B = toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [startNewConversation]);

  // ── Mobile auto-collapse sidebar ──────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => { if (e.matches) setSidebarOpen(false); };
    if (mq.matches) setSidebarOpen(false);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Format date for sidebar
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHrs = diffMs / (1000 * 60 * 60);

    if (diffHrs < 1) return 'Just now';
    if (diffHrs < 24) return `${Math.floor(diffHrs)}h ago`;
    if (diffHrs < 48) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Group conversations by date category
  const groupConversations = useCallback((convos: ConversationSummary[]) => {
    const groups: { label: string; items: ConversationSummary[] }[] = [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const weekStart = todayStart - 7 * 86400000;

    const today: ConversationSummary[] = [];
    const yesterday: ConversationSummary[] = [];
    const thisWeek: ConversationSummary[] = [];
    const older: ConversationSummary[] = [];

    for (const c of convos) {
      const t = new Date(c.updated_at).getTime();
      if (t >= todayStart) today.push(c);
      else if (t >= yesterdayStart) yesterday.push(c);
      else if (t >= weekStart) thisWeek.push(c);
      else older.push(c);
    }

    if (today.length > 0) groups.push({ label: 'Today', items: today });
    if (yesterday.length > 0) groups.push({ label: 'Yesterday', items: yesterday });
    if (thisWeek.length > 0) groups.push({ label: 'This Week', items: thisWeek });
    if (older.length > 0) groups.push({ label: 'Older', items: older });

    return groups;
  }, []);

  const convoGroups = useMemo(
    () => groupConversations(searchQuery.trim() ? searchResults : conversations),
    [groupConversations, searchQuery, searchResults, conversations],
  );

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

      {/* Explanation Level Toggle */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#6b6b80', marginRight: 8, fontWeight: 500 }}>Explain:</span>
        {(['technical', 'balanced', 'plain_talk'] as ExplanationLevel[]).map(level => {
          const active = explanationLevel === level;
          const labels: Record<ExplanationLevel, string> = {
            technical: 'Technical',
            balanced: 'Balanced',
            plain_talk: 'Plain Talk',
          };
          return (
            <button
              key={level}
              onClick={() => handleExplanationChange(level)}
              aria-label={`Set explanation level to ${labels[level]}`}
              aria-pressed={active}
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                border: active ? '1px solid #8a5cf6' : '1px solid #2a2a3a',
                background: active ? 'rgba(138, 92, 246, 0.15)' : 'transparent',
                color: active ? '#c4a6ff' : '#6b6b80',
                fontSize: 11,
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 150ms ease',
              }}
            >
              {level === 'plain_talk' ? '💡 ' : ''}{labels[level]}
            </button>
          );
        })}
      </div>

      {/* Main Layout: Sidebar + Chat */}
      <ErrorBoundary label="keisha-chat">
      <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 300px)' }}>
        {/* ── Conversation Sidebar ────────────────────────────────────────── */}
        <div style={{
          width: sidebarOpen ? 260 : 0,
          minWidth: sidebarOpen ? 260 : 0,
          overflow: 'hidden',
          transition: 'all 0.2s ease',
          borderRight: sidebarOpen ? '1px solid #1e1e35' : 'none',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Sidebar Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', borderBottom: '1px solid #1e1e35',
          }}>
            <span style={{ fontSize: 12, color: '#6b6b80', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              History
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={startNewConversation}
                title="New conversation"
                style={{
                  padding: '4px 8px', borderRadius: 6, border: `1px solid ${config.color}40`,
                  background: 'transparent', color: config.color, fontSize: 11, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <Plus size={12} /> New
              </button>
              {conversations.length > 0 && (
                <button
                  onClick={clearAllConversations}
                  title="Clear all conversations"
                  style={{
                    padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(248,113,113,0.3)',
                    background: 'transparent', color: '#f87171', cursor: 'pointer',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Search */}
          <div style={{ padding: '4px 10px' }}>
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#555' }} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                style={{
                  width: '100%', padding: '6px 10px 6px 26px', fontSize: 12, background: '#0e0e1a',
                  border: '1px solid #1e1e35', borderRadius: 6, color: '#aaa', outline: 'none',
                  margin: '6px 0', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Conversation List — grouped by date */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {loadingConvos && (
              <div style={{ padding: '12px 14px', color: '#555', fontSize: 12 }}>Loading...</div>
            )}
            {!loadingConvos && conversations.length === 0 && (
              <div style={{ padding: '20px 14px', color: '#444', fontSize: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 20, marginBottom: 8 }}>No conversations yet</div>
                <div style={{ color: '#555', lineHeight: 1.5 }}>
                  Start chatting to save history.
                  <br /><span style={{ fontSize: 10, color: '#3a3a4a' }}>Tip: Cmd+Shift+N for new chat</span>
                </div>
              </div>
            )}
            {convoGroups.map(group => (
              <div key={group.label}>
                {/* Group Label */}
                <div style={{
                  padding: '8px 14px 4px',
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#4a4a5a',
                  textTransform: 'uppercase',
                  letterSpacing: 0.8,
                }}>
                  {group.label}
                </div>
                {group.items.map(convo => (
                  <div
                    key={convo.id}
                    onClick={() => loadConversation(convo.id)}
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      background: activeConvoId === convo.id ? `${config.color}10` : 'transparent',
                      borderLeft: activeConvoId === convo.id ? `2px solid ${config.color}` : '2px solid transparent',
                      transition: 'all 0.15s',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                    onMouseEnter={e => {
                      if (activeConvoId !== convo.id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                    }}
                    onMouseLeave={e => {
                      if (activeConvoId !== convo.id) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{
                        fontSize: 13, color: activeConvoId === convo.id ? '#e8e8e8' : '#aaa',
                        fontWeight: activeConvoId === convo.id ? 600 : 400,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        flex: 1, marginRight: 8,
                      }}>
                        {convo.title || 'Untitled'}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteConversation(convo.id); }}
                        style={{
                          padding: '2px 4px', borderRadius: 4, border: 'none',
                          background: 'transparent', color: '#555', cursor: 'pointer',
                          opacity: 0.5, flexShrink: 0,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#f87171'; }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = '#555'; }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {convo.preview || 'Empty conversation'}
                      </span>
                      <span style={{ fontSize: 10, color: '#444', flexShrink: 0, marginLeft: 6 }}>
                        {formatDate(convo.updated_at)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{
                        fontSize: 9, padding: '1px 5px', borderRadius: 4,
                        background: `${DOMAIN_CONFIG[convo.persona as Domain]?.color || config.color}15`,
                        color: DOMAIN_CONFIG[convo.persona as Domain]?.color || config.color,
                        fontWeight: 600, textTransform: 'uppercase',
                      }}>
                        {DOMAIN_CONFIG[convo.persona as Domain]?.label || convo.persona}
                      </span>
                      <span style={{ fontSize: 10, color: '#444' }}>
                        {convo.messageCount} msg{convo.messageCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ── Chat Area ──────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingLeft: sidebarOpen ? 16 : 0 }}>
          {/* Sidebar toggle + Export */}
          <div style={{ marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={() => setSidebarOpen(prev => !prev)}
              style={{
                padding: '4px 8px', borderRadius: 6, border: '1px solid #1e1e35',
                background: 'transparent', color: '#6b6b80', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
              }}
            >
              {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
              {sidebarOpen ? 'Hide' : 'History'}
              <span style={{ fontSize: 9, color: '#4a4a5a', marginLeft: 2 }}>&#8984;B</span>
            </button>
            {messages.length > 1 && (
              <button
                onClick={exportConversation}
                title="Export conversation as markdown"
                style={{
                  padding: '4px 8px', borderRadius: 6, border: '1px solid #1e1e35',
                  background: 'transparent', color: '#6b6b80', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
                }}
              >
                <Download size={14} /> Export
              </button>
            )}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 16 }}>
            {messages.map((msg, msgIdx) => (
              <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {msg.role === 'assistant' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginRight: 10, marginTop: 4, flexShrink: 0 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%', backgroundColor: config.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800, color: '#08080d',
                    }}>K</div>
                  </div>
                )}
                <div
                  className="msg-bubble"
                  style={{
                    maxWidth: '70%', padding: '12px 16px', position: 'relative',
                    borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    backgroundColor: msg.role === 'user' ? config.color : '#1a1a24',
                    color: msg.role === 'user' ? '#08080d' : '#e8e8e8',
                    fontSize: 14, lineHeight: 1.6,
                    border: msg.role === 'user' ? 'none' : '1px solid #2a2a3a',
                    ...(msg.role === 'user' ? { whiteSpace: 'pre-wrap' as const } : {}),
                  }}
                >
                  {msg.role === 'assistant' ? renderMessageContent(msg.content, msg.id) : msg.content}
                  {/* ── Inline Rich Cards ─────────────────────────────────── */}
                  {msg.role === 'assistant' && messageCards[msg.id]?.map((card, cardIdx) => {
                    switch (card.type) {
                      case 'trade':
                        return <TradeCard key={`card-${cardIdx}`} data={card.data as TradeCardData} />;
                      case 'portfolio':
                        return <PortfolioSnapshotCard key={`card-${cardIdx}`} data={card.data as PortfolioCardData} />;
                      case 'options':
                        return <OptionsCard key={`card-${cardIdx}`} data={card.data as OptionsCardData} />;
                      case 'guard':
                        return <GuardCard key={`card-${cardIdx}`} data={card.data as GuardCardData} />;
                      case 'gex':
                        return <GEXCard key={`card-${cardIdx}`} data={card.data as GEXCardData} />;
                      case 'insider':
                        return <InsiderCard key={`card-${cardIdx}`} data={card.data as InsiderCardData} />;
                      default:
                        return null;
                    }
                  })}
                  {/* Sparklines for symbols with bar data */}
                  {msg.role === 'assistant' && Object.keys(sparklineData).length > 0 && msgIdx === messages.length - 1 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
                      {Object.entries(sparklineData).map(([sym, bars]) => (
                        <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#aaa' }}>{sym}</span>
                          <SparklineChart data={bars} width={80} height={24} />
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Explain Simpler button for assistant messages */}
                  {msg.role === 'assistant' && msg.id !== '0' && explanationLevel !== 'plain_talk' && (
                    <ExplainButton messageContent={msg.content} messageId={msg.id} />
                  )}
                  {msg.role === 'assistant' && msg.id !== '0' && (
                    <div
                      className="msg-actions"
                      style={{
                        position: 'absolute', top: 6, right: 6,
                        display: 'flex', gap: 2, opacity: 0, transition: 'opacity 0.15s',
                      }}
                    >
                      <button
                        onClick={() => speakMessage(msg.content, msg.id)}
                        title={speaking === msg.id ? 'Stop reading' : 'Read aloud'}
                        style={{
                          padding: 4, borderRadius: 4, border: 'none',
                          background: 'rgba(0,0,0,0.4)', cursor: 'pointer',
                          display: 'flex', alignItems: 'center',
                        }}
                      >
                        {speaking === msg.id
                          ? <VolumeX size={13} color="#f87171" />
                          : <Volume2 size={13} color="#888" />
                        }
                      </button>
                      <button
                        onClick={() => copyMessage(msg.content, msg.id)}
                        title="Copy message"
                        style={{
                          padding: 4, borderRadius: 4, border: 'none',
                          background: 'rgba(0,0,0,0.4)', cursor: 'pointer',
                          display: 'flex', alignItems: 'center',
                        }}
                      >
                        {copiedId === msg.id
                          ? <Check size={13} color="#4ade80" />
                          : <Copy size={13} color="#888" />
                        }
                      </button>
                      {msg.id === [...messages].reverse().find(m => m.role === 'assistant' && m.id !== '0')?.id && (
                        <button
                          onClick={() => regenerateMessage(msg.id)}
                          title="Regenerate response"
                          style={{
                            padding: 4, borderRadius: 4, border: 'none',
                            background: 'rgba(0,0,0,0.4)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center',
                          }}
                        >
                          <RefreshCw size={13} color="#888" />
                        </button>
                      )}
                    </div>
                  )}
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

          {/* Suggested Follow-ups */}
          {suggestions.length > 0 && !loading && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => { setSuggestions([]); sendMessage(s); }}
                  style={{
                    padding: '6px 14px', backgroundColor: `${config.color}0F`,
                    border: `1px solid ${config.color}33`, borderRadius: 20,
                    color: config.color, fontSize: 12, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${config.color}1F`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = `${config.color}0F`; }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

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

          {/* Action Buttons */}
          {actionButtons.length > 0 && !loading && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 12px', marginTop: 4, marginBottom: 8 }}>
              {actionButtons.map((btn, i) => (
                <button key={i} onClick={() => {
                  if (btn.action.startsWith('/')) {
                    setInput(btn.action);
                  } else {
                    sendMessage(`${btn.label}`);
                  }
                  setActionButtons([]);
                }}
                style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.03)', color: '#aaa', fontSize: 12,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(240,198,116,0.1)'; e.currentTarget.style.color = '#f0c674'; e.currentTarget.style.borderColor = 'rgba(240,198,116,0.3)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = '#aaa'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                >{btn.label}</button>
              ))}
            </div>
          )}

          {/* Image preview */}
          {pendingImage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 4 }}>
              <img src={pendingImage.preview} alt="upload" style={{ height: 40, borderRadius: 6, opacity: 0.8 }} />
              <span style={{ fontSize: 12, color: '#888' }}>Image attached</span>
              <button onClick={() => setPendingImage(null)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', marginLeft: 'auto' }}>&#10005;</button>
            </div>
          )}

          {/* Hidden file input for image upload */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file || file.size > 5 * 1024 * 1024) return;
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                const base64 = dataUrl.split(',')[1];
                const mediaType = file.type;
                setPendingImage({ base64, mediaType, preview: dataUrl });
              };
              reader.readAsDataURL(file);
              e.target.value = '';
            }}
          />

          {/* Input Row */}
          <div style={{ display: 'flex', gap: 8, paddingTop: 8, position: 'relative' }}>
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
            <button onClick={() => imageInputRef.current?.click()} title="Attach image"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: pendingImage ? '#f0c674' : '#666', padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <ImagePlus size={18} />
            </button>

            {/* Slash command autocomplete */}
            {slashMatches.length > 0 && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 0, right: 0,
                background: 'rgba(20, 20, 30, 0.98)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, padding: 4, marginBottom: 4, zIndex: 100,
              }}>
                {slashMatches.map((m) => (
                  <div key={m.usage} onClick={() => { setInput(m.usage.split(' ')[0] + ' '); setSlashMatches([]); }}
                    style={{ padding: '8px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    <span style={{ color: '#f0c674', fontWeight: 600 }}>{m.usage.split(' ')[0]}</span>
                    <span style={{ color: '#888', marginLeft: 8 }}>{m.description}</span>
                  </div>
                ))}
              </div>
            )}

            <input
              value={input}
              onChange={e => {
                const newValue = e.target.value;
                setInput(newValue);
                if (newValue.startsWith('/') && !newValue.includes(' ')) {
                  const matches = getMatchingCommands(newValue);
                  setSlashMatches(matches.map(m => ({ name: m.name, description: m.description, usage: m.usage })));
                } else {
                  setSlashMatches([]);
                }
              }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setSlashMatches([]); sendMessage(input); } }}
              placeholder={`Ask Keisha (${config.label} mode)...`}
              style={{
                flex: 1, padding: '12px 16px', backgroundColor: '#1a1a24',
                border: `1px solid ${config.color}30`, borderRadius: 12,
                color: '#e8e8e8', fontSize: 14, outline: 'none',
              }}
            />
            {loading ? (
              <button
                onClick={() => { abortRef.current?.abort(); setLoading(false); }}
                title="Stop generating"
                style={{
                  width: 48, height: 48, borderRadius: 12, backgroundColor: '#f87171',
                  border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Square size={18} color="#fff" />
              </button>
            ) : (
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim()}
                style={{
                  width: 48, height: 48, borderRadius: 12, backgroundColor: config.color,
                  border: 'none', cursor: !input.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: !input.trim() ? 0.5 : 1, flexShrink: 0,
                }}
              >
                <Send size={18} color="#08080d" />
              </button>
            )}
          </div>
        </div>
      </div>
      </ErrorBoundary>

      {/* Hover styles for message action buttons */}
      <style>{`
        .msg-bubble:hover .msg-actions { opacity: 1 !important; }
      `}</style>

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

      {/* Order Confirmation Banner */}
      {pendingOrder && (
        <div style={{
          position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(20, 20, 30, 0.98)', border: '1px solid rgba(240, 198, 116, 0.4)',
          borderRadius: 14, padding: '16px 24px', zIndex: 1000, maxWidth: 440, width: '90%',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Zap size={16} color="#f0c674" />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#f0c674' }}>
              Confirm Trade
            </span>
          </div>
          <div style={{ fontSize: 13, color: '#ccc', marginBottom: 12 }}>
            <strong>{pendingOrder.params.side?.toUpperCase()}</strong> {pendingOrder.params.qty} shares of <strong>{pendingOrder.params.symbol}</strong> ({pendingOrder.params.orderType || 'market'})
            {pendingOrder.params.limitPrice && <> at <strong>${pendingOrder.params.limitPrice}</strong></>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleOrderConfirm}
              disabled={confirmingOrder}
              style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: '#4ade80', color: '#080b14', fontWeight: 600,
                fontSize: 13, cursor: confirmingOrder ? 'wait' : 'pointer',
                opacity: confirmingOrder ? 0.6 : 1,
              }}
            >
              {confirmingOrder ? 'Executing...' : 'Confirm & Execute'}
            </button>
            <button
              onClick={() => {
                setPendingOrder(null);
                window.location.href = `/trading?symbol=${pendingOrder.params.symbol}&side=${pendingOrder.params.side || 'buy'}`;
              }}
              style={{
                padding: '8px 16px', borderRadius: 8,
                border: '1px solid #8a5cf6', background: 'transparent',
                color: '#8a5cf6', fontWeight: 600, fontSize: 13, cursor: 'pointer',
              }}
            >
              Modify in Trading
            </button>
            <button
              onClick={handleOrderCancel}
              style={{
                padding: '8px 16px', borderRadius: 8,
                border: '1px solid #333', background: 'transparent',
                color: '#888', fontSize: 13, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
