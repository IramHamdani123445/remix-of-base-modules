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
  describeExecutionFailure,
  SUSPENSION_ERROR_MESSAGES,
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

describe('BN award suspension — sanitized failure reporting', () => {
  it('maps every approved operational failure code to an operator-safe sentence', () => {
    const codes = [
      'E_PAYMENT_IMPACT_FAILED',
      'E_PAYMENT_HOLD_FAILED',
      'E_AUDIT_FAILED',
      'E_COMMUNICATION_INTENT_FAILED',
      'E_CALCULATION_PERSIST_FAILED',
      'E_EXECUTION_INTERNAL',
    ];
    for (const code of codes) {
      const text = describeExecutionFailure(code);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('E_');
      expect(text.toLowerCase()).not.toContain('sqlstate');
    }
  });

  it('never echoes raw database text back to the operator', () => {
    const text = describeExecutionFailure(
      'ERROR: null value in column "amount" of relation "bn_payment_instruction"'
    );
    expect(text).not.toContain('bn_payment_instruction');
    expect(text).toBe(SUSPENSION_ERROR_MESSAGES.E_UNKNOWN);
  });

  it('treats a sanitized EXECUTION_FAILED payload as a failure', () => {
    const result = {
      execution_status: 'FAILED',
      status: 'EXECUTION_FAILED',
      error_code: 'E_PAYMENT_HOLD_FAILED',
      correlation_id: 'c-1',
      attempt_count: 2,
    } as unknown as ExecutionResult;
    expect(isExecutionFailure(result)).toBe(true);
    expect(Object.keys(result)).not.toContain('error');
  });
});
