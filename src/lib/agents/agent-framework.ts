// Multi-agent framework — base class, registry, task/result interfaces
// Each agent is a specialist that fetches specific data and returns structured results

export interface AgentTask {
  intent: string;
  symbol?: string;
  params?: Record<string, unknown>;
  timeout?: number;
}

export interface AgentResult {
  agent: string;
  status: 'success' | 'error' | 'timeout' | 'skipped';
  data: unknown;
  confidence: number;     // 0-1
  latencyMs: number;
  error?: string;
  sources: string[];
}

export type AgentStatus = 'idle' | 'running' | 'error' | 'disabled';

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly capabilities: string[];

  private _status: AgentStatus = 'idle';
  private _lastRun: number = 0;
  private _totalRuns: number = 0;
  private _totalErrors: number = 0;
  private _avgLatencyMs: number = 0;

  get status() { return this._status; }
  get stats() {
    return {
      name: this.name,
      status: this._status,
      lastRun: this._lastRun ? new Date(this._lastRun).toISOString() : null,
      totalRuns: this._totalRuns,
      totalErrors: this._totalErrors,
      avgLatencyMs: Math.round(this._avgLatencyMs),
      errorRate: this._totalRuns > 0 ? Math.round((this._totalErrors / this._totalRuns) * 100) : 0,
    };
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    this._status = 'running';
    this._totalRuns++;
    this._lastRun = start;

    const timeout = task.timeout ?? 15000;

    try {
      const result = await Promise.race([
        this.run(task),
        new Promise<AgentResult>((_, reject) =>
          setTimeout(() => reject(new Error(`${this.name} timed out after ${timeout}ms`)), timeout)
        ),
      ]);

      const latencyMs = Date.now() - start;
      this._avgLatencyMs = (this._avgLatencyMs * (this._totalRuns - 1) + latencyMs) / this._totalRuns;
      this._status = 'idle';

      return { ...result, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      this._totalErrors++;
      this._status = 'error';

      return {
        agent: this.name,
        status: err instanceof Error && err.message.includes('timed out') ? 'timeout' : 'error',
        data: null,
        confidence: 0,
        latencyMs,
        error: err instanceof Error ? err.message : String(err),
        sources: [],
      };
    }
  }

  protected abstract run(task: AgentTask): Promise<AgentResult>;
}

// Agent registry — singleton that holds all agent instances
class AgentRegistryImpl {
  private agents = new Map<string, BaseAgent>();

  register(agent: BaseAgent): void {
    this.agents.set(agent.name, agent);
  }

  get(name: string): BaseAgent | undefined {
    return this.agents.get(name);
  }

  getAll(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  getAllStats() {
    return Array.from(this.agents.values()).map(a => a.stats);
  }
}

export const AgentRegistry = new AgentRegistryImpl();
