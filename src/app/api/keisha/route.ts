import { NextRequest, NextResponse } from 'next/server';
import { anthropic, KEISHA_SYSTEM_PROMPT } from '@/lib/claude';
import { PORTFOLIO_SUMMARY, MOCK_STRATEGIES } from '@/lib/data';

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    const portfolioContext = `Current net worth: $${PORTFOLIO_SUMMARY.totalNetWorth.toLocaleString()}. Active strategies: ${MOCK_STRATEGIES.filter(s => s.status === 'active').map(s => s.name).join(', ')}.`;

    const systemWithContext = KEISHA_SYSTEM_PROMPT + `\n\nCURRENT DATA (${new Date().toLocaleDateString()}):\n${portfolioContext}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemWithContext,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const content = response.content[0].type === 'text' ? response.content[0].text : '';
    return NextResponse.json({ content });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
