/**
 * Omni-Comms — Email readiness STAGE grouping + credential-for-sending
 * classification.
 *
 * Pure projection tests. Nothing here contacts a provider or sends a message.
 */
import { describe, expect, it } from 'vitest';
import {
  projectEmailReadiness,
  type EmailReadinessProjection,
} from '@/platform/omni-comms/admin/views/channels/emailReadiness';
import { projectEmailGoLiveReadiness } from '@/platform/omni-comms/admin/views/channels/goLiveReadiness';
import {
  DELIVERY_SETUP_CHECK_KEYS,
  GO_LIVE_CHECK_KEYS,
  TEST_VERIFY_CHECK_KEYS,
  groupEmailReadinessByStage,
  stageForReadinessCheck,
} from '@/platform/omni-comms/admin/views/channels/readinessStages';
import type { EmailConfigSummary } from '@/platform/omni-comms/application/channelManagementTypes';

const account = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  code: 'resend_primary',
  display_name: 'Resend primary',
  status: 'active',
  data_origin: 'user',
  verification_status: 'unverified',
  verification_result_code: null,
  ...over,
});

const summary = (accounts: unknown[]): EmailConfigSummary =>
  ({
    provider: { code: 'resend', status: 'active' },
    provider_accounts: accounts,
    sender_identities: [],
    bindings: [],
    endpoints: [],
  } as unknown as EmailConfigSummary);

const credentialsCheck = (p: EmailReadinessProjection) =>
  p.checks.find((c) => c.key === 'credentials')!;

describe('Omni-Comms — Email readiness stage grouping', () => {
  it('still declares 21 checks in total across the three stages', () => {
    const total =
      DELIVERY_SETUP_CHECK_KEYS.length
      + TEST_VERIFY_CHECK_KEYS.length
      + GO_LIVE_CHECK_KEYS.length;
    expect(total).toBe(21);
    expect(DELIVERY_SETUP_CHECK_KEYS.length).toBe(11);
    expect(TEST_VERIFY_CHECK_KEYS.length).toBe(3);
    expect(GO_LIVE_CHECK_KEYS.length).toBe(7);
  });

  it('groups every projected readiness check into exactly one stage', () => {
    const readiness = projectEmailReadiness(summary([account()]));
    const keys = readiness.checks.map((c) => c.key);
    expect(keys).toHaveLength(21);
    const all = new Set<string>([
      ...DELIVERY_SETUP_CHECK_KEYS,
      ...TEST_VERIFY_CHECK_KEYS,
      ...GO_LIVE_CHECK_KEYS,
    ]);
    for (const key of keys) expect(all.has(key)).toBe(true);
    expect(all.size).toBe(21);
  });

  it('reports 11 / 3 / 7 stage totals', () => {
    const go = projectEmailGoLiveReadiness(projectEmailReadiness(summary([account()])));
    const grouped = groupEmailReadinessByStage(go);
    expect(grouped.deliverySetup.totalCount).toBe(11);
    expect(grouped.testVerify.totalCount).toBe(3);
    expect(grouped.goLive.totalCount).toBe(7);
  });

  it('routes unknown server blockers to Go Live, never Delivery Setup', () => {
    expect(stageForReadinessCheck('pilot_business_producer')).toBe('go-live');
    expect(stageForReadinessCheck('credentials')).toBe('delivery-setup');
    expect(stageForReadinessCheck('provider_delivery_test')).toBe('test-verify');
  });

  it('takes the Delivery Setup blocker from Delivery Setup checks only', () => {
    const go = projectEmailGoLiveReadiness(projectEmailReadiness(summary([account()])));
    const grouped = groupEmailReadinessByStage(go);
    expect(grouped.deliverySetup.blocker).not.toBeNull();
    expect(
      (DELIVERY_SETUP_CHECK_KEYS as readonly string[]).includes(
        grouped.deliverySetup.blocker!.key,
      ),
    ).toBe(true);
    expect(grouped.currentStage).toBe('delivery-setup');
    expect(grouped.currentBlocker!.key).toBe(grouped.deliverySetup.blocker!.key);
  });

  it('still exposes all downstream Go Live blockers', () => {
    const go = projectEmailGoLiveReadiness(projectEmailReadiness(summary([account()])));
    const grouped = groupEmailReadinessByStage(go);
    for (const key of GO_LIVE_CHECK_KEYS) {
      expect(grouped.goLive.items.some((i) => i.key === key)).toBe(true);
    }
    expect(grouped.goLive.readyCount).toBe(0);
  });

  it('keeps live delivery disabled and never enables it', () => {
    const go = projectEmailGoLiveReadiness(projectEmailReadiness(summary([account()])));
    expect(go.liveDeliveryAvailable).toBe(false);
  });
});

describe('Omni-Comms — credential-for-sending classification', () => {
  it('accepts a restricted Sending-access credential as ready for sending', () => {
    const p = projectEmailReadiness(
      summary([account({ verification_result_code: 'restricted_api_key' })]),
    );
    const check = credentialsCheck(p);
    expect(check.state).toBe('met');
    expect(check.detail).toContain('ready for sending');
    expect(check.detail).toContain('sending only');
    expect(check.detail.toLowerCase()).not.toContain('invalid');
    expect(check.detail.toLowerCase()).not.toContain('rejected');
  });

  it('never renders a restricted Sending-access credential as NOT VERIFIED', () => {
    const go = projectEmailGoLiveReadiness(
      projectEmailReadiness(
        summary([account({ verification_result_code: 'restricted_api_key' })]),
      ),
    );
    const item = go.items.find((i) => i.key === 'credentials')!;
    expect(item.status).toBe('READY');
    expect(item.nextAction).toBe('');
  });

  it('advances the Delivery Setup blocker past a valid restricted credential', () => {
    const grouped = groupEmailReadinessByStage(
      projectEmailGoLiveReadiness(
        projectEmailReadiness(
          summary([account({ verification_result_code: 'restricted_api_key' })]),
        ),
      ),
    );
    expect(grouped.deliverySetup.blocker!.key).not.toBe('credentials');
    expect(grouped.deliverySetup.blocker!.nextAction).not.toContain(
      'credential verification',
    );
  });

  it('accepts a fully verified credential', () => {
    const p = projectEmailReadiness(
      summary([account({ verification_status: 'verified' })]),
    );
    expect(credentialsCheck(p).state).toBe('met');
  });

  it('fails an invalid or rejected credential', () => {
    const p = projectEmailReadiness(
      summary([account({ verification_result_code: 'invalid_credentials' })]),
    );
    const check = credentialsCheck(p);
    expect(check.state).toBe('unmet');
    expect(check.detail).toContain('No account has a usable sending credential');
  });

  it('fails when no provider account or credential exists', () => {
    const p = projectEmailReadiness(summary([]));
    expect(credentialsCheck(p).state).toBe('unmet');
  });

  it('drops stale secret-reference wording from the credential next action', () => {
    const go = projectEmailGoLiveReadiness(projectEmailReadiness(summary([account()])));
    const item = go.items.find((i) => i.key === 'credentials')!;
    expect(item.nextAction).toBe(
      'Open the provider account to review or verify its sending credential.',
    );
    for (const i of go.items) {
      expect(i.nextAction).not.toContain('only its secret reference name is stored');
    }
  });
});
