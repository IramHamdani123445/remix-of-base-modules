/**
 * Omni-Comms C2.1 — provider administration surface.
 * Static and unit proof only; no provider is contacted.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  adapterDeliveryImplemented,
  adaptersForChannel,
  findAdapter,
  NO_DELIVERY_ADAPTER_MESSAGE,
  OMNI_COMMS_PROVIDER_ADAPTERS,
  providerRegistrationSupported,
} from '@/platform/omni-comms/domain/providerAdapterCatalogue';
import {
  getChannelProviderAdminSummary,
  setChannelProviderLifecycle,
  upsertChannelProviderDraft,
} from '@/platform/omni-comms/application/channelProviderAdminService';
import {
  getChannelDescriptor,
  OMNI_COMMS_GENERIC_TABS,
} from '@/platform/omni-comms/domain/channelCatalogue';
import { CHANNEL_WORKSPACE_TAB_LABELS } from '@/platform/omni-comms/admin/views/channels/channelUiRegistry';

const UI = 'src/platform/omni-comms/admin/views/channels/ChannelProvidersTab.tsx';
const SERVICE = 'src/platform/omni-comms/application/channelProviderAdminService.ts';
const read = (p: string) => readFileSync(p, 'utf8');

function makeClient(calls: { fn: string; args: unknown }[]) {
  return {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: 'ok', error: null };
    },
  };
}

describe('C2.1 — adapter catalogue', () => {
  it('is truthful about which adapters can deliver', () => {
    expect(adapterDeliveryImplemented('resend')).toBe(true);
    expect(adapterDeliveryImplemented('twilio')).toBe(false);
    expect(OMNI_COMMS_PROVIDER_ADAPTERS.filter((a) => a.deliveryImplemented))
      .toHaveLength(1);
    expect(NO_DELIVERY_ADAPTER_MESSAGE).toMatch(/no delivery adapter is installed/i);
  });

  it('offers at least one adapter for every schema-supported channel', () => {
    for (const c of ['email', 'sms', 'whatsapp', 'push', 'in_app', 'print'] as const) {
      expect(providerRegistrationSupported(c)).toBe(true);
      expect(adaptersForChannel(c).length).toBeGreaterThan(0);
    }
    expect(providerRegistrationSupported('webhook')).toBe(false);
    expect(providerRegistrationSupported('voice')).toBe(false);
  });

  it('declares only secret reference patterns, never values', () => {
    for (const a of OMNI_COMMS_PROVIDER_ADAPTERS) {
      for (const c of a.credentials) {
        expect(c.secretRefPattern.startsWith('^OMNI_COMMS_')).toBe(true);
      }
    }
    expect(findAdapter('resend')?.credentials[0].purpose).toBe('api_key');
  });
});

describe('C2.1 — service calls only bounded RPCs', () => {
  it('maps summary, upsert and lifecycle to the approved RPC names', async () => {
    const calls: { fn: string; args: unknown }[] = [];
    const client = makeClient(calls);
    await getChannelProviderAdminSummary(client, 'sms', true);
    await upsertChannelProviderDraft(client, {
      channel: 'sms',
      code: 'local_gateway',
      displayName: 'Local gateway',
      adapterKey: 'sms_gateway',
      credentialRequirements: [
        {
          purpose: 'api_key',
          displayName: 'Gateway key',
          required: true,
          secretRefPattern: '^OMNI_COMMS_SMS_GATEWAY_[A-Z0-9_]+$',
        },
      ],
    });
    await setChannelProviderLifecycle(client, {
      id: 'p1', expectedUpdatedAt: '2026-01-01T00:00:00Z', action: 'activate',
    });
    expect(calls.map((c) => c.fn)).toEqual([
      'omni_comms_channel_provider_admin_summary',
      'omni_comms_channel_provider_upsert_draft',
      'omni_comms_channel_provider_set_lifecycle',
    ]);
    const args = calls[1].args as Record<string, unknown>;
    expect(args.p_credential_requirements).toEqual([
      {
        purpose: 'api_key',
        display_name: 'Gateway key',
        description: null,
        required: true,
        secret_ref_pattern: '^OMNI_COMMS_SMS_GATEWAY_[A-Z0-9_]+$',
      },
    ]);
  });

  it('never imports the browser client or a provider SDK', () => {
    const src = read(SERVICE);
    expect(src).not.toContain('@/integrations/supabase/client');
    expect(src).not.toMatch(/from ['"]resend['"]/);
  });
});

describe('C2.1 — Providers tab', () => {
  const ui = read(UI);

  it('is registered as a workspace tab on account-bearing channels', () => {
    expect(OMNI_COMMS_GENERIC_TABS).toContain('providers');
    expect(CHANNEL_WORKSPACE_TAB_LABELS.providers).toBe('Providers');
    expect(getChannelDescriptor('email').tabs).toContain('providers');
    expect(getChannelDescriptor('sms').tabs).toContain('providers');
    expect(getChannelDescriptor('in_app').tabs).not.toContain('providers');
  });

  it('never requests a credential value and cannot send', () => {
    expect(ui).not.toMatch(/type=['"]password['"]/);
    expect(ui).not.toContain('sendCommunication');
    expect(ui).not.toMatch(/api\.resend\.com/);
    expect(ui).toContain('SECRET_REFERENCE_HELP');
  });

  it('keeps seeded and reference providers read-only', () => {
    expect(ui).toContain("p.data_origin === 'user'");
    expect(ui).toContain('Read-only');
  });
});
