/**
 * Wave 4 / DEF-4 Part 3 — runtime dispatch authorisation guard.
 *
 * Proves that a dispatch job can only ever become runnable through the
 * fail-closed certification decision, and that every governance condition
 * denies independently with its own precise hold reason.
 */
import { describe, expect, it } from 'vitest';
import {
  CERTIFICATION_SAFE_ADAPTERS,
  EXTERNAL_CREDENTIAL_ADAPTERS,
  evaluateDispatchAuthorization,
  type DispatchAuthorizationContext,
} from '../../../supabase/functions/omni-comms-runtime/rendering/dispatchAuthorization.ts';
import {
  resolveDispatchState,
  resolveHoldReason,
} from '../../../supabase/functions/omni-comms-runtime/rendering/renderOrchestrator.ts';

const APPROVED = 'a'.repeat(40);
const OTHER_REVISION = 'b'.repeat(40);

function authorizedContext(
  overrides: Partial<DispatchAuthorizationContext> = {},
): DispatchAuthorizationContext {
  return {
    runtimeEnvironment: 'non_production',
    markerEnvironmentKind: 'TEST',
    markerAllowsControlledTestActivation: true,
    markerProjectRef: 'xynceskeiiisiefqlgxo',
    currentProjectRef: 'xynceskeiiisiefqlgxo',
    release: {
      release_state: 'controlled_pilot',
      release_expires_at: '2026-12-31T00:00:00Z',
      approved_commit: APPROVED,
      permitted_caller_modules: ['INTERNAL_AUDIT'],
      permitted_modes: ['queued'],
    },
    deployedRevision: APPROVED,
    callerModuleCode: 'INTERNAL_AUDIT',
    mode: 'queued',
    providerAdapterKey: 'simulation_email',
    recipientAllowlisted: true,
    dispatchCertifiedFrom: '2026-08-28T00:00:00Z',
    requestCreatedAt: '2026-08-28T10:00:00Z',
    quarantined: false,
    asOf: '2026-08-28T12:00:00Z',
    ...overrides,
  };
}

function reasonFor(overrides: Partial<DispatchAuthorizationContext>): string {
  const decision = evaluateDispatchAuthorization(authorizedContext(overrides));
  expect(decision.authorized).toBe(false);
  return decision.reason ?? '';
}

describe('evaluateDispatchAuthorization', () => {
  it('authorises TEST + controlled_pilot + simulation + allowlisted + current revision', () => {
    expect(evaluateDispatchAuthorization(authorizedContext())).toEqual({ authorized: true, reason: null });
  });

  it('holds in production', () => {
    expect(reasonFor({ runtimeEnvironment: 'production' })).toBe('environment_not_certified');
  });

  it('holds when the environment marker is not TEST or does not allow activation', () => {
    expect(reasonFor({ markerEnvironmentKind: 'PRODUCTION' })).toBe('environment_not_certified');
    expect(reasonFor({ markerAllowsControlledTestActivation: false })).toBe(
      'environment_not_certified',
    );
    expect(reasonFor({ markerAllowsControlledTestActivation: null })).toBe(
      'environment_not_certified',
    );
  });

  it('holds when the marker describes a different backend', () => {
    expect(reasonFor({ markerProjectRef: 'someotherproject' })).toBe('project_ref_mismatch');
    expect(reasonFor({ currentProjectRef: null })).toBe('project_ref_mismatch');
  });

  it('holds without a release, or outside controlled_pilot', () => {
    expect(reasonFor({ release: null })).toBe('release_control_missing');
    expect(
      reasonFor({
        release: { ...authorizedContext().release!, release_state: 'live' },
      }),
    ).toBe('release_not_controlled_pilot');
    expect(
      reasonFor({
        release: { ...authorizedContext().release!, release_state: 'suspended' },
      }),
    ).toBe('release_not_controlled_pilot');
  });

  it('holds an expired or never-expiring pilot', () => {
    expect(
      reasonFor({
        release: { ...authorizedContext().release!, release_expires_at: '2026-08-01T00:00:00Z' },
      }),
    ).toBe('pilot_expired');
    expect(
      reasonFor({
        release: { ...authorizedContext().release!, release_expires_at: null },
      }),
    ).toBe('pilot_expired');
  });

  it('holds when the deployed revision is not the approved revision', () => {
    expect(reasonFor({ deployedRevision: OTHER_REVISION })).toBe('runtime_revision_not_approved');
    expect(reasonFor({ deployedRevision: null })).toBe('runtime_revision_not_approved');
    // Prefix/short-SHA equality must never satisfy the guard.
    expect(reasonFor({ deployedRevision: APPROVED.slice(0, 12) })).toBe(
      'runtime_revision_not_approved',
    );
  });

  it('holds a module outside the pilot scope', () => {
    expect(reasonFor({ callerModuleCode: 'BENEFITS' })).toBe('module_not_in_pilot_scope');
    expect(reasonFor({ callerModuleCode: null })).toBe('module_not_in_pilot_scope');
  });

  it('holds any mode other than queued', () => {
    expect(reasonFor({ mode: 'shadow' })).toBe('mode_not_queued');
    expect(reasonFor({ mode: 'dry_run' })).toBe('mode_not_queued');
    expect(
      reasonFor({ release: { ...authorizedContext().release!, permitted_modes: ['live'] } }),
    ).toBe('mode_not_queued');
  });

  it('holds a non-allowlisted recipient', () => {
    expect(reasonFor({ recipientAllowlisted: false })).toBe('recipient_not_allowlisted');
    expect(reasonFor({ recipientAllowlisted: null })).toBe('recipient_not_allowlisted');
  });

  it('holds every external credential-bearing adapter without a governed approval', () => {
    for (const adapter of EXTERNAL_CREDENTIAL_ADAPTERS) {
      expect(reasonFor({ providerAdapterKey: adapter })).toBe('provider_not_certification_safe');
      expect(
        reasonFor({ providerAdapterKey: adapter, governedCertificationSafeAdapters: [] }),
      ).toBe('provider_not_certification_safe');
      expect(
        reasonFor({
          providerAdapterKey: adapter,
          governedCertificationSafeAdapters: ['some_other_adapter'],
        }),
      ).toBe('provider_not_certification_safe');
    }
  });

  it('authorises a credential-bearing adapter only when the governed registry approves it', () => {
    expect(
      evaluateDispatchAuthorization(
        authorizedContext({
          providerAdapterKey: 'resend',
          governedCertificationSafeAdapters: ['resend'],
        }),
      ),
    ).toEqual({ authorized: true, reason: null });
  });

  it('holds an unknown or missing adapter', () => {
    expect(reasonFor({ providerAdapterKey: 'brand_new_adapter' })).toBe(
      'provider_not_certification_safe',
    );
    expect(reasonFor({ providerAdapterKey: null })).toBe('provider_credentials_unavailable');
  });

  it('authorises credential-free certification adapters with no governed approval', () => {
    for (const adapter of CERTIFICATION_SAFE_ADAPTERS) {
      expect(evaluateDispatchAuthorization(authorizedContext({ providerAdapterKey: adapter })))
        .toEqual({ authorized: true, reason: null });
    }
    expect(CERTIFICATION_SAFE_ADAPTERS).not.toContain('resend');
    expect(CERTIFICATION_SAFE_ADAPTERS).not.toContain('twilio');
  });

  it('never releases historical or quarantined work', () => {
    expect(reasonFor({ requestCreatedAt: '2026-08-27T23:59:59Z' })).toBe(
      'historical_job_not_authorized',
    );
    expect(reasonFor({ requestCreatedAt: null })).toBe('historical_job_not_authorized');
    expect(reasonFor({ quarantined: true })).toBe('job_quarantined');
    expect(reasonFor({ dispatchCertifiedFrom: null })).toBe(
      'runtime_privileged_certification_pending',
    );
  });
});

describe('resolveDispatchState', () => {
  it('holds every leg when no authorisation context is supplied', () => {
    expect(resolveDispatchState('queued', [])).toEqual({
      runnable: false,
      holdReason: 'runtime_privileged_certification_pending',
    });
    expect(resolveHoldReason('queued', [])).toBe('runtime_privileged_certification_pending');
  });

  it('keeps resolution-time blockers ahead of governance reasons', () => {
    expect(
      resolveDispatchState('queued', ['provider_credentials_unavailable'], authorizedContext()),
    ).toEqual({ runnable: false, holdReason: 'provider_credentials_unavailable' });
    expect(resolveDispatchState('queued', ['sender_not_verified'], authorizedContext())).toEqual({
      runnable: false,
      holdReason: 'sender_not_verified',
    });
  });

  it('never makes a shadow-mode leg runnable', () => {
    expect(resolveDispatchState('shadow', [], authorizedContext())).toEqual({
      runnable: false,
      holdReason: 'shadow_mode',
    });
  });

  it('produces a runnable job only for a fully authorised leg', () => {
    expect(resolveDispatchState('queued', [], authorizedContext())).toEqual({
      runnable: true,
      holdReason: null,
    });
  });
});
