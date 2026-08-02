/**
 * Omni-Comms Channels C2 — generic provider accounts and multiple credential
 * references. Static and unit proof only; no provider is contacted.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  credentialCompleteness,
  credentialsComplete,
  NO_PROVIDER_ADAPTER_MESSAGE,
  OMNI_COMMS_ACCOUNT_ENVIRONMENTS,
  verificationImplemented,
  VERIFICATION_NOT_IMPLEMENTED_MESSAGE,
  type ChannelProviderAccountRow,
} from '@/platform/omni-comms/application/channelProviderAccountTypes';
import {
  getChannelProviderAccountSummary,
  setChannelProviderAccountLifecycle,
  upsertChannelProviderAccountDraft,
} from '@/platform/omni-comms/application/channelProviderAccountService';
import { isReferenceProviderAccount } from '@/platform/omni-comms/admin/views/channels/channelReferenceData';
import {
  OMNI_COMMS_OBJECT_REGISTRY,
} from '@/platform/omni-comms/registry/objectRegistry';
import { validateOmniCommsRegistries } from '@/platform/omni-comms/registry/validateRegistries';

const UI = 'src/platform/omni-comms/admin/views/channels/ChannelAccountsTab.tsx';
const SERVICE = 'src/platform/omni-comms/application/channelProviderAccountService.ts';
const read = (p: string) => readFileSync(p, 'utf8');

function makeClient(calls: { fn: string; args: unknown }[], data: unknown = 'ok') {
  return {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data, error: null };
    },
  };
}

const account = (o: Partial<ChannelProviderAccountRow> = {}): ChannelProviderAccountRow => ({
  id: 'a1',
  code: 'primary_email',
  display_name: 'Primary email',
  provider_id: 'p1',
  provider_adapter_key: 'resend',
  channel: 'email',
  environment: 'sandbox',
  region: null,
  provider_account_reference: null,
  status: 'draft',
  data_origin: 'user',
  health_state: 'unknown',
  health_checked_at: null,
  verification_status: 'unverified',
  verification_result_code: null,
  verification_detail: null,
  verification_checked_at: null,
  updated_at: '2026-01-01T00:00:00Z',
  secret_ref_purposes: [{ purpose: 'api_key', secret_ref: 'OMNI_COMMS_RESEND_PRIMARY' }],
  required_credential_count: 1,
  configured_credential_count: 1,
  ...o,
});

describe('C2 — generic account model', () => {
  it('supports three environments and reports credential completeness', () => {
    expect(OMNI_COMMS_ACCOUNT_ENVIRONMENTS).toEqual(['sandbox', 'staging', 'production']);
    expect(credentialCompleteness(account())).toBe('1 of 1 configured');
    expect(credentialsComplete(account())).toBe(true);
    expect(
      credentialsComplete(account({ configured_credential_count: 0 })),
    ).toBe(false);
  });

  it('offers verification only for adapters with a real verifier', () => {
    expect(verificationImplemented('resend')).toBe(true);
    expect(verificationImplemented('twilio')).toBe(false);
    expect(VERIFICATION_NOT_IMPLEMENTED_MESSAGE).toMatch(/not implemented/i);
  });

  it('classifies reference data by explicit data_origin', () => {
    expect(
      isReferenceProviderAccount({ code: 'genuine', data_origin: 'reference_seed' } as never),
    ).toBe(true);
    expect(
      isReferenceProviderAccount({ code: 'simulation_x', data_origin: 'user' } as never),
    ).toBe(false);
  });
});

describe('C2 — service calls only bounded generic RPCs', () => {
  it('summary, upsert and lifecycle map to the approved RPC names', async () => {
    const calls: { fn: string; args: unknown }[] = [];
    const client = makeClient(calls, { organization_id: 'o1' });
    await getChannelProviderAccountSummary(client, 'o1', 'email', true);
    await upsertChannelProviderAccountDraft(client, {
      organizationId: 'o1',
      channel: 'email',
      providerId: 'p1',
      code: 'primary_email',
      displayName: 'Primary email',
      environment: 'sandbox',
      secretRefs: [{ purpose: 'api_key', secretRef: 'OMNI_COMMS_RESEND_PRIMARY' }],
    });
    await setChannelProviderAccountLifecycle(client, {
      id: 'a1',
      expectedUpdatedAt: '2026-01-01T00:00:00Z',
      action: 'activate',
    });
    expect(calls.map((c) => c.fn)).toEqual([
      'omni_comms_channel_provider_account_summary',
      'omni_comms_channel_provider_account_upsert_draft',
      'omni_comms_channel_provider_account_set_lifecycle',
    ]);
    const upsertArgs = calls[1].args as Record<string, unknown>;
    expect(upsertArgs.p_secret_refs).toEqual([
      { purpose: 'api_key', secret_ref: 'OMNI_COMMS_RESEND_PRIMARY' },
    ]);
  });

  it('never imports the browser client or a provider SDK', () => {
    const src = read(SERVICE);
    expect(src).not.toContain('@/integrations/supabase/client');
    expect(src).not.toMatch(/from ['"]resend['"]/);
    expect(src).not.toMatch(/api\.resend\.com/);
  });
});

describe('C2 — Accounts UI safety', () => {
  const ui = read(UI);

  it('is provider-independent and truthful when no adapter is installed', () => {
    expect(ui).toContain('NO_PROVIDER_ADAPTER_MESSAGE');
    expect(NO_PROVIDER_ADAPTER_MESSAGE).toBe(
      'No provider adapter is installed for this channel.',
    );
    expect(ui).toContain('No account can be created here.');
  });

  it('never requests, stores or displays a credential value', () => {
    expect(ui).not.toMatch(/type=['"]password['"]/);
    expect(ui).not.toMatch(/\bapiKey\b\s*[:=]/);
    expect(ui).toContain('SECRET_REFERENCE_HELP');
  });

  it('cannot send, dispatch or contact a provider', () => {
    expect(ui).not.toContain('sendCommunication');
    expect(ui).not.toMatch(/api\.resend\.com/);
    expect(ui).not.toMatch(/from ['"]resend['"]/);
    expect(ui).toContain('Live delivery remains unavailable');
  });

  it('blocks activation until credentials are complete and verified', () => {
    expect(ui).toContain('!complete');
    expect(ui).toContain('account.verification_status !== "verified"');
    expect(ui).toContain('Manual health evidence is not authoritative');
  });
});

describe('C2 — registry authorisation', () => {
  it('registers both new objects before creation', () => {
    const names = OMNI_COMMS_OBJECT_REGISTRY.map((o) => o.name);
    expect(names).toContain('omni_comms_provider_credential_requirement');
    expect(names).toContain('omni_comms_provider_account_secret_ref');
    expect(validateOmniCommsRegistries().ok).toBe(true);
  });
});
