/**
 * MEANS-TEST EPIC 8 — verification and clarification contract tests.
 *
 * Proves the browser boundary rules: verification commands route to the
 * governed verification RPC, readiness is never inferred in React, and the
 * frozen-version surface exposes only backend-decided actions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { meansCommandService } from '@/services/bn/meansTests/meansCommandService';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import {
  BN_MEANS_VERIFICATION_COMMANDS,
  describeDeclaredFact,
  outcomeRequiresClarification,
  outcomeRequiresReason,
  reasonOptionsForOutcome,
  resolveProcessingJourney,
  type BnMeansVerificationReadiness,
  type BnMeansVerificationReference,
} from '@/types/bn/meansTests/meansVerification';

const ACTOR = { data: { user: { id: 'a0000000-0000-4000-8000-000000000001', email: 'verifier@ssb' } } };

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue(ACTOR);
});

const REFERENCE: BnMeansVerificationReference = {
  outcomes: [
    { code: 'VERIFIED', label: 'Verified' },
    { code: 'REJECTED', label: 'Rejected', requires_reason: true },
    { code: 'CLARIFICATION_REQUIRED', label: 'Clarification', requires_reason: true, requires_clarification: true },
    { code: 'NOT_APPLICABLE', label: 'Not applicable', requires_reason: true },
  ],
  reject_reasons: [{ code: 'CONTRADICTED', label: 'Contradicted by evidence' }],
  clarification_reasons: [{ code: 'MISSING_DOC', label: 'Document missing' }],
  not_applicable_reasons: [{ code: 'OUT_OF_SCOPE', label: 'Out of scope' }],
  reopen_reasons: [],
  recipient_kinds: [{ code: 'CLAIMANT', label: 'Claimant' }],
  response_kinds: [{ code: 'DOCUMENT', label: 'Document received' }],
  fact_kinds: [],
};

describe('verification command routing', () => {
  it.each(BN_MEANS_VERIFICATION_COMMANDS)('routes %s to the verification boundary', async (command) => {
    rpc.mockResolvedValue({ data: { status: 'EXECUTED' }, error: null });
    await meansCommandService.execute({ command, assessmentId: 'x', payload: { work_id: 'w1' } });
    expect(rpc).toHaveBeenCalledWith('bn_means_verification_command_v1', expect.objectContaining({
      p_command_name: command,
      p_assessment_id: 'x',
    }));
  });

  it('does not route submission or intake commands to the verification boundary', async () => {
    rpc.mockResolvedValue({ data: { status: 'EXECUTED' }, error: null });
    await meansCommandService.execute({ command: 'BN_MEANS_SUBMIT', assessmentId: 'x' });
    expect(rpc).toHaveBeenCalledWith('bn_means_submission_command_v1', expect.anything());
    rpc.mockClear();
    await meansCommandService.execute({ command: 'BN_MEANS_ADD_INCOME', assessmentId: 'x' });
    expect(rpc).toHaveBeenCalledWith('bn_means_execute_command_v1', expect.anything());
  });

  it('maps the independence failure to a structured code', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'E_SELF_VERIFICATION_DENIED:submitter' } });
    const result = await meansCommandService.execute({
      command: 'BN_MEANS_RECORD_VERIFICATION_DECISION',
      assessmentId: 'x',
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('SELF_VERIFICATION_DENIED');
  });

  it('maps a tampered frozen snapshot to a structured code', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'E_FROZEN_VERSION_TAMPERED:hash mismatch' } });
    const result = await meansCommandService.execute({
      command: 'BN_MEANS_COMPLETE_VERIFICATION',
      assessmentId: 'x',
    });
    expect(result.errorCode).toBe('FROZEN_VERSION_TAMPERED');
  });
});

describe('verification reads', () => {
  it('calls the governed workspace query', async () => {
    rpc.mockResolvedValue({ data: { status: 'OK', data: { facts: [] } }, error: null });
    const result = await meansQueryService.verificationWorkspace('x');
    expect(rpc).toHaveBeenCalledWith('bn_means_verification_workspace_v1', expect.objectContaining({
      p_assessment_id: 'x',
    }));
    expect(result.status).toBe('OK');
  });

  it('never presents a failed queue read as an empty queue', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    const result = await meansQueryService.verificationQueue();
    expect(result.status).toBe('FAILED');
    expect(result.data).toBeNull();
  });

  it('propagates DENIED for verification readiness', async () => {
    rpc.mockResolvedValue({ data: { status: 'DENIED', code: 'PERMISSION_DENIED', data: null }, error: null });
    const result = await meansQueryService.verificationReadiness('x');
    expect(result.status).toBe('DENIED');
    expect(result.data).toBeNull();
  });
});

describe('outcome rules come from the reference payload', () => {
  it('knows which outcomes need a reason', () => {
    expect(outcomeRequiresReason(REFERENCE, 'VERIFIED')).toBe(false);
    expect(outcomeRequiresReason(REFERENCE, 'REJECTED')).toBe(true);
  });

  it('knows which outcome raises a clarification request', () => {
    expect(outcomeRequiresClarification(REFERENCE, 'CLARIFICATION_REQUIRED')).toBe(true);
    expect(outcomeRequiresClarification(REFERENCE, 'REJECTED')).toBe(false);
  });

  it('serves the matching reason list per outcome', () => {
    expect(reasonOptionsForOutcome(REFERENCE, 'REJECTED')[0].code).toBe('CONTRADICTED');
    expect(reasonOptionsForOutcome(REFERENCE, 'NOT_APPLICABLE')[0].code).toBe('OUT_OF_SCOPE');
    expect(reasonOptionsForOutcome(REFERENCE, 'VERIFIED')).toHaveLength(0);
  });

  it('offers nothing when the reference could not be loaded', () => {
    expect(reasonOptionsForOutcome(null, 'REJECTED')).toHaveLength(0);
    expect(outcomeRequiresReason(null, 'REJECTED')).toBe(false);
  });
});

const readiness = (over: Partial<BnMeansVerificationReadiness> = {}): BnMeansVerificationReadiness => ({
  assessment_id: 'x', assessment_version_id: 'v1', version_no: 1, frozen_at: '2026-08-08',
  snapshot_hash_valid: true, status: 'SUBMITTED', verification_complete: false,
  verification_marked_complete: false, verification_outcome: null, section_status: 'IN_PROGRESS',
  total_work: 4, pending_work: 2, in_progress_work: 1, clarification_pending_work: 1,
  completed_work: 0, cancelled_work: 0, verified_facts: 0, rejected_facts: 0,
  not_applicable_facts: 0, open_clarification_requests: 1, warnings: [], blockers: [],
  reason_codes: [], ...over,
});

describe('post-submission journey', () => {
  it('marks verification blocked when readiness is unavailable', () => {
    const stages = resolveProcessingJourney(null, true, 'SUBMITTED');
    expect(stages.find((s) => s.key === 'verification')?.state).toBe('BLOCKED');
    expect(stages.find((s) => s.key === 'calculation')?.state).toBe('PENDING');
  });

  it('keeps calculation pending while verification is outstanding', () => {
    const stages = resolveProcessingJourney(readiness(), false, 'SUBMITTED');
    expect(stages.find((s) => s.key === 'verification')?.state).toBe('CURRENT');
    expect(stages.find((s) => s.key === 'calculation')?.state).toBe('PENDING');
  });

  it('opens calculation only once verification is marked complete', () => {
    const stages = resolveProcessingJourney(
      readiness({ verification_marked_complete: true, pending_work: 0, in_progress_work: 0, clarification_pending_work: 0 }),
      false,
      'VERIFICATION_PENDING',
    );
    expect(stages.find((s) => s.key === 'verification')?.state).toBe('COMPLETE');
    expect(stages.find((s) => s.key === 'calculation')?.state).toBe('CURRENT');
  });
});

describe('frozen declared values render as business language', () => {
  it('describes an income fact without exposing raw ids', () => {
    const rows = describeDeclaredFact('INCOME', {
      category_code: 'EMPLOYMENT', source_name: 'Acme Ltd', declared_amount: 1200,
      declared_frequency: 'MONTHLY', normalised_annual_amount: 14400, income_id: 'uuid-not-shown',
    });
    expect(rows.map((r) => r.label)).toContain('Annualised');
    expect(JSON.stringify(rows)).not.toContain('uuid-not-shown');
  });

  it('returns nothing when no frozen declaration is available', () => {
    expect(describeDeclaredFact('ASSET', null)).toHaveLength(0);
  });
});
