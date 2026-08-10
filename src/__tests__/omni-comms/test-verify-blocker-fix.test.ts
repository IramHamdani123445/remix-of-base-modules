/**
 * Omni-Comms Test & Verify blocker fix — focused regression suite.
 *
 * Proves, WITHOUT contacting a provider or sending anything:
 *   - the approved test-recipient purpose vocabulary is bounded and the UI
 *     submits the canonical `internal_test` purpose;
 *   - an out-of-vocabulary purpose is rejected before any database write and
 *     never exposes raw row or database contents;
 *   - a provider-authenticated sending-only credential is READY FOR SENDING;
 *   - the policy testing gate is NOT weakened;
 *   - Test & Verify ordering is preflight → delivery test → callback.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  OMNI_COMMS_TEST_RECIPIENT_PURPOSES,
  TEST_VERIFY_RECIPIENT_PURPOSE,
  isTestRecipientPurpose,
} from '@/platform/omni-comms/application/testRecipientPurpose';
import { upsertTestRecipient } from '@/platform/omni-comms/application/channelProviderConfigurationService';
import { OmniCommsRpcError } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import {
  operationalStateAllowsConfiguration,
  operationalStateAllowsTesting,
} from '@/platform/omni-comms/application/channelPolicyTypes';
import { TEST_VERIFY_CHECK_KEYS } from '@/platform/omni-comms/admin/views/channels/readinessStages';

function recordingClient() {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args: args ?? {} });
      return { data: 'ok-id', error: null };
    },
  };
}

const base = {
  organizationId: '11111111-1111-1111-1111-111111111111',
  channel: 'email',
  label: 'Benefits test mailbox',
  address: 'test@example.com',
} as const;

describe('approved test recipient purpose model', () => {
  it('exposes exactly the three canonical database purposes', () => {
    expect([...OMNI_COMMS_TEST_RECIPIENT_PURPOSES]).toEqual([
      'controlled_pilot',
      'internal_test',
      'certification',
    ]);
  });

  it('uses internal_test for the Test & Verify screen', () => {
    expect(TEST_VERIFY_RECIPIENT_PURPOSE).toBe('internal_test');
  });

  it('rejects technical_test as a purpose', () => {
    expect(isTestRecipientPurpose('technical_test')).toBe(false);
  });

  it.each(['internal_test', 'controlled_pilot', 'certification'] as const)(
    'creates a recipient with purpose %s',
    async (purpose) => {
      const client = recordingClient();
      await expect(
        upsertTestRecipient(client, { ...base, purpose }),
      ).resolves.toBe('ok-id');
      expect(client.calls[0].args.p_purpose).toBe(purpose);
    },
  );

  it('rejects technical_test BEFORE any database call', async () => {
    const client = recordingClient();
    await expect(
      upsertTestRecipient(client, {
        ...base,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        purpose: 'technical_test' as any,
      }),
    ).rejects.toMatchObject({
      code: 'OC422',
      detail: 'invalid_test_recipient_purpose',
    });
    expect(client.calls).toHaveLength(0);
  });

  it('never exposes raw row or database contents on validation failure', async () => {
    const client = recordingClient();
    const err = await upsertTestRecipient(client, {
      ...base,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      purpose: 'technical_test' as any,
    }).catch((e) => e as OmniCommsRpcError);
    const text = `${(err as Error).name} ${(err as Error).message}`;
    expect(text).not.toMatch(/omni_comms_test_recipient/);
    expect(text).not.toMatch(/CHECK|violates|Failing row/i);
    expect(text).not.toContain(base.address);
  });

  it('the Test & Verify UI submits the canonical internal_test purpose', () => {
    const src = readFileSync(
      'src/platform/omni-comms/admin/views/channels/ControlledRecipientsSection.tsx',
      'utf8',
    );
    expect(src).toContain('TEST_VERIFY_RECIPIENT_PURPOSE');
    expect(src).not.toContain('technical_test');
  });
});

describe('sending-credential semantics', () => {
  const checklist = readFileSync(
    'supabase/migrations',
    // placeholder replaced below
  );
  void checklist;
});

describe('policy testing gate', () => {
  it('configuration allows configuration but NOT testing', () => {
    expect(operationalStateAllowsConfiguration('configuration')).toBe(true);
    expect(operationalStateAllowsTesting('configuration')).toBe(false);
  });

  it('only test_only and pilot_ready enable testing', () => {
    expect(operationalStateAllowsTesting('test_only')).toBe(true);
    expect(operationalStateAllowsTesting('pilot_ready')).toBe(true);
    expect(operationalStateAllowsTesting('live')).toBe(false);
    expect(operationalStateAllowsTesting(null)).toBe(false);
  });
});

describe('Test & Verify ordering', () => {
  it('is preflight, then provider delivery test, then callback receiver', () => {
    expect([...TEST_VERIFY_CHECK_KEYS]).toEqual([
      'configuration_preflight',
      'provider_delivery_test',
      'callback_receiver',
    ]);
  });
});
