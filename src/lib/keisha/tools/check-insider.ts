import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import type { InsiderCardData } from '@/types/keisha';

const inputSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol'),
  days: z.number().optional().describe('Number of days to look back (default 30)'),
});

export const checkInsider: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'check_insider',
  description: 'Look up insider trading and congressional stock trades for a symbol. Shows recent buys/sells by company insiders and members of Congress. Detects cluster buy signals. Use when Wes asks about insider activity, congressional trades, or smart money moves.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'check_insider',
    description: 'Look up insider trading and congressional stock trades for a symbol. Shows recent buys/sells by company insiders and members of Congress. Detects cluster buy signals. Use when Wes asks about insider activity, congressional trades, or smart money moves.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol' },
        days: { type: 'number', description: 'Number of days to look back (default 30)' },
      },
      required: ['symbol'],
    },
  }),
  async execute(input) {
    const symbol = sanitizeSymbol(String(input.symbol || ''));
    if (!symbol) return { result: { error: 'Missing symbol' }, success: false };
    const days = Math.min(Number(input.days) || 30, 90);
    const fmpKey = process.env.FMP_API_KEY;
    if (!fmpKey) return { result: { error: 'FMP_API_KEY not configured' }, success: false };

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Fetch insider + congress data in parallel
    const [insiderRes, senateRes, disclosureRes] = await Promise.all([
      fetch(`https://financialmodelingprep.com/api/v4/insider-trading?symbol=${symbol}&limit=50&apikey=${fmpKey}`).catch(() => null),
      fetch(`https://financialmodelingprep.com/api/v4/senate-trading?symbol=${symbol}&apikey=${fmpKey}`).catch(() => null),
      fetch(`https://financialmodelingprep.com/api/v4/senate-disclosure?symbol=${symbol}&apikey=${fmpKey}`).catch(() => null),
    ]);

    const insiderRaw = insiderRes?.ok ? await insiderRes.json() : [];
    const insiderTrades = (Array.isArray(insiderRaw) ? insiderRaw : [])
      .filter((t: Record<string, unknown>) => new Date(String(t.transactionDate || t.filingDate || '')) >= cutoff)
      .slice(0, 20)
      .map((t: Record<string, unknown>) => ({
        name: String(t.reportingName || t.owner || 'Unknown'),
        title: String(t.typeOfOwner || ''),
        transactionType: String(t.acquistionOrDisposition || '').toLowerCase().includes('a') ? 'buy' : 'sell',
        shares: Number(t.securitiesTransacted || 0),
        totalValue: Number(t.securitiesTransacted || 0) * Number(t.price || 0),
        date: String(t.transactionDate || t.filingDate || ''),
      }));

    const congressTrades: Array<Record<string, unknown>> = [];
    for (const res of [senateRes, disclosureRes]) {
      const raw = res?.ok ? await res.json() : [];
      if (!Array.isArray(raw)) continue;
      for (const t of raw) {
        if (new Date(t.transactionDate || t.disclosureDate || '') < cutoff) continue;
        congressTrades.push({
          representative: t.representative || `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'Unknown',
          party: t.party || '',
          transactionType: String(t.type || t.transactionType || '').toLowerCase().includes('purchase') ? 'buy' : 'sell',
          amount: t.amount || t.range || '',
          date: t.transactionDate || t.disclosureDate || '',
        });
      }
    }

    // Signal detection: cluster buys
    const signals: Array<{ type: string; description: string; confidence: number }> = [];
    const buys = insiderTrades.filter((t: { transactionType: string }) => t.transactionType === 'buy');
    if (buys.length >= 3) {
      const dates = buys.map((b: { date: string }) => new Date(b.date).getTime());
      const range = Math.max(...dates) - Math.min(...dates);
      if (range <= 14 * 86400000) {
        signals.push({
          type: 'cluster_buy',
          description: `${buys.length} insiders bought ${symbol} within 14 days`,
          confidence: Math.min(0.95, 0.6 + buys.length * 0.1),
        });
      }
    }

    const congressBuys = congressTrades.filter(t => t.transactionType === 'buy');
    for (const t of congressBuys.slice(0, 3)) {
      signals.push({
        type: 'congress_buy',
        description: `${t.representative} (${t.party}) purchased ${symbol}`,
        confidence: 0.7,
      });
    }

    return {
      result: {
        symbol,
        insiderTrades: insiderTrades.slice(0, 10),
        congressTrades: congressTrades.slice(0, 10),
        signals,
        summary: {
          insiderBuys: buys.length,
          insiderSells: insiderTrades.filter((t: { transactionType: string }) => t.transactionType === 'sell').length,
          congressBuys: congressBuys.length,
          congressSells: congressTrades.filter(t => t.transactionType === 'sell').length,
        },
      },
      success: true,
    };
  },
  buildRenderCard(_input, result, success) {
    if (!success || !result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    if (!r.symbol) return null;
    return {
      type: 'insider',
      data: {
        symbol: String(r.symbol),
        insiderTrades: ((r.insiderTrades as Array<Record<string, unknown>>) || []).slice(0, 5).map(t => ({
          name: String(t.name || ''),
          title: String(t.title || ''),
          transactionType: String(t.transactionType || 'buy') as 'buy' | 'sell',
          shares: Number(t.shares || 0),
          totalValue: Number(t.totalValue || 0),
          date: String(t.date || ''),
        })),
        congressTrades: ((r.congressTrades as Array<Record<string, unknown>>) || []).slice(0, 5).map(t => ({
          representative: String(t.representative || ''),
          party: String(t.party || ''),
          transactionType: String(t.transactionType || ''),
          amount: String(t.amount || ''),
          date: String(t.date || ''),
        })),
        signals: ((r.signals as Array<Record<string, unknown>>) || []).map(s => ({
          type: String(s.type || ''),
          description: String(s.description || ''),
          confidence: Number(s.confidence || 0),
        })),
        summary: {
          insiderBuys: Number((r.summary as Record<string, unknown>)?.insiderBuys || 0),
          insiderSells: Number((r.summary as Record<string, unknown>)?.insiderSells || 0),
          congressBuys: Number((r.summary as Record<string, unknown>)?.congressBuys || 0),
          congressSells: Number((r.summary as Record<string, unknown>)?.congressSells || 0),
        },
      } as InsiderCardData,
    };
  },
};
