// Minimal in-memory stand-in for the supabase-js query builder, for unit
// tests of src/lib/oauth/*. Not a test file itself (vitest only collects
// *.test.ts).
//
// What it models faithfully, because the code under test depends on it:
//   - every statement is ATOMIC (filter + mutate happen in one synchronous
//     step), but is only executed after an await — so two concurrent callers
//     interleave statement-by-statement exactly like two connections would;
//   - `update(..., { count: 'exact' })` reports the affected-row count;
//   - a unique constraint on oauth_refresh_tokens.token_hash;
//   - per-table / per-operation injected errors (e.g. "table does not exist").

import { randomUUID } from 'crypto';

export interface FakePgError {
  message: string;
  code?: string;
}

export type Row = Record<string, unknown>;
type Op = 'select' | 'insert' | 'update' | 'delete';

export interface FakeSupabase {
  client: { from: (table: string) => FakeQuery };
  tables: Record<string, Row[]>;
  /** Every statement executed, in order — for asserting what was (not) run. */
  log: { table: string; op: Op }[];
  /** Return an error to fail that statement; undefined to let it run. */
  failWith: (fn: (table: string, op: Op) => FakePgError | undefined) => void;
}

export const MISSING_TABLE_ERROR: FakePgError = {
  code: 'PGRST205',
  message: "Could not find the table 'public.oauth_refresh_tokens' in the schema cache",
};

interface Result {
  data: unknown;
  error: FakePgError | null;
  count: number | null;
}

export class FakeQuery implements PromiseLike<Result> {
  private op: Op | null = null;
  private filters: ((r: Row) => boolean)[] = [];
  private payload: Row | Row[] | null = null;
  private wantCount = false;
  private head = false;
  private orderBy: { col: string; asc: boolean } | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private limitN: number | null = null;
  private single = false;

  constructor(
    private readonly store: FakeSupabase,
    private readonly table: string,
    private readonly failer: () => ((table: string, op: Op) => FakePgError | undefined) | null,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (!this.op) this.op = 'select';
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(row: Row | Row[]) {
    this.op = 'insert';
    this.payload = row;
    return this;
  }
  update(vals: Row, opts?: { count?: string }) {
    this.op = 'update';
    this.payload = vals;
    if (opts?.count) this.wantCount = true;
    return this;
  }
  delete(opts?: { count?: string }) {
    this.op = 'delete';
    if (opts?.count) this.wantCount = true;
    return this;
  }

  eq(col: string, v: unknown) {
    // Supports PostgREST's `json_col->>key` text accessor, one level deep.
    const m = /^(\w+)->>(\w+)$/.exec(col);
    this.filters.push(r => {
      if (!m) return r[col] === v;
      const obj = r[m[1]];
      return obj !== null && typeof obj === 'object' && (obj as Record<string, unknown>)[m[2]] === v;
    });
    return this;
  }
  is(col: string, v: null) { this.filters.push(r => (r[col] ?? null) === v); return this; }
  gt(col: string, v: string) { this.filters.push(r => r[col] != null && String(r[col]) > v); return this; }
  gte(col: string, v: string) { this.filters.push(r => r[col] != null && String(r[col]) >= v); return this; }
  lt(col: string, v: string) { this.filters.push(r => r[col] != null && String(r[col]) < v); return this; }
  like(col: string, pattern: string) {
    const prefix = pattern.replace(/%$/, '');
    this.filters.push(r => typeof r[col] === 'string' && (r[col] as string).startsWith(prefix));
    return this;
  }
  in(col: string, vals: unknown[]) { this.filters.push(r => vals.includes(r[col])); return this; }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this; }
  limit(n: number) { this.limitN = n; return this; }
  maybeSingle() { this.single = true; return this; }

  private run(): Result {
    const op = this.op ?? 'select';
    this.store.log.push({ table: this.table, op });
    const injected = this.failer()?.(this.table, op);
    if (injected) return { data: null, error: injected, count: null };

    const rows = (this.store.tables[this.table] ??= []);
    const matches = (r: Row) => this.filters.every(f => f(r));

    if (op === 'insert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      for (const raw of incoming) {
        if (raw.token_hash !== undefined && rows.some(r => r.token_hash === raw.token_hash)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' }, count: null };
        }
        rows.push({
          id: randomUUID(),
          created_at: new Date().toISOString(),
          used_at: null,
          revoked_at: null,
          ...raw,
        });
      }
      return { data: null, error: null, count: null };
    }

    if (op === 'update') {
      let n = 0;
      for (const r of rows) {
        if (matches(r)) {
          Object.assign(r, this.payload as Row);
          n++;
        }
      }
      return { data: null, error: null, count: this.wantCount ? n : null };
    }

    if (op === 'delete') {
      const keep = rows.filter(r => !matches(r));
      const n = rows.length - keep.length;
      this.store.tables[this.table] = keep;
      return { data: null, error: null, count: this.wantCount ? n : null };
    }

    let out = rows.filter(matches).map(r => ({ ...r }));
    const total = out.length;
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out.sort((a, b) => {
        const av = String(a[col] ?? '');
        const bv = String(b[col] ?? '');
        return (av < bv ? -1 : av > bv ? 1 : 0) * (asc ? 1 : -1);
      });
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      out = out.slice(this.rangeFrom, this.rangeTo + 1);
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    if (this.head) return { data: null, error: null, count: total };
    if (this.single) return { data: out[0] ?? null, error: null, count: null };
    return { data: out, error: null, count: this.wantCount ? total : null };
  }

  then<A = Result, B = never>(
    onOk?: ((v: Result) => A | PromiseLike<A>) | null,
    onErr?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    // Yield first: the statement runs on a later microtask, so concurrent
    // callers genuinely interleave between statements.
    return Promise.resolve()
      .then(() => this.run())
      .then(onOk, onErr);
  }
}

export function makeFakeSupabase(seed: Record<string, Row[]> = {}): FakeSupabase {
  let failer: ((table: string, op: Op) => FakePgError | undefined) | null = null;
  const store: FakeSupabase = {
    tables: Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map(r => ({ ...r }))])),
    log: [],
    failWith: fn => { failer = fn; },
    client: { from: (table: string) => new FakeQuery(store, table, () => failer) },
  };
  return store;
}
