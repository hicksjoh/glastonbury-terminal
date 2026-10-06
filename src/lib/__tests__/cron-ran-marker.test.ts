import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const createServiceClient = vi.fn(() => ({ rpc }));
vi.mock('@/lib/supabase', () => ({ createServiceClient: () => createServiceClient() }));

import { recordCronRan, todayKeyET } from '../cron-idempotency';

/**
 * recordCronRan() is the "ran at" marker the cron dead-man check reads for
 * jobs that can legitimately write nothing (storm-watch, tax-harvest,
 * prediction-snapshot, narrative refresh).
 */
describe('recordCronRan', () => {
  beforeEach(() => {
    rpc.mockReset();
    createServiceClient.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('claims today\'s slot then stamps it complete, with the result payload', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await recordCronRan('cron-storm-watch', { storms_seen: 0 });
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['try_claim_cron_run', 'mark_cron_run_complete']);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_job_name: 'cron-storm-watch', p_run_key: todayKeyET() });
    expect(rpc.mock.calls[1][1]).toEqual({
      p_job_name: 'cron-storm-watch',
      p_run_key: todayKeyET(),
      p_result: { storms_seen: 0 },
    });
  });

  it('still stamps completion when the slot was already claimed earlier today', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: null, error: null });
    await recordCronRan('cron-tax-harvest');
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['try_claim_cron_run', 'mark_cron_run_complete']);
  });

  it('never throws: an RPC error or a missing client must not fail a successful cron', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'relation "cron_runs" does not exist' } });
    await expect(recordCronRan('cron-prediction-snapshot')).resolves.toBeUndefined();

    createServiceClient.mockImplementationOnce(() => {
      throw new Error('supabaseUrl is required');
    });
    await expect(recordCronRan('cron-prediction-snapshot')).resolves.toBeUndefined();
  });
});
