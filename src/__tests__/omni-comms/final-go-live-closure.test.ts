/**
 * Omni-Comms — final Go-Live closure.
 *
 * Proves the guided workflow projection, the release-window presets and the
 * trusted-boundary request builders. Nothing here contacts a provider.
 */
import { describe, expect, it } from 'vitest';
import { buildGoLiveWorkflow } from '@/platform/omni-comms/admin/views/channels/goLiveWorkflow';
import {
  buildReleaseWindow,
  RELEASE_WINDOW_PRESETS,
  toDateTimeLocal,
} from '@/platform/omni-comms/application/releaseWindowPresets';
import {
  buildCertifyDeploymentBody,
  buildControlledSendBody,
  buildHeldPilotCandidateBody,
  type DeploymentStatus,
  type HeldPilotCandidate,
} from '@/platform/omni-comms/application/channelReleaseControlService';

const SHA = 'a'.repeat(40);

const deployment = (over: Partial<DeploymentStatus> = {}): DeploymentStatus => ({
  environment: 'production',
  runtime_revision: SHA,
  dispatcher_revision: SHA,
  release_identity: SHA,
  deployment_revision_mismatch: false,
  certification: { certification_state: 'certified', certified_commit: SHA },
  ...over,
});

const candidate: HeldPilotCandidate = {
  held_job_count: 1,
  candidate: {
    job_id: 'a136db93-1338-4036-ade6-6d43f65303d9',
    hold_reason: 'runtime_privileged_certification_pending',
    mode: 'queued',
    attempt_count: 0,
    is_runnable: false,
    event_code: 'BENEFITS.CLAIM.SUBMITTED',
    caller_module_code: 'BENEFITS',
    department_id: 'dept',
    recipient_masked: 'p***@example.test',
    recipient_hash: 'f'.repeat(64),
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const summaryWith = (over: Record<string, unknown>): any => ({
  release: {
    id: 'rel',
    updated_at: 'now',
    release_state: 'test_only',
    permitted_event_codes: [],
    permitted_caller_modules: [],
    pilot_recipient_rules: [],
    release_expires_at: null,
    release_fingerprint: 'fp',
    ...over,
  },
  capabilities: { can_configure: true, can_approve: true },
});

const baseInput = {
  summary: summaryWith({}),
  deployment: null,
  candidate: null,
  blockers: [] as string[],
  proposalActive: false,
  sameActorAsProposer: false,
  canConfigure: true,
  canApprove: true,
};

describe('Go-Live workflow projection', () => {
  it('exposes exactly seven ordered stages', () => {
    const wf = buildGoLiveWorkflow(baseInput);
    expect(wf.totalSteps).toBe(7);
    expect(wf.stages.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(wf.stages.map((s) => s.id)).toEqual([
      'deployment_environment',
      'deployment_certification',
      'pilot_configuration',
      'prerequisites',
      'proposal',
      'approval',
      'controlled_send',
    ]);
  });

  it('requires environment confirmation before certification', () => {
    const wf = buildGoLiveWorkflow({
      ...baseInput,
      deployment: deployment({
        environment: 'unknown',
        certification: { certification_state: 'pending', certified_commit: null },
      }),
    });
    expect(wf.stages[0].state).toBe('action_required');
    expect(wf.stages[1].state).toBe('blocked');
    expect(wf.readyForControlledSend).toBe(false);
  });

  it('blocks certification on a revision mismatch', () => {
    const wf = buildGoLiveWorkflow({
      ...baseInput,
      deployment: deployment({
        deployment_revision_mismatch: true,
        release_identity: null,
        dispatcher_revision: 'b'.repeat(40),
        certification: { certification_state: 'pending', certified_commit: null },
      }),
    });
    expect(wf.stages[1].state).toBe('blocked');
    expect(wf.stages[1].nextAction).toMatch(/Redeploy/);
  });

  it('treats a shortened certified commit as uncertified', () => {
    const wf = buildGoLiveWorkflow({
      ...baseInput,
      deployment: deployment({
        certification: { certification_state: 'certified', certified_commit: SHA.slice(0, 12) },
      }),
    });
    expect(wf.stages[1].state).toBe('action_required');
  });

  it('never allows the same actor to approve their own proposal', () => {
    const wf = buildGoLiveWorkflow({
      ...baseInput,
      deployment: deployment(),
      proposalActive: true,
      sameActorAsProposer: true,
    });
    const approval = wf.stages[5];
    expect(approval.state).toBe('waiting');
    expect(approval.nextAction).toMatch(/second administrator/i);
  });

  it('keeps the controlled send blocked until the pilot is active', () => {
    const wf = buildGoLiveWorkflow({ ...baseInput, deployment: deployment(), candidate });
    expect(wf.stages[6].state).toBe('blocked');
    expect(wf.readyForControlledSend).toBe(false);
  });

  it('reaches 6/7 and offers exactly one controlled send when everything is proven', () => {
    const wf = buildGoLiveWorkflow({
      ...baseInput,
      deployment: deployment(),
      candidate,
      summary: summaryWith({
        release_state: 'controlled_pilot',
        permitted_event_codes: ['BENEFITS.CLAIM.SUBMITTED'],
        permitted_caller_modules: ['BENEFITS'],
        pilot_recipient_rules: [{ target_masked: 'p***@example.test' }],
        release_expires_at: '2026-08-13T00:00:00Z',
      }),
    });
    expect(wf.progressLabel).toBe('6/7');
    expect(wf.readyForControlledSend).toBe(true);
    expect(wf.stages[6].state).toBe('action_required');
  });
});

describe('Release window presets', () => {
  it('always produces a bounded forward window', () => {
    const now = new Date('2026-08-12T10:00:00');
    for (const preset of RELEASE_WINDOW_PRESETS) {
      const w = buildReleaseWindow(preset.hours, now);
      expect(w.startsAt).toBe(toDateTimeLocal(now));
      expect(new Date(w.expiresAt).getTime()).toBeGreaterThan(new Date(w.startsAt).getTime());
    }
  });

  it('offers a 2-hour supervised option', () => {
    expect(RELEASE_WINDOW_PRESETS.some((p) => p.hours === 2)).toBe(true);
  });
});

describe('Trusted boundary request builders', () => {
  it('sends no browser-supplied revision with certification', () => {
    expect(buildCertifyDeploymentBody()).toEqual({ action: 'certify_deployment' });
  });

  it('scopes the held-message probe to one organisation', () => {
    expect(buildHeldPilotCandidateBody('org-1')).toEqual({
      action: 'held_pilot_candidate',
      organizationId: 'org-1',
    });
    expect(buildHeldPilotCandidateBody('org-1', 'dept-1')).toEqual({
      action: 'held_pilot_candidate',
      organizationId: 'org-1',
      departmentId: 'dept-1',
    });
  });

  it('names only the release control for the final controlled send', () => {
    expect(buildControlledSendBody('rel-1')).toEqual({
      action: 'release_one_controlled_message',
      releaseControlId: 'rel-1',
    });
    expect(buildControlledSendBody('rel-1', { confirmOnly: true })).toEqual({
      action: 'release_one_controlled_message',
      releaseControlId: 'rel-1',
      confirmOnly: true,
    });
  });
});
