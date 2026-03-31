/**
 * Agent Mesh Coordinator
 * Inter-agent communication and conflict resolution
 */

export type AgentName = 'keisha' | 'tax_harvester' | 'rebalancer' | 'wheel_bot' | 'morning_brief' | 'behavioral_guard';

export interface AgentAction {
  agent: AgentName;
  action: string;
  ticker?: string;
  side?: 'buy' | 'sell';
  quantity?: number;
  details: string;
  timestamp: number;
}

export interface ConflictCheck {
  action: AgentAction;
  conflicts: Conflict[];
  approved: boolean;
  blockedBy?: AgentName;
  reason?: string;
}

export interface Conflict {
  type: 'wash_sale' | 'covered_call_conflict' | 'cash_crunch' | 'regime_mismatch' | 'tax_timing';
  severity: 'block' | 'warn';
  description: string;
  agent: AgentName;
}

export interface MeshState {
  recentActions: AgentAction[];
  openPositions: Map<string, { qty: number; hasCoveredCall: boolean }>;
  recentSales: Map<string, { date: number; amount: number }>;
  cashPosition: number;
  currentRegime: string;
  taxQuarterGoal: 'harvest_losses' | 'minimize_gains' | 'neutral';
}

/**
 * Check an action against the mesh for conflicts
 */
export function validateAction(action: AgentAction, state: MeshState): ConflictCheck {
  const conflicts: Conflict[] = [];

  // Check wash sale (30-day window)
  if (action.side === 'buy' && action.ticker) {
    const recentSale = state.recentSales.get(action.ticker);
    if (recentSale) {
      const daysSinceSale = (Date.now() - recentSale.date) / (24 * 60 * 60 * 1000);
      if (daysSinceSale < 31) {
        conflicts.push({
          type: 'wash_sale',
          severity: 'block',
          description: `Buying ${action.ticker} would trigger a wash sale. Sold ${Math.round(daysSinceSale)} days ago. Wait ${Math.ceil(31 - daysSinceSale)} more days.`,
          agent: 'tax_harvester',
        });
      }
    }
  }

  // Check covered call conflict
  if (action.side === 'sell' && action.ticker) {
    const position = state.openPositions.get(action.ticker);
    if (position?.hasCoveredCall) {
      conflicts.push({
        type: 'covered_call_conflict',
        severity: 'warn',
        description: `${action.ticker} has an open covered call. Selling the underlying would leave the call naked.`,
        agent: 'wheel_bot',
      });
    }
  }

  // Check cash crunch
  if (action.side === 'buy' && action.quantity) {
    const estimatedCost = action.quantity * 100; // Rough estimate
    if (state.cashPosition - estimatedCost < 25000) {
      conflicts.push({
        type: 'cash_crunch',
        severity: 'warn',
        description: `This purchase would drop cash below $25K threshold. Current cash: $${state.cashPosition.toLocaleString()}.`,
        agent: 'keisha',
      });
    }
  }

  // Check regime mismatch
  if (action.agent === 'wheel_bot' && state.currentRegime === 'bear_high_vol') {
    conflicts.push({
      type: 'regime_mismatch',
      severity: 'warn',
      description: 'Current regime is BEAR · HIGH VOL. Premium selling is riskier in this environment.',
      agent: 'keisha',
    });
  }

  // Check tax timing
  if (action.side === 'sell' && state.taxQuarterGoal === 'minimize_gains') {
    const position = state.openPositions.get(action.ticker || '');
    if (position) {
      conflicts.push({
        type: 'tax_timing',
        severity: 'warn',
        description: `Tax strategy this quarter is to minimize gains. Consider delaying this sale to next quarter.`,
        agent: 'tax_harvester',
      });
    }
  }

  const blockingConflicts = conflicts.filter(c => c.severity === 'block');
  const approved = blockingConflicts.length === 0;

  return {
    action,
    conflicts,
    approved,
    blockedBy: blockingConflicts[0]?.agent,
    reason: blockingConflicts[0]?.description,
  };
}

/**
 * Log an agent action to the mesh
 */
export function logAction(state: MeshState, action: AgentAction): MeshState {
  const newState = { ...state };
  newState.recentActions = [...state.recentActions, action].slice(-100);

  // Track sells for wash sale detection
  if (action.side === 'sell' && action.ticker) {
    newState.recentSales = new Map(state.recentSales);
    newState.recentSales.set(action.ticker, { date: action.timestamp, amount: action.quantity || 0 });
  }

  return newState;
}
