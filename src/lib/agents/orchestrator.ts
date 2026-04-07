// Keisha Orchestrator — classifies intent → dispatches agents in parallel → aggregates results
// This replaces the monolithic Keisha with a multi-agent architecture

import { AgentRegistry, type AgentTask, type AgentResult } from './agent-framework';

// Import all agents to trigger registration
import './market-agent';
import './risk-agent';
import './territory-agent';
import './compliance-agent';
import './sentiment-agent';
import './alpha-agent';

export type IntentType =
  | 'trade_evaluation'   // "Should I buy AAPL?"
  | 'portfolio_risk'     // "What's my risk exposure?"
  | 'territory_briefing' // "Territory update"
  | 'market_overview'    // "What's happening in the market?"
  | 'sentiment_check'    // "What's the sentiment on TSLA?"
  | 'compliance_check'   // "Am I within limits?"
  | 'daily_briefing'     // "Morning briefing"
  | 'general';           // Anything else

// Map intents to which agents to dispatch
const INTENT_AGENTS: Record<IntentType, string[]> = {
  trade_evaluation: ['MarketAgent', 'RiskAgent', 'ComplianceAgent', 'SentimentAgent', 'AlphaAgent'],
  portfolio_risk: ['RiskAgent', 'ComplianceAgent'],
  territory_briefing: ['TerritoryAgent'],
  market_overview: ['MarketAgent', 'SentimentAgent'],
  sentiment_check: ['SentimentAgent', 'MarketAgent'],
  compliance_check: ['ComplianceAgent'],
  daily_briefing: ['MarketAgent', 'RiskAgent', 'ComplianceAgent', 'SentimentAgent', 'TerritoryAgent'],
  general: ['MarketAgent'],
};

// Classify user intent from their message
export function classifyIntent(message: string): { intent: IntentType; symbol?: string } {
  const lower = message.toLowerCase();

  // Extract symbol (uppercase 1-5 letter word after certain keywords)
  const symbolMatch = message.match(/\b(buy|sell|trade|evaluate|check|sentiment|look at|about)\s+([A-Z]{1,5})\b/i);
  const symbol = symbolMatch?.[2]?.toUpperCase();

  // Also check for standalone tickers
  const tickerMatch = message.match(/\$([A-Z]{1,5})\b/) || message.match(/\b([A-Z]{2,5})\b(?=.*\?)/);
  const extractedSymbol = symbol || tickerMatch?.[1];

  if (lower.includes('territory') || lower.includes('cr3') || lower.includes('roofing') || lower.includes('zip')) {
    return { intent: 'territory_briefing' };
  }

  if (lower.includes('risk') || lower.includes('exposure') || lower.includes('stress') || lower.includes('var') || lower.includes('factor')) {
    return { intent: 'portfolio_risk', symbol: extractedSymbol };
  }

  if (lower.includes('compliance') || lower.includes('limit') || lower.includes('guard') || lower.includes('rule')) {
    return { intent: 'compliance_check' };
  }

  if (lower.includes('sentiment') || lower.includes('news') || lower.includes('what people') || lower.includes('social')) {
    return { intent: 'sentiment_check', symbol: extractedSymbol };
  }

  if (lower.includes('should i buy') || lower.includes('should i sell') || lower.includes('trade') || lower.includes('evaluate')) {
    return { intent: 'trade_evaluation', symbol: extractedSymbol };
  }

  if (lower.includes('briefing') || lower.includes('morning') || lower.includes('daily') || lower.includes('summary')) {
    return { intent: 'daily_briefing' };
  }

  if (lower.includes('market') || lower.includes('happening') || lower.includes('overview') || lower.includes('how') || lower.includes('today')) {
    return { intent: 'market_overview', symbol: extractedSymbol };
  }

  return { intent: 'general', symbol: extractedSymbol };
}

// Dispatch agents in parallel, collect results
export async function dispatch(
  intent: IntentType,
  symbol?: string,
  params?: Record<string, unknown>,
): Promise<{
  results: Record<string, AgentResult>;
  intent: IntentType;
  agentsUsed: string[];
  totalLatencyMs: number;
}> {
  const agentNames = INTENT_AGENTS[intent] || INTENT_AGENTS.general;
  const start = Date.now();

  // Separate AlphaAgent (needs other results) from parallel agents
  const parallelAgents = agentNames.filter(n => n !== 'AlphaAgent');
  const needsAlpha = agentNames.includes('AlphaAgent');

  // Phase 1: Run parallel agents
  const task: AgentTask = { intent, symbol, params };
  const parallelPromises = parallelAgents.map(name => {
    const agent = AgentRegistry.get(name);
    if (!agent) return Promise.resolve({ name, result: null });
    return agent.execute(task).then(result => ({ name, result }));
  });

  const parallelResults = await Promise.allSettled(parallelPromises);
  const results: Record<string, AgentResult> = {};

  for (const r of parallelResults) {
    if (r.status === 'fulfilled' && r.value.result) {
      results[r.value.name] = r.value.result;
    }
  }

  // Phase 2: Run AlphaAgent with other agents' results (sequential)
  if (needsAlpha) {
    const alphaAgent = AgentRegistry.get('AlphaAgent');
    if (alphaAgent) {
      const alphaTask: AgentTask = {
        intent,
        symbol,
        params: { ...params, agentResults: results },
      };
      results.AlphaAgent = await alphaAgent.execute(alphaTask);
    }
  }

  return {
    results,
    intent,
    agentsUsed: Object.keys(results),
    totalLatencyMs: Date.now() - start,
  };
}

// Get all agent statuses
export function getAgentStatuses() {
  return AgentRegistry.getAllStats();
}
