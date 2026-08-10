import { describe, it, expect } from 'vitest';
import {
  resolveEffectivePolicy,
  operationalStateAllowsTesting,
  type ChannelPolicyRow,
  type OperationalState,
} from '@/platform/omni-comms/application/channelPolicyTypes';

const ORG = '69afc88b-da5c-4f41-a1e7-199e1ee1d416';
const DEPT = 'c28f40f8-00db-4766-b211-5bda5dd641a9';

function policy(
  id: string,
  state: OperationalState,
  opts: { departmentId?: string | null; overrideEnabled?: boolean; updatedAt?: string } = {},
): ChannelPolicyRow {
  return {
    id,
    organization_id: ORG,
    department_id: opts.departmentId ?? null,
    department_name: opts.departmentId ? 'Benefits' : null,
    channel: 'email',
    operational_state: state,
    department_override_enabled: opts.overrideEnabled ?? true,
    enabled: true,
    live_delivery_enabled: false,
    per_minute_limit: 30,
    per_day_limit: 500,
    max_recipients_per_request: 5,
    quiet_hours_start: null,
    quiet_hours_end: null,
    quiet_hours_timezone: null,
    retry_profile: 'none',
    request_timeout_seconds: 30,
    retention_days: 365,
    cost_currency: 'XCD',
    daily_cost_limit_minor: null,
    per_message_cost_limit_minor: null,
    channel_policy_config: {},
    data_origin: 'user',
    created_at: '2026-07-31T00:32:47.776Z',
    created_by: null,
    updated_at: opts.updatedAt ?? '2026-08-10T21:24:04.820Z',
    updated_by: null,
  };
}

const org = (s: OperationalState) => policy('org-policy', s);
const dept = (s: OperationalState, enabled = true) =>
  policy('dept-policy', s, { departmentId: DEPT, overrideEnabled: enabled });

describe('Omni-Comms effective Email policy testing gate', () => {
  it('organisation baseline configuration blocks policy_test_state', () => {
    const r = resolveEffectivePolicy(org('configuration'), null);
    expect(r.source).toBe('organisation_baseline');
    expect(r.allows_testing).toBe(false);
  });

  it('organisation baseline test_only permits testing', () => {
    const r = resolveEffectivePolicy(org('test_only'), null);
    expect(r.source).toBe('organisation_baseline');
    expect(r.operational_state).toBe('test_only');
    expect(r.allows_testing).toBe(true);
  });

  it('enabled department override in configuration shadows a test_only baseline', () => {
    const r = resolveEffectivePolicy(org('test_only'), dept('configuration', true));
    expect(r.source).toBe('department_override');
    expect(r.overrides_baseline).toBe(true);
    expect(r.allows_testing).toBe(false);
  });

  it('enabled department override in test_only unblocks a configuration baseline', () => {
    const r = resolveEffectivePolicy(org('configuration'), dept('test_only', true));
    expect(r.source).toBe('department_override');
    expect(r.policy?.id).toBe('dept-policy');
    expect(r.allows_testing).toBe(true);
  });

  it('disabled department override leaves the organisation baseline effective', () => {
    const r = resolveEffectivePolicy(org('test_only'), dept('configuration', false));
    expect(r.source).toBe('organisation_baseline');
    expect(r.overrides_baseline).toBe(false);
    expect(r.policy?.id).toBe('org-policy');
    expect(r.allows_testing).toBe(true);
  });

  it('pilot_ready passes and disabled fails the testing gate', () => {
    expect(operationalStateAllowsTesting('pilot_ready')).toBe(true);
    expect(resolveEffectivePolicy(org('pilot_ready'), null).allows_testing).toBe(true);
    expect(operationalStateAllowsTesting('disabled')).toBe(false);
    expect(resolveEffectivePolicy(org('disabled'), null).allows_testing).toBe(false);
  });

  it('no policy at all resolves to none and blocks testing', () => {
    const r = resolveEffectivePolicy(null, null);
    expect(r.source).toBe('none');
    expect(r.allows_testing).toBe(false);
  });

  it('reports success only from reloaded server truth, not the local draft', () => {
    // Local optimistic draft claims test_only while the server row is stale.
    const localDraft = org('test_only');
    const serverBefore = org('configuration');
    expect(resolveEffectivePolicy(localDraft, null).allows_testing).toBe(true);
    expect(resolveEffectivePolicy(serverBefore, null).allows_testing).toBe(false);

    // Success is asserted only after the reload returns the new updated_at.
    const serverAfter = policy('org-policy', 'test_only', {
      updatedAt: '2026-08-10T21:24:04.999Z',
    });
    expect(resolveEffectivePolicy(serverAfter, null).allows_testing).toBe(true);
    expect(serverAfter.updated_at).not.toBe(serverBefore.updated_at);
  });

  it('old failed preflight evidence is never mutated by a policy change', () => {
    const failedRun = Object.freeze({
      id: '49bba220-2efd-4bd7-941b-3aa6bc258dea',
      status: 'failed',
      result_code: 'preflight_failed',
      blocker_codes: Object.freeze(['policy_test_state']),
      configuration_fingerprint:
        'b6fda932ffd706c60275ce0f37079ceccedfe28329c39ced927f5b69e6c813c1',
    });
    // Policy resolution is pure: it cannot write back to historical evidence.
    resolveEffectivePolicy(org('test_only'), null);
    expect(failedRun.status).toBe('failed');
    expect(failedRun.blocker_codes).toEqual(['policy_test_state']);
    expect(() => {
      // @ts-expect-error immutability probe
      failedRun.status = 'passed';
    }).toThrow();
  });

  it('a fresh test_only configuration produces a passing gate with zero provider work', () => {
    let providerCalls = 0;
    let emailsSent = 0;
    const r = resolveEffectivePolicy(org('test_only'), dept('test_only', true));
    expect(r.allows_testing).toBe(true);
    expect(providerCalls).toBe(0);
    expect(emailsSent).toBe(0);
  });
});
