import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Regression cover for the 2026-09-19 connector failure.
//
// Production trace (client gt_claude_app_*):
//   06:43:05  POST /api/oauth/finalize  303  code minted, redirect to Claude
//   06:43:07  POST /api/oauth/finalize  400  SAME tx, 1.4s later
// The second POST consumed nothing (correctly — the tx is single-use) but
// answered with a dead-end error that replaced the in-flight navigation to
// claude.ai. oauth_codes.used_at for the first code stayed NULL forever: a
// valid grant, stranded, read by the user as "authentication expired".
//
// These tests pin the recovery path: a transaction remembers the code it
// minted, and a duplicate submit inside the grace window can find it.
// ---------------------------------------------------------------------------

interface TxRow {
  tx_id: string;
  client_id: string;
  redirect_uri: string;
  state: string | null;
  subject: string;
  issued_code: string | null;
  used_at: string | null;
}

let txRows: TxRow[] = [];
/** Set to simulate Supabase returning an error on the update. */
let failUpdate = false;

vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== 'oauth_consent_transactions') throw new Error(`unexpected table ${table}`);
      return {
        update: (patch: Partial<TxRow>) => ({
          eq: (_col: string, val: string) => {
            if (failUpdate) return Promise.resolve({ error: { message: 'boom' } });
            const row = txRows.find((r) => r.tx_id === val);
            if (row) Object.assign(row, patch);
            return Promise.resolve({ error: null });
          },
        }),
        // .select().eq().not().gt().maybeSingle() — mirrors findReplayableConsent.
        select: (_cols: string) => {
          let working = [...txRows];
          const chain = {
            eq: (col: string, val: string) => {
              working = working.filter((r) => (r as unknown as Record<string, unknown>)[col] === val);
              return chain;
            },
            not: (col: string, _op: string, _v: unknown) => {
              working = working.filter((r) => (r as unknown as Record<string, unknown>)[col] != null);
              return chain;
            },
            gt: (col: string, val: string) => {
              working = working.filter((r) => {
                const cell = (r as unknown as Record<string, unknown>)[col];
                return typeof cell === 'string' && Date.parse(cell) > Date.parse(val);
              });
              return chain;
            },
            maybeSingle: () => Promise.resolve({ data: working[0] ?? null, error: null }),
          };
          return chain;
        },
      };
    },
  }),
}));

import {
  recordIssuedCode,
  findReplayableConsent,
  findReplayableConsentWithRetry,
} from '../oauth/consent-tx';

function seedConsumedTx(over: Partial<TxRow> = {}): TxRow {
  const row: TxRow = {
    tx_id: 'tx-abc',
    client_id: 'gt_claude_app_test',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    state: 'state-xyz',
    subject: 'wes',
    issued_code: null,
    used_at: new Date().toISOString(),
    ...over,
  };
  txRows.push(row);
  return row;
}

describe('consent transaction replay — duplicate Approve submit', () => {
  beforeEach(() => {
    txRows = [];
    failUpdate = false;
  });

  it('recordIssuedCode stores the minted code on the transaction', async () => {
    seedConsumedTx();
    await recordIssuedCode('tx-abc', 'code-123');
    expect(txRows[0].issued_code).toBe('code-123');
  });

  it('a duplicate submit finds the code the first submit minted', async () => {
    seedConsumedTx();
    await recordIssuedCode('tx-abc', 'code-123');

    const replay = await findReplayableConsent('tx-abc');
    expect(replay).not.toBeNull();
    expect(replay!.issued_code).toBe('code-123');
    // State must survive — Claude validates it on the callback and drops the
    // response if it doesn't match what it sent to /authorize.
    expect(replay!.state).toBe('state-xyz');
    expect(replay!.redirect_uri).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(replay!.subject).toBe('wes');
  });

  it('is not replayable before a code has been recorded', async () => {
    seedConsumedTx({ issued_code: null });
    expect(await findReplayableConsent('tx-abc')).toBeNull();
  });

  it('is not replayable outside the 5-minute grace window', async () => {
    seedConsumedTx({
      issued_code: 'code-123',
      used_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    });
    expect(await findReplayableConsent('tx-abc')).toBeNull();
  });

  it('is not replayable for an unknown tx id', async () => {
    seedConsumedTx({ issued_code: 'code-123' });
    expect(await findReplayableConsent('tx-someone-elses')).toBeNull();
  });

  it('recordIssuedCode swallows a write failure rather than failing the grant', async () => {
    seedConsumedTx();
    failUpdate = true;
    // Must not throw: the caller has already minted a good code and is about
    // to redirect. Losing the replay path is acceptable; losing the grant is not.
    await expect(recordIssuedCode('tx-abc', 'code-123')).resolves.toBeUndefined();
  });

  it('retries so a near-simultaneous double-click still resolves', async () => {
    const row = seedConsumedTx({ issued_code: null });
    // The winning request writes its code shortly after the loser starts
    // looking — exactly the double-click race.
    setTimeout(() => {
      row.issued_code = 'code-123';
    }, 300);

    const replay = await findReplayableConsentWithRetry('tx-abc', 4, 250);
    expect(replay).not.toBeNull();
    expect(replay!.issued_code).toBe('code-123');
  });

  it('gives up after its bounded retries instead of hanging', async () => {
    seedConsumedTx({ issued_code: null });
    const started = Date.now();
    const replay = await findReplayableConsentWithRetry('tx-abc', 3, 50);
    expect(replay).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
