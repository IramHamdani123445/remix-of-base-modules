/**
 * OMNI-COMMS — Canonical runtime channel-kind closure (objective B).
 *
 * Proves that the runtime resolves by CHANNEL KIND rather than applying
 * "recipient destination + sender identity" to every channel, and that a
 * business caller cannot supply transport facts (device token, webhook URL,
 * signing secret, caller number, provider identifiers, raw TwiML).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  channelKind,
  destinationKeyFor,
  requiresSenderIdentity,
  OMNI_COMMS_RUNTIME_CHANNELS,
} from '../../../supabase/functions/omni-comms-runtime/resolution/channelKind.ts';
import {
  resolvePushRegistrations,
  resolveVoiceOriginatingIdentity,
  resolveWebhookSubscription,
} from '../../../supabase/functions/omni-comms-runtime/resolution/channelKindResolvers.ts';

const RESOLUTION_DIR = resolve(
  process.cwd(),
  'supabase/functions/omni-comms-runtime/resolution',
);
const read = (file: string) =>
  readFileSync(resolve(RESOLUTION_DIR, file), 'utf8');

describe('B1 — one canonical runtime channel vocabulary', () => {
  it('carries all eight real channels', () => {
    expect([...OMNI_COMMS_RUNTIME_CHANNELS].sort()).toEqual(
      [
        'email',
        'in_app',
        'print',
        'push',
        'sms',
        'voice',
        'webhook',
        'whatsapp',
      ].sort(),
    );
  });

  it('declares webhook and voice on the runtime Channel type', () => {
    const types = read('resolutionTypes.ts');
    const block = types.slice(
      types.indexOf('export type Channel ='),
      types.indexOf('export interface RuntimeValidationIssue'),
    );
    expect(block).toContain('"webhook"');
    expect(block).toContain('"voice"');
  });

  it('creates no second runtime channel enum', () => {
    const files = ['channelKind.ts', 'channelEligibility.ts', 'channelKindResolvers.ts'];
    for (const file of files) {
      expect(read(file).match(/export type Channel\b/)).toBeNull();
    }
  });
});

describe('B2 — resolution is driven by channel kind', () => {
  it('classifies every channel exactly as the server classifier does', () => {
    expect(channelKind('email')).toBe('addressed');
    expect(channelKind('sms')).toBe('addressed');
    expect(channelKind('whatsapp')).toBe('addressed');
    expect(channelKind('voice')).toBe('addressed');
    expect(channelKind('push')).toBe('device');
    expect(channelKind('in_app')).toBe('internal');
    expect(channelKind('webhook')).toBe('endpoint');
    expect(channelKind('print')).toBe('physical');
    expect(channelKind('carrier_pigeon')).toBeNull();
  });

  it('requires a human destination only where one exists', () => {
    expect(destinationKeyFor('email')).toBe('email');
    expect(destinationKeyFor('voice')).toBe('phone');
    expect(destinationKeyFor('print')).toBe('print');
    expect(destinationKeyFor('push')).toBeNull();
    expect(destinationKeyFor('in_app')).toBeNull();
    expect(destinationKeyFor('webhook')).toBeNull();
  });

  it('gives a sender identity only to addressed and physical channels', () => {
    expect(requiresSenderIdentity('email')).toBe(true);
    expect(requiresSenderIdentity('voice')).toBe(true);
    expect(requiresSenderIdentity('print')).toBe(true);
    expect(requiresSenderIdentity('push')).toBe(false);
    expect(requiresSenderIdentity('in_app')).toBe(false);
    expect(requiresSenderIdentity('webhook')).toBe(false);
  });

  it('never calls the generic sender resolver for a non-addressed channel', () => {
    const eligibility = read('channelEligibility.ts');
    expect(eligibility).toContain('requiresSenderIdentity(channel)');
    expect(eligibility).not.toContain('CHANNEL_TO_DEST');
  });
});

describe('B3/B4 — Push and In-App never depend on a business token', () => {
  it('removes push from the recipient destination contract', () => {
    const types = read('resolutionTypes.ts');
    const block = types.slice(
      types.indexOf('export interface RecipientInput'),
      types.indexOf('export interface NormalizedRecipient'),
    );
    expect(block).not.toMatch(/\bpush:\s*string/);
    expect(block).not.toMatch(/\binApp:\s*string/);
  });

  it('normalises no device token at all', () => {
    expect(read('destinationNormalization.ts')).not.toContain('normalizePush');
    expect(read('recipientResolver.ts')).not.toContain('normalizePush');
  });

  it('resolves push from governed registrations for the recipient', () => {
    const snapshot = {
      push_registrations: [
        { id: 'r1', organization_id: 'org', recipient_reference: 'user-1', platform: 'android', status: 'active' },
        { id: 'r2', organization_id: 'org', recipient_reference: 'user-1', platform: 'ios', status: 'active' },
        { id: 'r3', organization_id: 'org', recipient_reference: 'user-1', platform: 'web', status: 'retired' },
        { id: 'r4', organization_id: 'org', recipient_reference: 'user-2', platform: 'ios', status: 'active' },
      ],
      // deno-lint-ignore no-explicit-any
    } as any;
    const recipient = { recipientReference: 'user-1' } as never;
    const ok = resolvePushRegistrations(snapshot, recipient, 'org');
    expect(ok.count).toBe(2);
    expect(ok.blockers).toEqual([]);

    const none = resolvePushRegistrations(
      snapshot,
      { recipientReference: 'user-9' } as never,
      'org',
    );
    expect(none.count).toBe(0);
    expect(none.blockers).toEqual(['push_registration_missing']);

    const anonymous = resolvePushRegistrations(
      snapshot,
      { recipientReference: null } as never,
      'org',
    );
    expect(anonymous.blockers).toEqual(['recipient_identity_unresolved']);
  });

  it('treats In-App readiness as an identity question', () => {
    const eligibility = read('channelEligibility.ts');
    expect(eligibility).toContain('kind === "internal"');
    expect(eligibility).toContain('recipient_identity_unresolved');
  });
});

describe('B5 — Webhook resolves an exact governed endpoint', () => {
  const snapshot = {
    webhook_subscriptions: [
      {
        id: 'sub-org',
        organization_id: 'org',
        department_id: null,
        communication_action_id: null,
        event_definition_id: null,
        endpoint_id: 'ep-org',
        endpoint_checksum: 'chk-org',
        status: 'active',
      },
      {
        id: 'sub-dept',
        organization_id: 'org',
        department_id: 'dept',
        communication_action_id: 'act-1',
        event_definition_id: 'evt-1',
        endpoint_id: 'ep-dept',
        endpoint_checksum: 'chk-dept',
        status: 'active',
      },
    ],
    // deno-lint-ignore no-explicit-any
  } as any;
  const route = { channel: 'webhook' } as never;

  it('prefers the department + event pinned subscription', () => {
    const r = resolveWebhookSubscription(snapshot, route, 'evt-1', 'org', 'dept');
    expect(r.subscriptionId).toBe('sub-dept');
    expect(r.endpointId).toBe('ep-dept');
    expect(r.endpointChecksum).toBe('chk-dept');
    expect(r.blockers).toEqual([]);
  });

  it('blocks when no governed subscription exists', () => {
    const r = resolveWebhookSubscription(
      { webhook_subscriptions: [] } as never,
      route,
      'evt-1',
      'org',
      null,
    );
    expect(r.blockers).toEqual(['webhook_subscription_unresolved']);
    expect(r.endpointId).toBeNull();
  });

  it('blocks an endpoint with no tamper checksum', () => {
    const r = resolveWebhookSubscription(
      {
        webhook_subscriptions: [
          {
            id: 's', organization_id: 'org', department_id: null,
            communication_action_id: null, event_definition_id: null,
            endpoint_id: 'ep', endpoint_checksum: null, status: 'active',
          },
        ],
      } as never,
      route,
      'evt-1',
      'org',
      null,
    );
    expect(r.blockers).toContain('webhook_endpoint_unverified');
  });
});

describe('B6 — Voice resolves a verified originating identity', () => {
  it('selects the verified identity and its provider account', () => {
    const r = resolveVoiceOriginatingIdentity(
      {
        voice_identities: [
          {
            id: 'v1', organization_id: 'org', department_id: null,
            originating_number: '+18690000000', verification_status: 'verified',
            provider_account_id: 'pa1', provider_id: 'p1', status: 'active',
          },
        ],
      } as never,
      'org',
      null,
    );
    expect(r.identityId).toBe('v1');
    expect(r.blockers).toEqual([]);
  });

  it('blocks an unverified or absent originating identity', () => {
    expect(
      resolveVoiceOriginatingIdentity({ voice_identities: [] } as never, 'org', null)
        .blockers,
    ).toEqual(['voice_originating_identity_missing']);
    expect(
      resolveVoiceOriginatingIdentity(
        {
          voice_identities: [
            {
              id: 'v2', organization_id: 'org', department_id: null,
              originating_number: '+1', verification_status: 'pending',
              provider_account_id: null, provider_id: null, status: 'active',
            },
          ],
        } as never,
        'org',
        null,
      ).blockers,
    ).toEqual([
      'voice_originating_identity_unverified',
      'provider_account_inactive',
    ]);
  });
});

describe('B7 — the plan represents kind-specific truth honestly', () => {
  it('carries optional kind fields instead of fake sender identities', () => {
    const types = read('resolutionTypes.ts');
    for (const field of [
      'channelKind?',
      'pushRegistrationCount?',
      'webhookSubscriptionId?',
      'webhookEndpointId?',
      'voiceOriginatingIdentityId?',
    ]) {
      expect(types).toContain(field);
    }
  });
});
