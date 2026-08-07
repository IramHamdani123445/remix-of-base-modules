/**
 * MEANS-TEST EPIC 11 — Activation and Eligibility integration guards.
 *
 * Proves the browser boundary: every activation mutation goes through the
 * governed activation RPC, reads never present a failure as "not active",
 * and the Benefit 360 posture never carries household finances.
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
import { BN_MEANS_COMMANDS, getMeansCommandSpec } from '@/types/bn/meansTests/meansCommands';
import { BN_GAP_COMMAND_CAPABILITY } from '@/services/bn/commands/benefitsCapabilityRegistry';
import {
  BN_MEANS_ACTIVATION_COMMANDS,
  activationReasonLabel,
  eligibilityStatusLabel,
  eligibilityTone,
} from '@/types/bn/meansTests/meansActivation';

const ACTOR = { data: { user: { id: 'a0000000-0000-4000-8000-000000000001', email: 'officer@ssb' } } };

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue(ACTOR);
});

describe('EPIC 11 — activation command catalogue', () => {
  it('registers every activation command with a means-test capability', () => {
    for (const command of BN_MEANS_ACTIVATION_COMMANDS) {
      const spec = getMeansCommandSpec(command);
      expect(spec, `${command} missing`).toBeDefined();
      expect(BN_GAP_COMMAND_CAPABILITY[command]).toBe(spec!.capability);
      expect(spec!.capability.startsWith('bn_means_tests:')).toBe(true);
    }
  });

  it('keeps activation and fact-publication retry on the approval capability', () => {
    expect(getMeansCommandSpec('BN_MEANS_ACTIVATE')!.capability).toBe('bn_means_tests:approve');
    expect(getMeansCommandSpec('BN_MEANS_RETRY_FACT_PUBLICATION')!.capability).toBe('bn_means_tests:approve');
    expect(getMeansCommandSpec('BN_MEANS_RETRY_ELIGIBILITY_REQUEST')!.capability).toBe('bn_means_tests:approve');
  });

  it('marks activation and republication as fact-publishing commands', () => {
    expect(getMeansCommandSpec('BN_MEANS_ACTIVATE')!.publishesFacts).toBe(true);
    expect(getMeansCommandSpec('BN_MEANS_RETRY_FACT_PUBLICATION')!.publishesFacts).toBe(true);
  });

  it('never introduces an award-creation command from activation', () => {
    expect(BN_MEANS_COMMANDS.some((c) => /CREATE_AWARD/.test(c.command))).toBe(false);
  });
});

describe('EPIC 11 — activation command routing', () => {
  it.each(BN_MEANS_ACTIVATION_COMMANDS)('routes %s through the activation boundary', async (command) => {
    rpc.mockResolvedValue({ data: { status: 'EXECUTED', assessment_id: 'x', entity_version: 4 }, error: null });
    const result = await meansCommandService.execute({
      command,
      assessmentId: 'x',
      expectedRowVersion: 3,
      idempotencyKey: 'b0000000-0000-4000-8000-000000000011',
    });
    expect(rpc).toHaveBeenCalledWith(
      'bn_means_activation_command_v1',
      expect.objectContaining({
        p_command_name: command,
        p_assessment_id: 'x',
        p_expected_row_version: 3,
        p_idempotency_key: 'b0000000-0000-4000-8000-000000000011',
      }),
    );
    expect(result.status).toBe('EXECUTED');
  });

  it('surfaces an idempotent replay as REPLAYED rather than a second activation', async () => {
    rpc.mockResolvedValue({ data: { status: 'REPLAYED', assessment_id: 'x', already_active: true }, error: null });
    const result = await meansCommandService.execute({ command: 'BN_MEANS_ACTIVATE', assessmentId: 'x' });
    expect(result.status).toBe('REPLAYED');
  });

  it.each([
    ['E_ALREADY_ACTIVE:x', 'ALREADY_ACTIVE'],
    ['E_APPEAL_IN_PROGRESS:appeal open', 'APPEAL_IN_PROGRESS'],
    ['E_ASSESSMENT_NOT_APPROVED:DRAFT', 'ASSESSMENT_NOT_APPROVED'],
    ['E_APPROVED_CALCULATION_STALE:seq 2', 'APPROVED_CALCULATION_STALE'],
    ['E_FROZEN_VERSION_TAMPERED:hash', 'FROZEN_VERSION_TAMPERED'],
    ['E_FACT_PUBLICATION_NOT_READY:missing dates', 'FACT_PUBLICATION_NOT_READY'],
    ['E_POLICY_RETIRED:v1', 'POLICY_RETIRED'],
    ['E_ELIGIBILITY_BOUNDARY_UNAVAILABLE:down', 'ELIGIBILITY_BOUNDARY_UNAVAILABLE'],
  ])('maps %s to a structured failure', async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    const result = await meansCommandService.execute({ command: 'BN_MEANS_ACTIVATE', assessmentId: 'x' });
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe(code);
  });

  it('refuses to activate without an authenticated actor', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const result = await meansCommandService.execute({ command: 'BN_MEANS_ACTIVATE', assessmentId: 'x' });
    expect(rpc).not.toHaveBeenCalled();
    expect(result.errorCode).toBe('UNAUTHENTICATED');
  });
});

describe('EPIC 11 — governed activation reads', () => {
  it('reads the activation context through the governed RPC', async () => {
    rpc.mockResolvedValue({ data: { status: 'OK', data: { assessment: { assessment_id: 'x' } } }, error: null });
    const result = await meansQueryService.activationContext('x');
    expect(rpc).toHaveBeenCalledWith('bn_means_activation_context_v1', {
      p_actor_user_id: ACTOR.data.user.id,
      p_assessment_id: 'x',
    });
    expect(result.status).toBe('OK');
  });

  it('reads backend-owned readiness rather than deriving it', async () => {
    rpc.mockResolvedValue({
      data: { status: 'OK', data: { state: 'BLOCKED', can_activate: false, blockers: [{ code: 'POLICY_RETIRED', message: 'x' }] } },
      error: null,
    });
    const result = await meansQueryService.activationReadiness('x');
    expect(rpc).toHaveBeenCalledWith('bn_means_activation_readiness_v1', expect.any(Object));
    expect(result.data?.can_activate).toBe(false);
  });

  it('never represents a failed activation read as "not active"', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    const result = await meansQueryService.activationContext('x');
    expect(result.status).toBe('FAILED');
    expect(result.data).toBeNull();
  });

  it('propagates DENIED activation reads', async () => {
    rpc.mockResolvedValue({ data: { status: 'DENIED', code: 'PERMISSION_DENIED', data: null }, error: null });
    const result = await meansQueryService.activationReadiness('x');
    expect(result.status).toBe('DENIED');
    expect(result.data).toBeNull();
  });

  it('keeps the Benefit 360 summary free of household finances', async () => {
    rpc.mockResolvedValue({
      data: {
        status: 'OK',
        data: {
          assessment_reference: 'MT-1',
          status: 'ACTIVE',
          fact_publication_status: 'PUBLISHED',
          eligibility_status: 'COMPLETED',
          award_review_required: false,
        },
      },
      error: null,
    });
    const result = await meansQueryService.benefit360Summary({ awardId: 'aw-1' });
    const keys = Object.keys(result.data ?? {});
    for (const forbidden of ['assessable_income', 'assessable_assets', 'household_size', 'threshold', 'excess_amount']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('EPIC 11 — presentation contract', () => {
  it('gives every backend blocker code plain wording', () => {
    for (const code of [
      'ALREADY_ACTIVE', 'APPEAL_IN_PROGRESS', 'ASSESSMENT_NOT_APPROVED',
      'APPROVED_CALCULATION_STALE', 'APPROVAL_CALCULATION_MISMATCH',
      'FROZEN_VERSION_TAMPERED', 'CALCULATION_HASH_MISMATCH',
      'VERIFICATION_NO_LONGER_VALID', 'OPEN_ADJUSTMENT_EXISTS',
      'POLICY_RETIRED', 'FACT_PUBLICATION_NOT_READY',
    ]) {
      expect(activationReasonLabel(code)).not.toBe(code);
    }
  });

  it('labels and tones every eligibility status', () => {
    expect(eligibilityStatusLabel('NOT_REQUESTED')).toBe('Not requested');
    expect(eligibilityStatusLabel('PROCESSING')).toBe('In progress');
    expect(eligibilityTone('FAILED')).toBe('destructive');
    expect(eligibilityTone('COMPLETED')).toBe('default');
    expect(eligibilityTone('NOT_REQUESTED')).toBe('outline');
  });
});
