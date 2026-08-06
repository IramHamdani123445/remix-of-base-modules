/**
 * BN Means-Test — MT2/MT3 command service guards.
 *
 * Proves the browser boundary: deterministic payload hashing (idempotent
 * replay vs changed-payload rejection), structured error mapping, and that
 * no browser code mutates `bn_means_*` tables directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const rpc = vi.fn();
const getUser = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getUser: () => getUser() },
    from: () => {
      throw new Error('direct table access is prohibited');
    },
  },
}));

import {
  meansCommandService,
  canonicalisePayload,
  computePayloadHash,
  parseCommandError,
} from '@/services/bn/meansTests/meansCommandService';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';

const ACTOR = { data: { user: { id: 'a0000000-0000-4000-8000-000000000001', email: 'officer@ssb' } } };

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue(ACTOR);
});

describe('payload canonicalisation', () => {
  it('is key-order independent', () => {
    expect(canonicalisePayload({ b: 1, a: 2 })).toBe(canonicalisePayload({ a: 2, b: 1 }));
  });

  it('produces identical hashes for identical payloads and different for changed ones', async () => {
    const h1 = await computePayloadHash({ amount: 100, frequency: 'MONTHLY' });
    const h2 = await computePayloadHash({ frequency: 'MONTHLY', amount: 100 });
    const h3 = await computePayloadHash({ frequency: 'MONTHLY', amount: 101 });
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

describe('structured error mapping', () => {
  it.each([
    ['E_ACTIONS_DISABLED:BN_MEANS_SUBMIT', 'ACTIONS_DISABLED'],
    ['E_PERMISSION_DENIED:BN_MEANS_APPROVE', 'PERMISSION_DENIED'],
    ['E_STALE_ROW_VERSION:expected=1 actual=3', 'STALE_ROW_VERSION'],
    ['E_SELF_APPROVAL_DENIED:BN_MEANS_APPROVE', 'SELF_APPROVAL_DENIED'],
    ['E_MAKER_CHECKER_REQUIRED:needs prior', 'MAKER_CHECKER_REQUIRED'],
    ['E_MISSING_EVIDENCE:2 required evidence type(s)', 'MISSING_EVIDENCE'],
    ['E_CURRENCY_MISMATCH:policy=XCD payload=USD', 'CURRENCY_MISMATCH'],
    ['E_DUPLICATE_OPEN_ASSESSMENT:SB 2026-01-01', 'DUPLICATE_OPEN_ASSESSMENT'],
    ['E_IDEMPOTENCY_PAYLOAD_MISMATCH:BN_MEANS_ADD_INCOME', 'IDEMPOTENCY_PAYLOAD_MISMATCH'],
    ['boom', 'UNKNOWN'],
  ])('maps %s', (message, code) => {
    expect(parseCommandError(message).code).toBe(code);
  });
});

describe('meansCommandService.execute', () => {
  it('routes every mutation through the governed RPC', async () => {
    rpc.mockResolvedValue({ data: { status: 'EXECUTED', assessment_id: 'x', entity_version: 2 }, error: null });
    const result = await meansCommandService.execute({
      command: 'BN_MEANS_ADD_INCOME',
      assessmentId: 'x',
      expectedRowVersion: 1,
      payload: { category_code: 'EMPLOYMENT', declared_amount: 100 },
      idempotencyKey: 'b0000000-0000-4000-8000-000000000002',
    });
    expect(rpc).toHaveBeenCalledWith('bn_means_execute_command_v1', expect.objectContaining({
      p_command_name: 'BN_MEANS_ADD_INCOME',
      p_assessment_id: 'x',
      p_expected_row_version: 1,
      p_idempotency_key: 'b0000000-0000-4000-8000-000000000002',
    }));
    expect(result.status).toBe('EXECUTED');
    expect(result.entityVersion).toBe(2);
  });

  it('surfaces REPLAYED without treating it as a new execution', async () => {
    rpc.mockResolvedValue({ data: { status: 'REPLAYED', assessment_id: 'x' }, error: null });
    const result = await meansCommandService.execute({ command: 'BN_MEANS_SUBMIT', assessmentId: 'x' });
    expect(result.status).toBe('REPLAYED');
  });

  it('refuses to call the RPC without an authenticated actor', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const result = await meansCommandService.execute({ command: 'BN_MEANS_SUBMIT', assessmentId: 'x' });
    expect(rpc).not.toHaveBeenCalled();
    expect(result.errorCode).toBe('UNAUTHENTICATED');
  });

  it('returns a structured failure instead of throwing', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'E_INVALID_STATE:SUBMITTED -> SUBMITTED' } });
    const result = await meansCommandService.execute({ command: 'BN_MEANS_SUBMIT', assessmentId: 'x' });
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('INVALID_STATE');
  });
});

describe('meansQueryService', () => {
  it('never represents a failed read as an empty success', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    const result = await meansQueryService.workQueue();
    expect(result.status).toBe('FAILED');
    expect(result.data).toBeNull();
  });

  it('propagates DENIED envelopes', async () => {
    rpc.mockResolvedValue({ data: { status: 'DENIED', code: 'PERMISSION_DENIED', data: null }, error: null });
    const result = await meansQueryService.detail('x');
    expect(result.status).toBe('DENIED');
    expect(result.code).toBe('PERMISSION_DENIED');
    expect(result.data).toBeNull();
  });

  it('exposes the canonical available-actions query', async () => {
    rpc.mockResolvedValue({
      data: { status: 'OK', data: [{ command: 'BN_MEANS_SUBMIT', allowed: false, reason: 'ACTIONS_DISABLED', row_version: 1 }] },
      error: null,
    });
    const result = await meansQueryService.availableActions('x');
    expect(result.status).toBe('OK');
    expect(result.data?.[0].reason).toBe('ACTIONS_DISABLED');
  });
});

describe('no direct browser mutation of bn_means_* tables', () => {
  const roots = ['src/services/bn/meansTests', 'src/pages/bn/meansTests', 'src/components/bn/meansTests'];

  function walk(dir: string): string[] {
    let out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out = out.concat(walk(full));
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
  }

  it('contains no supabase.from("bn_means_*") write chains', () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const source = readFileSync(file, 'utf8');
        if (/from\(\s*['"]bn_means_/.test(source)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
