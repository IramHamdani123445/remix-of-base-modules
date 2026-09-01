import { describe, it, expect } from 'vitest';
import {
  normalizeChannelCode,
  channelsMatch,
} from '@/services/bn/workflow/channelNormalization';
import {
  stepForClaimStatus,
  mappedClaimStatuses,
} from '@/services/bn/workflow/claimStatusStepMap';
import {
  basketRoleForStepRole,
  stepByName,
  firstStep,
  STEP_NAME_TO_BASKET_ROLE,
} from '@/services/bn/intake/claimWorkbasketResolver';

describe('channel normalisation', () => {
  it('collapses every stored spelling onto ONLINE / OFFLINE', () => {
    // The three vocabularies that exist in live data.
    expect(normalizeChannelCode('STAFF_OFFLINE')).toBe('OFFLINE');
    expect(normalizeChannelCode('OFFLINE')).toBe('OFFLINE');
    expect(normalizeChannelCode('ASSISTED_COUNTER')).toBe('OFFLINE');
    expect(normalizeChannelCode('PUBLIC_ONLINE')).toBe('ONLINE');
    expect(normalizeChannelCode('ONLINE_PORTAL')).toBe('ONLINE');
    expect(normalizeChannelCode('ONLINE')).toBe('ONLINE');
  });

  it('is tolerant of case and separators but not of unknown channels', () => {
    expect(normalizeChannelCode('online-portal')).toBe('ONLINE');
    expect(normalizeChannelCode(' Staff Offline ')).toBe('OFFLINE');
    // An unknown channel must be reported, never guessed into a default.
    expect(normalizeChannelCode('FAX')).toBeNull();
    expect(normalizeChannelCode(null)).toBeNull();
  });

  it('matches the spellings that previously failed to match', () => {
    expect(channelsMatch('STAFF_OFFLINE', 'OFFLINE')).toBe(true);
    expect(channelsMatch('PUBLIC_ONLINE', 'ONLINE_PORTAL')).toBe(true);
    expect(channelsMatch('STAFF_OFFLINE', 'ONLINE')).toBe(false);
    expect(channelsMatch('FAX', 'FAX')).toBe(false);
  });
});

describe('claim status → workflow step', () => {
  it('routes each working status to the step that owns it', () => {
    expect(stepForClaimStatus('SUBMITTED')).toEqual({ kind: 'STEP', step: 'INTAKE' });
    expect(stepForClaimStatus('ELIGIBILITY_CHECK')).toEqual({ kind: 'STEP', step: 'ELIGIBILITY' });
    expect(stepForClaimStatus('CALCULATION')).toEqual({ kind: 'STEP', step: 'CALCULATION' });
    expect(stepForClaimStatus('DECISION')).toEqual({ kind: 'STEP', step: 'DECISION' });
    expect(stepForClaimStatus('PAYMENT_QUEUE')).toEqual({ kind: 'STEP', step: 'PAYMENT' });
  });

  it('covers the legacy INTAKE status written by the intake RPC', () => {
    expect(stepForClaimStatus('INTAKE')).toEqual({ kind: 'STEP', step: 'INTAKE' });
  });

  it('holds paused claims in their current basket rather than unrouting them', () => {
    expect(stepForClaimStatus('PENDING_INFO').kind).toBe('HOLD');
    expect(stepForClaimStatus('SUSPENDED').kind).toBe('HOLD');
    expect(stepForClaimStatus('DRAFT').kind).toBe('HOLD');
  });

  it('closes the queue assignment for finished claims', () => {
    for (const s of ['CLOSED', 'DENIED', 'WITHDRAWN']) {
      expect(stepForClaimStatus(s).kind).toBe('TERMINAL');
    }
  });

  it('holds — never silently drops — an unmapped status', () => {
    const d = stepForClaimStatus('SOME_NEW_STATUS');
    expect(d.kind).toBe('HOLD');
    expect((d as any).reason).toContain('SOME_NEW_STATUS');
  });

  it('maps every status the claim vocabulary contains', () => {
    const known = mappedClaimStatuses();
    for (const s of [
      'DRAFT', 'SUBMITTED', 'INTAKE', 'INTAKE_REVIEW', 'ELIGIBILITY_CHECK',
      'EVIDENCE_REVIEW', 'CALCULATION', 'DECISION', 'APPROVED', 'AWARD_SETUP',
      'PAYMENT_QUEUE', 'IN_PAYMENT', 'SUSPENDED', 'CLOSED', 'PENDING_INFO',
      'WITHDRAWN', 'DENIED',
    ]) {
      expect(known).toContain(s);
    }
  });
});

describe('step → workbasket role', () => {
  it('translates generic template roles to BN basket roles', () => {
    expect(basketRoleForStepRole('CLERK')).toBe('BN_INTAKE_OFFICER');
    expect(basketRoleForStepRole('FINANCE')).toBe('BN_PAYMENT_OFFICER');
  });

  it('passes BN roles through untouched', () => {
    expect(basketRoleForStepRole('BN_SUPERVISOR')).toBe('BN_SUPERVISOR');
  });

  it('reports rather than approximates a role with no basket', () => {
    expect(basketRoleForStepRole('INSPECTOR')).toBeNull();
    expect(basketRoleForStepRole('MEDICAL_BOARD')).toBeNull();
    expect(basketRoleForStepRole('SYSTEM')).toBeNull();
  });

  it('knows an owner for every step a claim status can reach', () => {
    for (const status of mappedClaimStatuses()) {
      const d = stepForClaimStatus(status);
      if (d.kind === 'STEP') {
        expect(STEP_NAME_TO_BASKET_ROLE[d.step]).toBeTruthy();
      }
    }
  });
});

describe('steps_config parsing', () => {
  const bareArray = [
    { step: 'INTAKE', role: 'CLERK', sla_days: 3 },
    { step: 'DECISION', role: 'SUPERVISOR' },
  ];

  it('reads both the bare-array and { steps: [] } shapes seen in data', () => {
    expect(firstStep(bareArray)?.step).toBe('INTAKE');
    expect(firstStep({ steps: bareArray })?.step).toBe('INTAKE');
    expect(firstStep(null)).toBeNull();
    expect(firstStep([])).toBeNull();
  });

  it('finds a named step so a claim can move past intake', () => {
    expect(stepByName(bareArray, 'DECISION')?.role).toBe('SUPERVISOR');
    expect(stepByName({ steps: bareArray }, 'decision')?.role).toBe('SUPERVISOR');
    // Not declared by this template — the caller falls back to the step's
    // default owning role rather than stranding the claim at intake.
    expect(stepByName(bareArray, 'PAYMENT')).toBeNull();
  });
});
