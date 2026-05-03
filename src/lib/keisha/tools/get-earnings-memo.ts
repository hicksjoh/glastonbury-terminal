import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { createServiceClient } from '@/lib/supabase';

const inputSchema = z.object({
  ticker: z.string().describe('Stock ticker'),
});

export const getEarningsMemo: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_earnings_memo',
  description: 'Pull the most recent post-call earnings memo for a ticker from /earnings/live — structured memo with guidance direction (up/down/flat/unclear), Keisha\'s take, and key quotes with speakers. Use when Wes asks what management said on the call or how the quarter went.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_earnings_memo',
    description: 'Pull the most recent post-call earnings memo for a ticker from /earnings/live — structured memo with guidance direction (up/down/flat/unclear), Keisha\'s take, and key quotes with speakers. Use when Wes asks what management said on the call or how the quarter went.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Stock ticker' },
      },
      required: ['ticker'],
    },
  }),
  async execute(input) {
    const ticker = String(input.ticker ?? '').toUpperCase();
    if (!ticker) return { result: { error: 'Missing ticker' }, success: false };
    const sb = createServiceClient();
    // Find the most recent completed session for this ticker, then its memo
    const { data: sessions } = await sb.from('earnings_sessions')
      .select('id, ticker, quarter, call_date, status, ended_at')
      .eq('user_id', 'wes').eq('ticker', ticker)
      .order('call_date', { ascending: false }).limit(5);
    const sessionRows = (sessions as unknown as Array<{ id: string; ticker: string; quarter: string | null; call_date: string; status: string }>) ?? [];
    if (sessionRows.length === 0) return { result: { error: `No earnings sessions yet for ${ticker}`, link: '/earnings/live' }, success: false };
    const sessionId = sessionRows[0].id;
    const { data: memo } = await sb.from('earnings_memos')
      .select('memo_text, keisha_take, guidance_delta, key_quotes, created_at')
      .eq('session_id', sessionId).order('created_at', { ascending: false }).limit(1);
    const memoRow = (memo as unknown as Array<{ memo_text: string; keisha_take: string; guidance_delta: string; key_quotes: unknown }>)?.[0];
    if (!memoRow) return { result: { error: `Session found but no memo yet. Finish the call at /earnings/live/${sessionId}`, link: `/earnings/live/${sessionId}` }, success: false };
    return {
      result: {
        ticker,
        quarter: sessionRows[0].quarter,
        call_date: sessionRows[0].call_date,
        guidance_delta: memoRow.guidance_delta,
        keisha_take: memoRow.keisha_take,
        memo_preview: memoRow.memo_text?.slice(0, 1200),
        key_quotes: memoRow.key_quotes,
        link: `/earnings/live/${sessionId}`,
      },
      success: true,
    };
  },
};
