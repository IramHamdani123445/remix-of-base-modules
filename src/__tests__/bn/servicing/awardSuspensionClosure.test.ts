import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  stableIdempotencyKey,
  toCommandError,
  isExecutionFailure,
  executeSuspension,
  proposeReinstatement,
  executeReinstatement,
  listSuspensionPaymentImpact,
  previewReinstatementArrears,
  SuspensionCommandError,
  type ExecutionResult,
} from '@/services/bn/awardSuspensionCommandService';

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
});

const lastArgs = () => rpc.mock.calls[rpc.mock.calls.length - 1];

describe('BN award suspension — idempotency keys', () => {
  it('derives a stable key from command, entity and row version', () => {
    const a = stableIdempotencyKey('suspension_execute', 'abc', 3);
    const b = stableIdempotencyKey('suspension_execute', 'abc', 3);
    expect(a).toBe(b);
    expect(a).toBe('suspension_execute:abc:3');
  });

  it('changes the key when the row version advances', () => {
    expect(stableIdempotencyKey('x', 'abc', 3)).not.toBe(stableIdempotencyKey('x', 'abc', 4));
  });

  it('sends a stable key for repeated execute clicks', async () => {
    await executeSuspension({ suspensionId: 's1', expectedRowVersion: 2 });
    const first = lastArgs()[1].p_idempotency_key;
    await executeSuspension({ suspensionId: 's1', expectedRowVersion: 2 });
    expect(lastArgs()[1].p_idempotency_key).toBe(first);
  });

  it('sends a stable key for reinstatement execution', async () => {
    await executeReinstatement({ reinstatementId: 'r1', expectedRowVersion: 1 });
    const first = lastArgs()[1].p_idempotency_key;
    await executeReinstatement({ reinstatementId: 'r1', expectedRowVersion: 1 });
    expect(lastArgs()[1].p_idempotency_key).toBe(first);
  });
});

describe('BN award suspension — command error mapping', () => {
  const cases: Array<[string, string]> = [
    ['E_TASK_NOT_FOR_CASE', 'E_TASK_NOT_FOR_CASE'],
    ['E_TASK_NOT_OPEN', 'E_TASK_NOT_OPEN'],
    ['E_IDEMPOTENCY_PAYLOAD_MISMATCH', 'E_IDEMPOTENCY_PAYLOAD_MISMATCH'],
    ['E_FORBIDDEN', 'E_FORBIDDEN'],
    ['E_STALE_ROW_VERSION', 'E_STALE_ROW_VERSION'],
  ];

  it.each(cases)('maps %s to a typed, human-readable error', (raw, code) => {
    const err = toCommandError(raw);
    expect(err).toBeInstanceOf(SuspensionCommandError);
    expect(err.code).toBe(code);
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.message).not.toContain('E_');
  });

  it('falls back to a shielded message for unknown SQLSTATE text', () => {
    const err = toCommandError('some raw postgres detail');
    expect(err.message).not.toContain('postgres');
  });

  it('rejects with a typed error when the RPC fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'E_FORBIDDEN' } });
    await expect(executeSuspension({ suspensionId: 's', expectedRowVersion: 1 })).rejects.toBeInstanceOf(
      SuspensionCommandError
    );
  });
});

describe('BN award suspension — execution outcomes', () => {
  it('treats an EXECUTION_FAILED result as a failure even without an exception', () => {
    const result = { execution_status: 'EXECUTION_FAILED' } as unknown as ExecutionResult;
    expect(isExecutionFailure(result)).toBe(true);
  });

  it('treats EXECUTED as success', () => {
    const result = { execution_status: 'EXECUTED' } as unknown as ExecutionResult;
    expect(isExecutionFailure(result)).toBe(false);
  });
});

describe('BN award suspension — payment impact boundary', () => {
  it('reads the ledger through the paged RPC, never the table', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await listSuspensionPaymentImpact({ suspensionId: 's1', limit: 25, offset: 0 });
    expect(lastArgs()[0]).toBe('bn_award_suspension_payment_impact_list_v1');
    expect(lastArgs()[1]).toMatchObject({ p_suspension_id: 's1', p_limit: 25, p_offset: 0 });
  });

  it('surfaces a permission error rather than partial figures', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'E_FORBIDDEN' } });
    await expect(previewReinstatementArrears('r1')).rejects.toMatchObject({ code: 'E_FORBIDDEN' });
  });
});

describe('BN award suspension — reinstatement proposal payload', () => {
  it('passes the reason code and narrative through to the command', async () => {
    await proposeReinstatement({
      suspensionId: 's1',
      effectiveFrom: '2026-01-01',
      reasonCode: 'EVIDENCE_RECEIVED',
      narrative: 'Certificate received and verified.',
    });
    expect(lastArgs()[1]).toMatchObject({
      p_reason_code: 'EVIDENCE_RECEIVED',
      p_narrative: 'Certificate received and verified.',
    });
  });
});
