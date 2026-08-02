/**
 * Omni-Comms Channels C4A — generic identity-to-provider bindings.
 *
 * Pure unit coverage for the binding DTO rules, readiness projection and the
 * service adapter's RPC contract. No provider API, SDK or network call.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BINDING_ACTIVATION_MEANING,
  BINDING_EXTERNAL_REF_PATTERN,
  BINDING_MANUAL_VERIFICATION_REMOVED_CODE,
  BINDING_PRIORITY_DEFAULT,
  BINDING_PRIORITY_MAX,
  BINDING_PRIORITY_MIN,
  BINDING_REFERENCE_NON_OPERATIONAL_CODE,
  BINDING_REFERENCE_READ_ONLY_CODE,
  BINDING_VERIFICATION_LABEL,
  BINDING_VERIFICATION_OWNERSHIP,
  BINDING_VERIFICATION_SOURCE_LABEL,
  bindingActivationBlockers,
  bindingEndpointLabel,
  bindingEndpointRequirement,
  bindingScopeLabel,
  isReferenceBindingRow,
  isValidBindingExternalRef,
  isValidBindingPriority,
  OMNI_COMMS_BINDING_ENDPOINT_REQUIREMENT,
  type BindingEndpointOption,
  type BindingIdentityOption,
  type BindingProviderAccountOption,
  type ChannelBindingRow,
} from '@/platform/omni-comms/application/channelBindingTypes';
import * as bindingService from '@/platform/omni-comms/application/channelBindingService';
import {
  partitionEmailConfig,
  readinessCounts,
} from '@/platform/omni-comms/admin/views/channels/channelReferenceData';
import type { BindingRow } from '@/platform/omni-comms/application/channelManagementTypes';

function bindingRow(over: Partial<ChannelBindingRow> = {}): ChannelBindingRow {
  return {
    id: 'b1',
    organization_id: 'org1',
    department_id: null,
    department_name: null,
    channel: 'email',
    sender_identity_id: 'i1',
    identity_code: 'notices',
    identity_display_name: 'Notices',
    identity_type: 'email_sender',
    identity_value: 'notices@ssb.kn',
    provider_account_id: 'a1',
    provider_account_code: 'resend_prod',
    provider_account_display_name: 'Resend production',
    adapter_key: 'resend',
    channel_endpoint_id: 'e1',
    endpoint_code: 'ssb_kn',
    endpoint_display_name: 'ssb.kn',
    endpoint_type: 'sending_domain',
    priority: 100,
    external_sender_ref: null,
    status: 'draft',
    data_origin: 'user',
    verification_status: 'unverified',
    verification_source: 'none',
    verification_result_code: null,
    verification_detail: null,
    verification_checked_at: null,
    verified_at: null,
    activated_at: null,
    disabled_at: null,
    retired_at: null,
    retirement_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const identity: BindingIdentityOption = {
  id: 'i1',
  code: 'notices',
  display_name: 'Notices',
  identity_type: 'email_sender',
  channel: 'email',
  identity_value: 'notices@ssb.kn',
  department_id: null,
  department_name: null,
  status: 'active',
  data_origin: 'user',
};

const account: BindingProviderAccountOption = {
  id: 'a1',
  code: 'resend_prod',
  display_name: 'Resend production',
  adapter_key: 'resend',
  environment: 'production',
  status: 'active',
  verification_status: 'verified',
  data_origin: 'user',
};

const endpoint: BindingEndpointOption = {
  id: 'e1',
  code: 'ssb_kn',
  display_name: 'ssb.kn',
  endpoint_type: 'sending_domain',
  provider_account_id: 'a1',
  endpoint_config: {},
  department_id: null,
  department_name: null,
  status: 'active',
  verification_status: 'verified',
  data_origin: 'user',
};

function legacyBinding(over: Partial<BindingRow> = {}): BindingRow {
  return {
    id: 'lb1',
    sender_identity_id: 'i1',
    provider_account_id: 'a1',
    priority: 100,
    external_sender_ref: null,
    verification_status: 'unverified',
    verified_at: null,
    status: 'active',
    updated_at: '2026-01-01T00:00:00Z',
    data_origin: 'user',
    verification_source: 'none',
    ...over,
  };
}

describe('C4A — endpoint requirement per channel', () => {
  it('requires an endpoint for email', () => {
    expect(bindingEndpointRequirement('email')).toBe('required');
  });

  it('treats an SMS endpoint as optional', () => {
    expect(bindingEndpointRequirement('sms')).toBe('optional');
  });

  it('forbids an endpoint for push', () => {
    expect(bindingEndpointRequirement('push')).toBe('forbidden');
  });

  it('requires an endpoint for whatsapp, in_app and print', () => {
    expect(bindingEndpointRequirement('whatsapp')).toBe('required');
    expect(bindingEndpointRequirement('in_app')).toBe('required');
    expect(bindingEndpointRequirement('print')).toBe('required');
  });

  it('covers every supported identity channel', () => {
    expect(Object.keys(OMNI_COMMS_BINDING_ENDPOINT_REQUIREMENT).sort()).toEqual(
      ['email', 'in_app', 'print', 'push', 'sms', 'whatsapp'],
    );
  });

  it('falls back to forbidden for an unknown channel', () => {
    expect(
      bindingEndpointRequirement('voice' as never),
    ).toBe('forbidden');
  });
});

describe('C4A — priority bounds', () => {
  it('accepts the documented default', () => {
    expect(isValidBindingPriority(BINDING_PRIORITY_DEFAULT)).toBe(true);
  });

  it('accepts both bounds', () => {
    expect(isValidBindingPriority(BINDING_PRIORITY_MIN)).toBe(true);
    expect(isValidBindingPriority(BINDING_PRIORITY_MAX)).toBe(true);
  });

  it('rejects zero and negative priorities', () => {
    expect(isValidBindingPriority(0)).toBe(false);
    expect(isValidBindingPriority(-1)).toBe(false);
  });

  it('rejects an out-of-range priority', () => {
    expect(isValidBindingPriority(BINDING_PRIORITY_MAX + 1)).toBe(false);
  });

  it('rejects a non-integer priority', () => {
    expect(isValidBindingPriority(10.5)).toBe(false);
    expect(isValidBindingPriority(Number.NaN)).toBe(false);
  });
});

describe('C4A — external sender reference shape', () => {
  it('accepts a plain provider reference', () => {
    expect(isValidBindingExternalRef('resend-sender-01')).toBe(true);
  });

  it('accepts an address-like reference', () => {
    expect(isValidBindingExternalRef('notices@ssb.kn')).toBe(true);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(isValidBindingExternalRef('  resend-sender-01  ')).toBe(true);
  });

  it('rejects an empty reference', () => {
    expect(isValidBindingExternalRef('   ')).toBe(false);
  });

  it('rejects a leading punctuation character', () => {
    expect(isValidBindingExternalRef('-bad')).toBe(false);
  });

  it('rejects an over-long reference', () => {
    expect(isValidBindingExternalRef('a'.repeat(129))).toBe(false);
  });

  it('rejects control and quoting characters', () => {
    expect(isValidBindingExternalRef('bad"ref')).toBe(false);
    expect(isValidBindingExternalRef('bad\nref')).toBe(false);
  });

  it('anchors the pattern at both ends', () => {
    expect(BINDING_EXTERNAL_REF_PATTERN.source.startsWith('^')).toBe(true);
    expect(BINDING_EXTERNAL_REF_PATTERN.source.endsWith('$')).toBe(true);
  });
});

describe('C4A — reference bindings', () => {
  it('classifies from the explicit data origin', () => {
    expect(isReferenceBindingRow(bindingRow({ data_origin: 'reference_seed' }))).toBe(true);
  });

  it('does not treat a user binding as reference data', () => {
    expect(isReferenceBindingRow(bindingRow())).toBe(false);
  });

  it('does not treat a system seed binding as reference data', () => {
    expect(isReferenceBindingRow(bindingRow({ data_origin: 'system_seed' }))).toBe(false);
  });

  it('never allows a reference binding to be activated', () => {
    const blockers = bindingActivationBlockers(
      bindingRow({ data_origin: 'reference_seed' }),
      identity,
      account,
      endpoint,
    );
    expect(blockers).toEqual(['Reference bindings are never operational.']);
  });

  it('exposes the server guard slugs', () => {
    expect(BINDING_REFERENCE_READ_ONLY_CODE).toBe('reference_binding_read_only');
    expect(BINDING_REFERENCE_NON_OPERATIONAL_CODE).toBe(
      'reference_binding_non_operational',
    );
  });
});

describe('C4A — activation blockers', () => {
  it('reports no blocker for a complete draft', () => {
    expect(bindingActivationBlockers(bindingRow(), identity, account, endpoint)).toEqual([]);
  });

  it('blocks an already active binding', () => {
    const blockers = bindingActivationBlockers(
      bindingRow({ status: 'active' }), identity, account, endpoint,
    );
    expect(blockers).toContain('Binding is already active.');
  });

  it('blocks a retired binding', () => {
    const blockers = bindingActivationBlockers(
      bindingRow({ status: 'retired' }), identity, account, endpoint,
    );
    expect(blockers).toContain('Binding is retired.');
  });

  it('blocks an inactive identity', () => {
    const blockers = bindingActivationBlockers(
      bindingRow(), { ...identity, status: 'draft' }, account, endpoint,
    );
    expect(blockers).toContain('Channel identity is not active.');
  });

  it('blocks an inactive provider account', () => {
    const blockers = bindingActivationBlockers(
      bindingRow(), identity, { ...account, status: 'disabled' }, endpoint,
    );
    expect(blockers).toContain('Provider account is not active.');
  });

  it('blocks an inactive endpoint', () => {
    const blockers = bindingActivationBlockers(
      bindingRow(), identity, account, { ...endpoint, status: 'draft' },
    );
    expect(blockers).toContain('Channel endpoint is not active.');
  });

  it('blocks a required-endpoint channel with no endpoint', () => {
    const blockers = bindingActivationBlockers(
      bindingRow({ channel_endpoint_id: null }), identity, account, undefined,
    );
    expect(blockers).toContain('A channel endpoint is required for this channel.');
  });

  it('allows a push binding with no endpoint', () => {
    const blockers = bindingActivationBlockers(
      bindingRow({ channel: 'push', channel_endpoint_id: null }),
      { ...identity, channel: 'push' }, account, undefined,
    );
    expect(blockers).toEqual([]);
  });

  it('never treats provider verification as an activation prerequisite', () => {
    const blockers = bindingActivationBlockers(
      bindingRow({ verification_status: 'unverified' }), identity, account, endpoint,
    );
    expect(blockers).toEqual([]);
  });
});

describe('C4A — verification is provider-owned', () => {
  it('states that an administrator can never set verification', () => {
    expect(BINDING_VERIFICATION_OWNERSHIP).toMatch(/cannot be set by an administrator/i);
  });

  it('states that activation is not verification and does not enable sending', () => {
    expect(BINDING_ACTIVATION_MEANING).toMatch(/does not mean the provider has verified/i);
    expect(BINDING_ACTIVATION_MEANING).toMatch(/does not enable sending/i);
  });

  it('labels every verification status without claiming send capability', () => {
    expect(Object.keys(BINDING_VERIFICATION_LABEL).sort()).toEqual(
      ['failed', 'pending', 'unverified', 'verified'],
    );
    for (const label of Object.values(BINDING_VERIFICATION_LABEL)) {
      expect(label.toLowerCase()).not.toContain('ready to send');
    }
  });

  it('labels every verification source, including legacy manual evidence', () => {
    expect(Object.keys(BINDING_VERIFICATION_SOURCE_LABEL).sort()).toEqual(
      ['legacy_manual', 'none', 'provider', 'service'],
    );
    expect(BINDING_VERIFICATION_SOURCE_LABEL.legacy_manual).toMatch(/legacy/i);
  });

  it('exposes the removed-manual-verification slug', () => {
    expect(BINDING_MANUAL_VERIFICATION_REMOVED_CODE).toBe(
      'manual_binding_verification_removed',
    );
  });

  it('exposes no administrator verification function on the service adapter', () => {
    const exported = Object.keys(bindingService);
    expect(exported.some((k) => /verification/i.test(k))).toBe(false);
    expect(exported.sort()).toEqual([
      'getChannelBindingSummary',
      'setChannelBindingLifecycle',
      'upsertChannelBindingDraft',
    ]);
  });
});

describe('C4A — scope and endpoint labels', () => {
  it('labels an organisation-wide binding', () => {
    expect(bindingScopeLabel(bindingRow())).toBe('Organisation-wide');
  });

  it('labels a departmental binding with the resolved name', () => {
    expect(
      bindingScopeLabel(bindingRow({ department_id: 'd1', department_name: 'Benefits' })),
    ).toBe('Benefits');
  });

  it('falls back to a generic department label when the name is missing', () => {
    expect(
      bindingScopeLabel(bindingRow({ department_id: 'd1', department_name: '  ' })),
    ).toBe('Department');
  });

  it('shows a dash when no endpoint is bound', () => {
    expect(bindingEndpointLabel(bindingRow({ channel_endpoint_id: null }))).toBe('—');
  });

  it('prefers the endpoint display name', () => {
    expect(bindingEndpointLabel(bindingRow())).toBe('ssb.kn');
  });

  it('falls back to the endpoint code', () => {
    expect(
      bindingEndpointLabel(bindingRow({ endpoint_display_name: null })),
    ).toBe('ssb_kn');
  });
});

describe('C4A — service adapter RPC contract', () => {
  function client(data: unknown) {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    return { client: { rpc }, rpc };
  }

  it('requests the summary without reference data by default', async () => {
    const { client: c, rpc } = client({ bindings: [] });
    await bindingService.getChannelBindingSummary(c, 'org1', 'email');
    expect(rpc).toHaveBeenCalledWith('omni_comms_channel_binding_summary', {
      p_organization_id: 'org1',
      p_department_id: null,
      p_channel: 'email',
      p_include_reference: false,
    });
  });

  it('requests reference data only when explicitly asked', async () => {
    const { client: c, rpc } = client({ bindings: [] });
    await bindingService.getChannelBindingSummary(c, 'org1', 'sms', 'd1', true);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_department_id: 'd1',
      p_include_reference: true,
    });
  });

  it('sends a full draft payload on upsert', async () => {
    const { client: c, rpc } = client('b1');
    await bindingService.upsertChannelBindingDraft(c, {
      organizationId: 'org1',
      channel: 'email',
      senderIdentityId: 'i1',
      providerAccountId: 'a1',
      channelEndpointId: 'e1',
      priority: 100,
    });
    expect(rpc).toHaveBeenCalledWith('omni_comms_channel_binding_upsert_draft',
      expect.objectContaining({
        p_id: null,
        p_expected_updated_at: null,
        p_organization_id: 'org1',
        p_channel: 'email',
        p_sender_identity_id: 'i1',
        p_provider_account_id: 'a1',
        p_channel_endpoint_id: 'e1',
        p_priority: 100,
      }));
  });

  it('passes the optimistic-locking token on lifecycle changes', async () => {
    const { client: c, rpc } = client('b1');
    await bindingService.setChannelBindingLifecycle(c, {
      id: 'b1',
      expectedUpdatedAt: '2026-01-01T00:00:00Z',
      action: 'retire',
      reason: 'Provider decommissioned',
    });
    expect(rpc).toHaveBeenCalledWith('omni_comms_channel_binding_set_lifecycle',
      expect.objectContaining({
        p_id: 'b1',
        p_expected_updated_at: '2026-01-01T00:00:00Z',
        p_action: 'retire',
        p_reason: 'Provider decommissioned',
      }));
  });
});

describe('C4A — Email readiness uses authoritative binding classification', () => {
  it('excludes a reference binding by explicit data origin', () => {
    const part = partitionEmailConfig({
      bindings: [legacyBinding({ id: 'r1', data_origin: 'reference_seed' })],
    });
    expect(part.bindings).toHaveLength(0);
    expect(part.referenceBindings).toHaveLength(1);
    expect(part.hasReferenceData).toBe(true);
  });

  it('keeps a genuine binding whose identity is reference-named but user-classified', () => {
    const part = partitionEmailConfig({
      bindings: [legacyBinding({ data_origin: 'user' })],
    });
    expect(part.bindings).toHaveLength(1);
  });

  it('counts active bindings separately from verified ones', () => {
    const counts = readinessCounts(partitionEmailConfig({
      bindings: [
        legacyBinding({ id: 'b1' }),
        legacyBinding({
          id: 'b2',
          verification_status: 'verified',
          verification_source: 'provider',
        }),
      ],
    }));
    expect(counts.activeBindings).toBe(2);
    expect(counts.providerVerifiedBindings).toBe(1);
  });

  it('does not count legacy manual evidence as provider verification', () => {
    const counts = readinessCounts(partitionEmailConfig({
      bindings: [legacyBinding({
        verification_status: 'verified',
        verification_source: 'legacy_manual',
      })],
    }));
    expect(counts.activeVerifiedBindings).toBe(1);
    expect(counts.providerVerifiedBindings).toBe(0);
  });

  it('counts trusted-service evidence as provider-grade verification', () => {
    const counts = readinessCounts(partitionEmailConfig({
      bindings: [legacyBinding({
        verification_status: 'verified',
        verification_source: 'service',
      })],
    }));
    expect(counts.providerVerifiedBindings).toBe(1);
  });

  it('ignores a disabled binding for every readiness count', () => {
    const counts = readinessCounts(partitionEmailConfig({
      bindings: [legacyBinding({
        status: 'disabled',
        verification_status: 'verified',
        verification_source: 'provider',
      })],
    }));
    expect(counts.activeBindings).toBe(0);
    expect(counts.providerVerifiedBindings).toBe(0);
  });
});
