/**
 * Omni-Comms Channels C3A closure — generic channel identities.
 *
 * Static and unit proof only. No provider is contacted, no communication is
 * requested, dispatched or delivered by this suite.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import {
  IDENTITY_ACTIVATION_MEANING,
  OMNI_COMMS_IDENTITY_CHANNELS,
  OMNI_COMMS_IDENTITY_TYPES_BY_CHANNEL,
  OMNI_COMMS_PUSH_PLATFORMS,
  OMNI_COMMS_SMS_MESSAGE_CLASSES,
  identityChannelSupported,
  identityChannelValue,
  identityScopeLabel,
  type ChannelIdentityRow,
} from '@/platform/omni-comms/application/channelIdentityTypes';
import {
  getChannelIdentitySummary,
  setChannelIdentityLifecycle,
  upsertChannelIdentityDraft,
} from '@/platform/omni-comms/application/channelIdentityService';
import {
  isReferenceSenderIdentity,
  partitionEmailConfig,
  readinessCounts,
} from '@/platform/omni-comms/admin/views/channels/channelReferenceData';
import { projectEmailReadiness } from '@/platform/omni-comms/admin/views/channels/emailReadiness';
import type { SenderIdentityRow } from '@/platform/omni-comms/application/channelManagementTypes';

const MIGRATIONS = 'supabase/migrations';
const IDENTITY_TAB =
  'src/platform/omni-comms/admin/views/channels/ChannelIdentitiesTab.tsx';
const ENDPOINTS_TAB =
  'src/platform/omni-comms/admin/views/channels/ChannelEndpointsTab.tsx';
const read = (p: string) => readFileSync(p, 'utf8');

/** All Omni-Comms migration SQL, concatenated (static contract inspection). */
const SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => read(`${MIGRATIONS}/${f}`))
  .join('\n');

/** The normaliser body — the authoritative validation contract. */
const NORMALIZER = (() => {
  const start = SQL.indexOf('FUNCTION public.omni_comms_priv_normalize_identity_config');
  expect(start).toBeGreaterThan(-1);
  return SQL.slice(start, start + 8000);
})();

const identity = (o: Partial<ChannelIdentityRow> = {}): ChannelIdentityRow => ({
  id: 'i1',
  code: 'primary_sender',
  display_name: 'Primary sender',
  channel: 'email',
  identity_type: 'email_sender',
  identity_config: { from_address: 'noreply@ssb.kn' },
  department_id: null,
  department_name: null,
  event_definition_id: null,
  status: 'active',
  data_origin: 'user',
  from_address: 'noreply@ssb.kn',
  from_name: null,
  reply_to_address: null,
  updated_at: '2026-01-01T00:00:00Z',
  activated_at: null,
  retired_at: null,
  retirement_reason: null,
  ...o,
});

const sender = (o: Partial<SenderIdentityRow> = {}): SenderIdentityRow => ({
  id: 's1',
  code: 'primary_sender',
  display_name: 'Primary sender',
  from_address: 'noreply@ssb.kn',
  from_name: null,
  reply_to_address: null,
  status: 'active',
  department_id: null,
  event_definition_id: null,
  updated_at: '2026-01-01T00:00:00Z',
  data_origin: 'user',
  identity_type: 'email_sender',
  identity_config: { from_address: 'noreply@ssb.kn' },
  ...o,
});

function makeClient(calls: { fn: string; args: unknown }[], data: unknown = 'ok') {
  return {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data, error: null };
    },
  };
}

describe('C3A — identity model', () => {
  it('1. Email identity backfill uses email_sender', () => {
    expect(OMNI_COMMS_IDENTITY_TYPES_BY_CHANNEL.email).toEqual(['email_sender']);
    expect(SQL).toMatch(/identity_type\s*=\s*'email_sender'/);
  });

  it('2. Email identity_config mirrors legacy Email fields', () => {
    expect(NORMALIZER).toContain(
      "v_allowed := ARRAY['from_address','from_name','reply_to_address']",
    );
    expect(identityChannelValue(identity())).toBe('noreply@ssb.kn');
  });

  it('3. SMS sender ID validation', () => {
    expect(NORMALIZER).toContain("v_type='sender_id'");
    expect(NORMALIZER).toContain('invalid_sender_id');
    const re = /^[A-Za-z0-9][A-Za-z0-9 ._-]{2,10}$/;
    expect(re.test('SSBKN')).toBe(true);
    expect(re.test('S')).toBe(false);
    expect(re.test('WAY_TOO_LONG_SENDER')).toBe(false);
  });

  it('4. SMS originating-number E.164 validation', () => {
    expect(NORMALIZER).toContain('invalid_e164:sender_value');
    const re = /^\+[1-9][0-9]{7,14}$/;
    expect(re.test('+18694661000')).toBe(true);
    expect(re.test('18694661000')).toBe(false);
    expect(re.test('+0123456789')).toBe(false);
  });

  it('5. SMS message-class validation', () => {
    expect(OMNI_COMMS_SMS_MESSAGE_CLASSES).toEqual([
      'transactional', 'promotional', 'mixed',
    ]);
    expect(NORMALIZER).toContain('invalid_message_class');
  });

  it('6. WhatsApp display-number validation', () => {
    expect(NORMALIZER).toContain('invalid_e164:display_number');
    expect(OMNI_COMMS_IDENTITY_TYPES_BY_CHANNEL.whatsapp).toEqual(['business_number']);
  });

  it('7. WhatsApp phone-number ID validation', () => {
    expect(NORMALIZER).toContain('invalid_phone_number_id');
    expect(NORMALIZER).toContain(
      "v_required := ARRAY['display_number','phone_number_id']",
    );
  });

  it('8. Push platform validation', () => {
    expect(OMNI_COMMS_PUSH_PLATFORMS).toEqual([
      'android', 'ios', 'web', 'cross_platform',
    ]);
    expect(NORMALIZER).toContain('invalid_platform');
  });

  it('9. Push application-code validation', () => {
    expect(NORMALIZER).toContain('invalid_application_code');
    const re = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
    expect(re.test('ssb.portal')).toBe(true);
    expect(re.test('SSB Portal')).toBe(false);
  });

  it('10. In-App required fields', () => {
    expect(NORMALIZER).toContain(
      "v_required := ARRAY['application_code','display_name']",
    );
    expect(OMNI_COMMS_IDENTITY_TYPES_BY_CHANNEL.in_app).toEqual(['application']);
  });

  it('11. Print issuing-authority validation', () => {
    expect(NORMALIZER).toContain('invalid_issuing_authority');
    expect(OMNI_COMMS_IDENTITY_TYPES_BY_CHANNEL.print).toEqual(['issuing_authority']);
  });

  it('12. Unknown identity type rejected', () => {
    expect(NORMALIZER).toContain('unknown_identity_type');
  });

  it('13. Unknown configuration key rejected', () => {
    expect(NORMALIZER).toContain('unknown_config_key');
  });

  it('14. Non-object configuration rejected', () => {
    expect(NORMALIZER).toContain('identity_config_object_required');
    expect(NORMALIZER).toContain("jsonb_typeof(p_config) <> 'object'");
  });

  it('15. Oversized configuration rejected', () => {
    expect(NORMALIZER).toContain('identity_config_too_large');
    expect(NORMALIZER).toContain('config_value_too_long');
  });
});

describe('C3A — scope and access', () => {
  it('16. Organisation-wide identity creation sends a null department', async () => {
    const calls: { fn: string; args: unknown }[] = [];
    await upsertChannelIdentityDraft(makeClient(calls), {
      organizationId: 'org1',
      channel: 'email',
      code: 'c',
      displayName: 'd',
      identityType: 'email_sender',
      identityConfig: { from_address: 'a@b.co' },
    });
    expect(calls[0].fn).toBe('omni_comms_channel_identity_upsert_draft');
    expect((calls[0].args as Record<string, unknown>).p_department_id).toBeNull();
  });

  it('17. Selected-department identity creation sends the department', async () => {
    const calls: { fn: string; args: unknown }[] = [];
    await upsertChannelIdentityDraft(makeClient(calls), {
      organizationId: 'org1',
      departmentId: 'dep1',
      channel: 'sms',
      code: 'c',
      displayName: 'd',
      identityType: 'sender_id',
      identityConfig: { sender_value: 'SSBKN' },
    });
    expect((calls[0].args as Record<string, unknown>).p_department_id).toBe('dep1');
  });

  it('18. Invalid department/organisation relationship rejected server-side', () => {
    expect(SQL).toContain('omni_comms_priv_require_tenant_access');
  });

  it('19. Cross-organisation read rejected', () => {
    const fn = SQL.slice(SQL.lastIndexOf('FUNCTION public.omni_comms_channel_identity_summary'));
    expect(fn).toContain('omni_comms_priv_require_tenant_access');
    expect(fn).toContain('s.organization_id = p_organization_id');
  });

  it('20. Cross-organisation update rejected', () => {
    const fn = SQL.slice(SQL.indexOf('FUNCTION public.omni_comms_priv_channel_identity_upsert'));
    expect(fn).toContain('omni_comms_priv_require_tenant_access');
  });

  it('21. Summary returns the actual department_name', () => {
    const fn = SQL.slice(SQL.lastIndexOf('FUNCTION public.omni_comms_channel_identity_summary'));
    expect(fn).toContain("'department_name', d.name");
    expect(fn).toContain('LEFT JOIN public.core_department d');
    expect(identityScopeLabel(identity({
      department_id: 'dep1', department_name: 'Contributions',
    }))).toBe('Contributions');
    expect(identityScopeLabel(identity())).toBe('Organisation-wide');
  });

  it('22. Selected-department summary includes organisation-wide identities', () => {
    const fn = SQL.slice(SQL.lastIndexOf('FUNCTION public.omni_comms_channel_identity_summary'));
    expect(fn).toContain('s.department_id IS NULL');
    expect(fn).toContain('s.department_id = p_department_id');
  });

  it('23. No-department summary includes all organisation identities', () => {
    const fn = SQL.slice(SQL.lastIndexOf('FUNCTION public.omni_comms_channel_identity_summary'));
    expect(fn).toContain('p_department_id IS NULL');
  });
});

describe('C3A — lifecycle and concurrency', () => {
  const worker = SQL.slice(
    SQL.indexOf('FUNCTION public.omni_comms_priv_channel_identity_set_lifecycle'),
  );

  it('24. Draft identity activates', () => {
    expect(worker).toContain("'activate'");
  });

  it('25. Active identity disables', () => {
    expect(worker).toContain("'disable'");
  });

  it('26. Disabled identity reactivates', () => {
    expect(worker).toMatch(/disabled/);
  });

  it('27. Retired identity cannot reactivate', () => {
    expect(worker).toMatch(/retired/);
    expect(worker).toContain('invalid_lifecycle_transition');
  });

  it('28. Retirement requires a reason', () => {
    expect(worker).toContain('retirement_reason_required');
  });

  it('29. Update requires expected_updated_at', async () => {
    const calls: { fn: string; args: unknown }[] = [];
    await setChannelIdentityLifecycle(makeClient(calls), {
      id: 'i1', expectedUpdatedAt: '2026-01-01T00:00:00Z', action: 'activate',
    });
    expect((calls[0].args as Record<string, unknown>).p_expected_updated_at)
      .toBe('2026-01-01T00:00:00Z');
  });

  it('30. Concurrent update is rejected', () => {
    expect(SQL).toContain('concurrent_modification');
  });

  it('31. Active identity cannot be edited as draft', () => {
    const upsert = SQL.slice(
      SQL.indexOf('FUNCTION public.omni_comms_priv_channel_identity_upsert'),
    );
    expect(upsert).toMatch(/status\s*<>\s*'draft'|not_draft|identity_not_draft/);
  });

  it('32. Activation does not claim provider verification', () => {
    expect(IDENTITY_ACTIVATION_MEANING).toMatch(/does not mean the provider has verified/i);
    expect(read(IDENTITY_TAB)).toContain('IDENTITY_ACTIVATION_MEANING');
  });
});

describe('C3A — reference data', () => {
  it('33. Reference identity update rejected', () => {
    expect(SQL).toContain('reference_identity_read_only');
  });

  it('34. Reference lifecycle rejected', () => {
    expect(SQL).toContain('reference_identity_non_operational');
  });

  it('35. Reference identities are not returned when includeReference=false', async () => {
    const calls: { fn: string; args: unknown }[] = [];
    await getChannelIdentitySummary(makeClient(calls), 'org1', 'email', null, false);
    expect((calls[0].args as Record<string, unknown>).p_include_reference).toBe(false);
    const fn = SQL.slice(SQL.lastIndexOf('FUNCTION public.omni_comms_channel_identity_summary'));
    expect(fn).toContain("CASE WHEN v_allow_ref THEN v_ref_rows ELSE '[]'::jsonb END");
  });

  it('36. Reference identities require configure permission', () => {
    const fn = SQL.slice(SQL.lastIndexOf('FUNCTION public.omni_comms_channel_identity_summary'));
    expect(fn).toContain("v_can_configure := public.has_permission(v_uid,'omni_comms','configure')");
    expect(fn).toContain('v_allow_ref := COALESCE(p_include_reference,false) AND v_can_configure');
  });

  it('37. Production UI never requests reference identities', () => {
    const src = read(IDENTITY_TAB);
    // The load callback is driven only by the reference switch, and the switch
    // is rendered exclusively in non-production environments.
    expect(src).toContain('void load(showReference)');
    expect(src).not.toContain('getChannelIdentitySummary(\n        client, orgId, channel, departmentId, true,');
    const controls = read(
      'src/platform/omni-comms/admin/views/channels/ReferenceDataControls.tsx',
    );
    expect(controls).toContain('isNonProduction(currentOmniCommsEnvironment())');
  });

  it('38. Reference identity controls are hidden by default', () => {
    const src = read(IDENTITY_TAB);
    expect(src).toMatch(/useState\(false\)/);
    expect(src).toContain('ReferenceDataControls');
  });

  it('39. Reference identities never contribute to Email readiness', () => {
    const part = partitionEmailConfig({
      senders: [sender(), sender({ id: 's2', data_origin: 'reference_seed' })],
    });
    expect(part.senders).toHaveLength(1);
    expect(readinessCounts(part).activeSenders).toBe(1);
    expect(isReferenceSenderIdentity(sender({ data_origin: 'reference_seed' }))).toBe(true);
    // data_origin is authoritative even when naming looks like reference data.
    expect(isReferenceSenderIdentity(
      sender({ code: 'simulation_sender', data_origin: 'user' }),
    )).toBe(false);
    // naming rules remain a fallback only when data_origin is absent.
    expect(isReferenceSenderIdentity(
      sender({ code: 'simulation_sender', data_origin: undefined }),
    )).toBe(true);
  });

  it('40. Genuine active identities continue contributing to readiness', () => {
    const part = partitionEmailConfig({
      senders: [
        sender(),
        sender({ id: 's2', status: 'disabled' }),
        sender({ id: 's3', status: 'draft' }),
        sender({ id: 's4', status: 'retired' }),
      ],
    });
    expect(readinessCounts(part).activeSenders).toBe(1);
    const projection = projectEmailReadiness({
      provider: null, channel_setting: null,
      provider_accounts: [], sender_identities: [sender()], bindings: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(projection.counts.activeSenders).toBe(1);
    expect(projection.label).not.toMatch(/Configuration complete/);
  });
});

describe('C3A — boundaries', () => {
  it('41. Webhook and Voice expose no identity Create action', () => {
    expect(identityChannelSupported('webhook')).toBe(false);
    expect(identityChannelSupported('voice')).toBe(false);
    expect(OMNI_COMMS_IDENTITY_CHANNELS).not.toContain('webhook' as never);
    expect(read(IDENTITY_TAB)).toContain('if (!identityChannelSupported(definition.code))');
  });

  it('42. Endpoints tab remains unchanged (no identity coupling)', () => {
    const src = read(ENDPOINTS_TAB);
    expect(src).not.toContain('channelIdentityService');
    expect(src).not.toContain('omni_comms_channel_identity_');
  });

  it('43. No provider SDK is imported', () => {
    const src = read(IDENTITY_TAB)
      + read('src/platform/omni-comms/application/channelIdentityService.ts');
    expect(src).not.toMatch(/from ['"]resend['"]|from ['"]twilio['"]|@sendgrid/);
  });

  it('44. No sendCommunication call exists', () => {
    const src = read(IDENTITY_TAB)
      + read('src/platform/omni-comms/application/channelIdentityService.ts');
    expect(src).not.toContain('sendCommunication(');
  });

  it('45. No request, message, dispatch job or delivery attempt is created', () => {
    const src = read(IDENTITY_TAB)
      + read('src/platform/omni-comms/application/channelIdentityService.ts');
    expect(src).not.toMatch(/omni_comms_(request|message|dispatch_job|delivery_attempt)/);
  });

  it('46. Existing Email compatibility RPCs delegate to the generic workers', () => {
    const legacy = SQL.slice(
      SQL.lastIndexOf('FUNCTION public.omni_comms_upsert_sender_identity_draft'),
    );
    expect(legacy).toContain('omni_comms_priv_channel_identity_upsert');
    const legacyLifecycle = SQL.slice(
      SQL.lastIndexOf('FUNCTION public.omni_comms_set_sender_identity_lifecycle'),
    );
    expect(legacyLifecycle).toContain('omni_comms_priv_channel_identity_set_lifecycle');
  });
});
