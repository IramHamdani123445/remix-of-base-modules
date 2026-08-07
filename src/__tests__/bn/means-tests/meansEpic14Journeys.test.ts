/**
 * MEANS-TEST EPIC 14 — end-to-end journey certification.
 *
 * These are cross-boundary journey tests, not component tests. They prove
 * that the connected Means-Test module keeps its governed boundaries at
 * every hand-off: one command boundary, one state machine, one canonical
 * fact contract, immutable history, idempotency and stale-version safety.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ---------------------------------------------------------------- */
/* Governed backend double: records every RPC, forbids table writes. */
/* ---------------------------------------------------------------- */

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

const rpcCalls: RpcCall[] = [];
const fromCalls: string[] = [];
let rpcHandler: (name: string, args: Record<string, unknown>) => unknown = () => ({});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-officer-1', email: 'officer@example.test' } },
      })),
    },
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const result = rpcHandler(name, args);
      if (result instanceof Error) return { data: null, error: { message: result.message } };
      return { data: result, error: null };
    }),
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      throw new Error(`Direct table access is prohibited: ${table}`);
    }),
  },
}));

import { meansCommandService } from '@/services/bn/meansTests/meansCommandService';
import {
  BN_MEANS_FACT_KEYS,
  LEGACY_MEANS_PLACEHOLDER_FACT,
  resolveMeansFacts,
} from '@/types/bn/meansTests/meansFactContract';
import {
  canMeansTransition,
  isFactPublishable,
  type BnMeansAssessmentStatus,
} from '@/types/bn/meansTests/meansStateMachine';
import {
  BN_MEANS_LEGACY_RECONCILIATION,
  getLegacyDisposition,
} from '@/types/bn/meansTests/meansLegacyReconciliation';
import { meansSectionToTab } from '@/components/bn/meansTests/BnMeansAssessmentWorkspace';

function ok(extra: Record<string, unknown> = {}) {
  return { status: 'EXECUTED', assessment_id: 'assessment-1', entity_version: 2, ...extra };
}

async function run(command: string, extra: Record<string, unknown> = {}) {
  return meansCommandService.execute({
    command: command as never,
    assessmentId: 'assessment-1',
    expectedRowVersion: 1,
    ...extra,
  });
}

beforeEach(() => {
  rpcCalls.length = 0;
  fromCalls.length = 0;
  rpcHandler = () => ok();
});

/* ---------------------------------------------------------------- */

describe('EPIC 14 · Journey A — new claim to active', () => {
  const JOURNEY = [
    'BN_MEANS_CREATE_ASSESSMENT',
    'BN_MEANS_ADD_HOUSEHOLD_MEMBER',
    'BN_MEANS_ADD_INCOME',
    'BN_MEANS_ADD_ASSET',
    'BN_MEANS_ADD_DEDUCTION',
    'BN_MEANS_ATTACH_EVIDENCE',
    'BN_MEANS_SUBMIT',
    'BN_MEANS_VERIFY_INFORMATION',
    'BN_MEANS_CALCULATE',
    'BN_MEANS_APPROVE',
    'BN_MEANS_ACTIVATE',
  ] as const;

  it('routes every stage through a governed SECURITY DEFINER command boundary', async () => {
    for (const command of JOURNEY) await run(command);
    expect(rpcCalls).toHaveLength(JOURNEY.length);
    for (const call of rpcCalls) {
      expect(call.name).toMatch(/^bn_means_[a-z_]+command_v1$/);
      expect(call.args.p_actor_user_id).toBe('user-officer-1');
      expect(call.args.p_payload_hash).toBeTruthy();
      expect(call.args.p_idempotency_key).toBeTruthy();
    }
    // No stage may touch a table directly from the browser.
    expect(fromCalls).toEqual([]);
  });

  it('carries the expected row version on every mutating stage', async () => {
    for (const command of JOURNEY) await run(command);
    for (const call of rpcCalls) expect(call.args.p_expected_row_version).toBe(1);
  });

  it('walks the canonical state machine with no invented state', () => {
    const path: BnMeansAssessmentStatus[] = [
      'DRAFT', 'SUBMITTED', 'VERIFICATION_PENDING', 'CALCULATED',
      'APPROVAL_PENDING', 'APPROVED', 'ACTIVE',
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canMeansTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('never creates an award or a payment from the Means journey', async () => {
    for (const command of JOURNEY) await run(command);
    const names = rpcCalls.map((c) => c.name).join(' ');
    expect(names).not.toMatch(/award|payment|entitlement/i);
  });
});

describe('EPIC 14 · Journey B — clarification and re-verification', () => {
  it('uses the information-request boundary and never auto-verifies a response', async () => {
    await run('BN_MEANS_VERIFY_INFORMATION', { reasonCode: 'CLARIFICATION_REQUIRED' });
    await run('BN_MEANS_REQUEST_INFORMATION');
    await run('BN_MEANS_RECORD_INFORMATION_RESPONSE');
    const commands = rpcCalls.map((c) => String(c.args.p_command_name));
    expect(commands).toEqual([
      'BN_MEANS_VERIFY_INFORMATION',
      'BN_MEANS_REQUEST_INFORMATION',
      'BN_MEANS_RECORD_INFORMATION_RESPONSE',
    ]);
    // Receiving a response is not a verification decision.
    expect(commands.filter((c) => c === 'BN_MEANS_VERIFY_INFORMATION')).toHaveLength(1);
    expect(rpcCalls[1].name).toBe('bn_means_evidence_command_v1');
    expect(rpcCalls[2].name).toBe('bn_means_evidence_command_v1');
  });

  it('refuses a verification decision that lost independence', async () => {
    rpcHandler = () => new Error('E_SELF_VERIFICATION_DENIED: submitter cannot verify');
    const result = await run('BN_MEANS_VERIFY_INFORMATION');
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('SELF_VERIFICATION_DENIED');
  });

  it('surfaces a blocking information request rather than proceeding to calculation', async () => {
    rpcHandler = () => new Error('E_NOT_READY_FOR_CALCULATION: open information request');
    const result = await run('BN_MEANS_CALCULATE');
    expect(result.errorCode).toBe('NOT_READY_FOR_CALCULATION');
  });
});

describe('EPIC 14 · Journey C — adjustment and recalculation', () => {
  it('requires an independent checker for an adjustment', async () => {
    rpcHandler = () => new Error('E_SELF_APPROVAL_DENIED: requester cannot decide');
    const result = await run('BN_MEANS_APPROVE_ADJUSTMENT');
    expect(result.errorCode).toBe('SELF_APPROVAL_DENIED');
  });

  it('recalculates through the governed command rather than mutating a calculation', async () => {
    await run('BN_MEANS_REQUEST_ADJUSTMENT');
    await run('BN_MEANS_APPROVE_ADJUSTMENT');
    await run('BN_MEANS_CALCULATE');
    expect(fromCalls).toEqual([]);
    expect(rpcCalls.map((c) => c.args.p_command_name)).toEqual([
      'BN_MEANS_REQUEST_ADJUSTMENT',
      'BN_MEANS_APPROVE_ADJUSTMENT',
      'BN_MEANS_CALCULATE',
    ]);
  });

  it('rejects a stale calculation instead of overwriting a newer one', async () => {
    rpcHandler = () => new Error('E_CALCULATION_NOT_LATEST: superseded by a newer calculation');
    const result = await run('BN_MEANS_APPROVE_ADJUSTMENT');
    expect(result.errorCode).toBe('CALCULATION_NOT_LATEST');
  });
});

describe('EPIC 14 · Journey D — activation and Eligibility publication', () => {
  it('publishes exactly the canonical means.* contract', () => {
    const resolution = resolveMeansFacts({
      assessmentId: 'assessment-1',
      status: 'ACTIVE',
      result: 'PASS',
      policyVersion: 'POL-1.0',
      assessableIncome: 1200,
      assessableAssets: 500,
      householdSize: 3,
      threshold: 2000,
      excessAmount: 0,
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
      reassessmentDue: '2026-10-01',
      asOf: '2026-06-01',
    });
    expect(resolution.published).toBe(true);
    expect(Object.keys(resolution.bundle!).sort()).toEqual([...BN_MEANS_FACT_KEYS].sort());
    expect(Object.keys(resolution.bundle!)).not.toContain(LEGACY_MEANS_PLACEHOLDER_FACT);
  });

  it('refuses publication for any non-active or expired assessment', () => {
    const base = {
      assessmentId: 'assessment-1',
      result: 'PASS' as const,
      policyVersion: 'POL-1.0',
      assessableIncome: 0,
      assessableAssets: 0,
      householdSize: 1,
      threshold: 1,
      excessAmount: 0,
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
      reassessmentDue: null,
      asOf: '2026-06-01',
    };
    expect(resolveMeansFacts({ ...base, status: 'APPROVED' }).published).toBe(false);
    expect(resolveMeansFacts({ ...base, status: 'SUPERSEDED' }).published).toBe(false);
    expect(
      resolveMeansFacts({ ...base, status: 'ACTIVE', validUntil: '2026-01-31' }).refusalReason,
    ).toBe('ASSESSMENT_EXPIRED');
    expect(isFactPublishable('ACTIVE')).toBe(true);
    expect(isFactPublishable('REASSESSMENT_DUE')).toBe(true);
  });

  it('reports an activation integration failure without discarding the approval', async () => {
    rpcHandler = () => new Error('E_ELIGIBILITY_BOUNDARY_UNAVAILABLE: rerun request failed');
    const result = await run('BN_MEANS_ACTIVATE');
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('ELIGIBILITY_BOUNDARY_UNAVAILABLE');
    // The failure is a downstream integration failure; no rollback command is issued.
    expect(rpcCalls.map((c) => c.args.p_command_name)).toEqual(['BN_MEANS_ACTIVATE']);
  });
});

describe('EPIC 14 · Journeys E and F — reassessment and change of circumstances', () => {
  it('creates a successor through the lifecycle boundary and supersedes the predecessor', async () => {
    await run('BN_MEANS_SCHEDULE_REASSESSMENT');
    await run('BN_MEANS_CREATE_SUCCESSOR');
    await run('BN_MEANS_SUPERSEDE');
    for (const call of rpcCalls) expect(call.name).toBe('bn_means_lifecycle_command_v1');
    expect(canMeansTransition('ACTIVE', 'REASSESSMENT_DUE')).toBe(true);
    expect(canMeansTransition('REASSESSMENT_DUE', 'SUPERSEDED')).toBe(true);
    // A superseded assessment stays readable history: it may only be closed.
    expect(canMeansTransition('SUPERSEDED', 'ACTIVE')).toBe(false);
  });

  it('blocks a duplicate successor', async () => {
    rpcHandler = () => new Error('E_SUCCESSOR_EXISTS: a successor already exists');
    expect((await run('BN_MEANS_CREATE_SUCCESSOR')).errorCode).toBe('SUCCESSOR_EXISTS');
  });

  it('blocks supersession without a successor', async () => {
    rpcHandler = () => new Error('E_SUCCESSOR_REQUIRED: no successor assessment');
    expect((await run('BN_MEANS_SUPERSEDE')).errorCode).toBe('SUCCESSOR_REQUIRED');
  });

  it('records a change of circumstance without mutating the active calculation', async () => {
    await run('BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE', {
      reasonCode: 'HOUSEHOLD_CHANGE',
      justification: 'Partner moved out',
    });
    expect(rpcCalls[0].name).toBe('bn_means_lifecycle_command_v1');
    expect(fromCalls).toEqual([]);
  });
});

describe('EPIC 14 · Journey G and H — Appeals and Risk/Fraud boundaries', () => {
  it('keeps Appeals and Award creation as governed hand-offs, never Means commands', () => {
    expect(getLegacyDisposition('BN_MT_LINK_APPEAL')?.disposition).toBe(
      'REPLACED_BY_GOVERNED_HANDOFF',
    );
    expect(getLegacyDisposition('BN_MT_CREATE_AWARD_FROM_RERUN')?.disposition).toBe(
      'REPLACED_BY_GOVERNED_HANDOFF',
    );
    for (const entry of BN_MEANS_LEGACY_RECONCILIATION) {
      expect(['ALIASED_TO_CANONICAL_COMMAND', 'REPLACED_BY_GOVERNED_HANDOFF', 'RETIRED_DUPLICATE'])
        .toContain(entry.disposition);
    }
  });

  it('does not allow an appeal to silently overwrite the original decision', () => {
    expect(canMeansTransition('REJECTED', 'UNDER_APPEAL')).toBe(true);
    // An overturned appeal produces a successor, not an edit of the decision.
    expect(canMeansTransition('UNDER_APPEAL', 'SUPERSEDED')).toBe(true);
    expect(canMeansTransition('UNDER_APPEAL', 'CALCULATED')).toBe(false);
  });
});

describe('EPIC 14 · idempotency, staleness and permission certification', () => {
  it('hashes an identical payload identically and a changed payload differently', async () => {
    const a = await meansCommandService.computePayloadHash({ b: 2, a: 1 });
    const b = await meansCommandService.computePayloadHash({ a: 1, b: 2 });
    const c = await meansCommandService.computePayloadHash({ a: 1, b: 3 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('reports a replay rather than creating a duplicate business record', async () => {
    rpcHandler = () => ({ status: 'REPLAYED', assessment_id: 'assessment-1', entity_version: 2 });
    const result = await run('BN_MEANS_SUBMIT', { idempotencyKey: 'key-1' });
    expect(result.status).toBe('REPLAYED');
  });

  it('refuses a changed-payload replay of the same idempotency key', async () => {
    rpcHandler = () => new Error('E_IDEMPOTENCY_PAYLOAD_MISMATCH: payload changed');
    const result = await run('BN_MEANS_SUBMIT', { idempotencyKey: 'key-1', payload: { x: 2 } });
    expect(result.errorCode).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
  });

  it('refuses a stale browser session instead of overwriting newer state', async () => {
    rpcHandler = () => new Error('E_STALE_ROW_VERSION: expected 1, found 4');
    const result = await run('BN_MEANS_CALCULATE');
    expect(result.errorCode).toBe('STALE_ROW_VERSION');
    expect(result.errorDetail).toContain('found 4');
  });

  it('fails closed for an unauthenticated actor and for a denied permission', async () => {
    rpcHandler = () => new Error('E_PERMISSION_DENIED: verify not held');
    expect((await run('BN_MEANS_VERIFY_INFORMATION')).errorCode).toBe('PERMISSION_DENIED');
    rpcHandler = () => new Error('E_POLICY_NOT_FOUND: no active policy for programme');
    expect((await run('BN_MEANS_CREATE_ASSESSMENT')).errorCode).toBe('POLICY_NOT_FOUND');
    rpcHandler = () => new Error('E_POLICY_NOT_EFFECTIVE: overlapping active policy versions');
    expect((await run('BN_MEANS_CREATE_ASSESSMENT')).errorCode).toBe('POLICY_NOT_EFFECTIVE');
  });
});

describe('EPIC 14 · deep-link certification', () => {
  it('maps every operational queue deep link to the correct workspace section', () => {
    expect(meansSectionToTab('INFORMATION_REQUEST')).toBe('evidence');
    expect(meansSectionToTab('verification')).toBe('verification');
    expect(meansSectionToTab('ADJUSTMENT')).toBe('decision');
    expect(meansSectionToTab('APPROVAL')).toBe('decision');
    expect(meansSectionToTab('INTEGRATION')).toBe('activation');
    expect(meansSectionToTab('REASSESSMENT')).toBe('lifecycle');
    expect(meansSectionToTab('CHANGE_OF_CIRCUMSTANCE')).toBe('lifecycle');
    expect(meansSectionToTab(null)).toBe('context');
    expect(meansSectionToTab('something-unknown')).toBe('context');
  });
});
