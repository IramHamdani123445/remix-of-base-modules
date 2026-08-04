/**
 * Omni-Comms CG1 — channel generalisation regression tests.
 *
 * Proves the shared Channels workspace is genuinely omnichannel WITHOUT
 * creating parallel per-channel copies, and that every claim it renders is
 * truthful:
 *   - one canonical capability matrix (schemaSupported vs uiApplicable);
 *   - Release Control stays Email-only;
 *   - readiness is two independent facets;
 *   - unloaded/unavailable data is never rendered as zero;
 *   - Email behaviour (C1–C7) is preserved verbatim.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OMNI_COMMS_CHANNEL_CATALOGUE,
  OMNI_COMMS_CHANNEL_RESOURCES,
  channelCapability,
  getChannelDescriptor,
  isTabApplicable,
  resolveApplicableTab,
  validateChannelCatalogue,
} from '@/platform/omni-comms/domain/channelCatalogue';
import {
  formatResourceCount,
  type ChannelConfigurationSummary,
  type ChannelResourceState,
  type ChannelResourceSummary,
} from '@/platform/omni-comms/application/channelConfigurationTypes';
import type {
  OmniCommsChannel,
  OmniCommsChannelResource,
} from '@/platform/omni-comms/domain/channelCatalogue';
import {
  projectChannelReadiness,
  projectChannelConfigurationReadiness,
} from '@/platform/omni-comms/admin/views/channels/channelReadiness';

function resourceSummary(
  resource: OmniCommsChannelResource,
  state: ChannelResourceState,
  total: number | null = null,
): ChannelResourceSummary {
  return { resource, state, total, active: total, message: state };
}

function configurationSummary(
  channel: OmniCommsChannel,
  state: ChannelResourceState,
  total: number | null = null,
): ChannelConfigurationSummary {
  const resources = Object.fromEntries(
    OMNI_COMMS_CHANNEL_RESOURCES.map((r) => [r, resourceSummary(r, state, total)]),
  ) as ChannelConfigurationSummary['resources'];
  return {
    channel,
    organizationId: 'org-test',
    departmentId: null,
    resources,
    loading: state === 'loading',
    unavailableResources: state === 'unavailable' ? OMNI_COMMS_CHANNEL_RESOURCES : [],
    generatedAt: new Date(0).toISOString(),
  };
}

const ROOT = join(process.cwd(), 'src/platform/omni-comms');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const page = read('admin/views/OmniCommsChannelsPage.tsx');
const catalogueSrc = read('admin/views/channels/ChannelCatalogue.tsx');
const overviewSrc = read('admin/views/channels/ChannelOverviewTab.tsx');
const registrySrc = read('admin/views/channels/channelUiRegistry.ts');
const railSrc = read('admin/views/channels/ChannelWorkspaceRail.tsx');
const serviceSrc = read('application/channelConfigurationService.ts');
const readinessSrc = read('admin/views/channels/channelReadiness.ts');
const catalogueDomain = read('domain/channelCatalogue.ts');

describe('CG1 — canonical capability matrix', () => {
  it('the catalogue itself is internally consistent', () => {
    expect(validateChannelCatalogue()).toEqual([]);
  });

  it('capability separates schema support from UI applicability', () => {
    for (const d of OMNI_COMMS_CHANNEL_CATALOGUE) {
      for (const resource of OMNI_COMMS_CHANNEL_RESOURCES) {
        const cap = channelCapability(d.channel, resource);
        expect(typeof cap.schemaSupported).toBe('boolean');
        expect(typeof cap.uiApplicable).toBe('boolean');
        // A resource may never be offered in the UI unless the shared object
        // can actually store it.
        if (cap.uiApplicable) expect(cap.schemaSupported).toBe(true);
      }
    }
  });

  it('tabs are DERIVED from the matrix, never hand-listed per channel', () => {
    expect(catalogueDomain).toContain('deriveTabsFromCapabilities');
    for (const d of OMNI_COMMS_CHANNEL_CATALOGUE) {
      expect(d.tabs[0]).toBe('overview');
      for (const tab of d.tabs) {
        expect(isTabApplicable(d.channel, tab)).toBe(true);
      }
    }
  });

  it('there is exactly ONE capability definition, not one per file', () => {
    for (const src of [registrySrc, railSrc, page, catalogueSrc]) {
      expect(src).not.toContain('uiApplicable:');
    }
  });
});

describe('CG1 — approved per-channel workflow', () => {
  it('SMS and WhatsApp expose Endpoints, matching the server contract', () => {
    // omni_comms_priv_normalize_channel_endpoint accepts SMS
    // delivery_callback / inbound_callback and WhatsApp business_webhook.
    for (const channel of ['sms', 'whatsapp'] as const) {
      expect(getChannelDescriptor(channel).tabs).toContain('endpoints');
    }
  });

  it('Push identities stay hidden — representability is not sufficient', () => {
    expect(channelCapability('push', 'identities').uiApplicable).toBe(false);
    expect(getChannelDescriptor('push').tabs).not.toContain('identities');
  });

  it('In-App and Print keep their narrow surface', () => {
    for (const channel of ['in_app', 'print'] as const) {
      const tabs = getChannelDescriptor(channel).tabs;
      expect(tabs).not.toContain('accounts');
      expect(tabs).not.toContain('bindings');
    }
  });

  it('Release Control is Email-only', () => {
    for (const d of OMNI_COMMS_CHANNEL_CATALOGUE) {
      const applicable = isTabApplicable(d.channel, 'release-control');
      expect(applicable).toBe(d.channel === 'email');
    }
  });

  it('Webhook and Voice are planned states with no configuration surface', () => {
    for (const channel of ['webhook', 'voice'] as const) {
      const d = getChannelDescriptor(channel);
      expect(d.databaseSupported).toBe(false);
      expect(d.tabs).toEqual(['overview']);
    }
  });
});

describe('CG1 — invalid tab handling and cross-channel resource clearing', () => {
  it('an out-of-capability tab resolves to Overview', () => {
    expect(resolveApplicableTab('push', 'identities')).toBe('overview');
    expect(resolveApplicableTab('sms', 'release-control')).toBe('overview');
    expect(resolveApplicableTab('email', 'release-control')).toBe('release-control');
  });

  it('the coordinator falls back rather than mounting an unsupported tab', () => {
    expect(page).toContain('isTabApplicable(definition.code, rawTab)');
    expect(page).toContain("? \"overview\"");
  });

  it('changing channel clears the deep-linked resource', () => {
    const hook = read('admin/hooks/useOmniCommsChannelParam.ts');
    expect(hook).toContain("delete('resource')");
  });
});

describe('CG1 — generic configuration summary', () => {
  it('composes EXISTING generic summary contracts only', () => {
    expect(serviceSrc).toContain('getChannelProviderAccountSummary');
    expect(serviceSrc).toContain('getChannelIdentitySummary');
    expect(serviceSrc).toContain('getChannelEndpointSummary');
    expect(serviceSrc).toContain('getChannelBindingSummary');
    expect(serviceSrc).toContain('getChannelPolicySummary');
  });

  it('never invokes Release Control contracts for non-Email channels', () => {
    expect(serviceSrc).not.toContain('ReleaseControl');
    expect(page).toContain('getChannelReleaseControlSummary');
    // the only release-control read is inside the email refresh
    expect(page.split('getChannelReleaseControlSummary').length - 1).toBe(2);
  });

  it('CG1 is migration-free and RPC-free', () => {
    expect(serviceSrc).not.toMatch(/create (table|function)/i);
  });
});

describe('CG1 — truthful counts and readiness', () => {
  it('unloaded and unavailable counts are never rendered as zero', () => {
    expect(formatResourceCount(undefined)).not.toBe('0');
    expect(formatResourceCount(resourceSummary('identities', 'loading')))
      .toMatch(/loading/i);
    expect(formatResourceCount(resourceSummary('identities', 'unavailable')))
      .toMatch(/unavailable/i);
    expect(formatResourceCount(resourceSummary('identities', 'not_applicable')))
      .toMatch(/not applicable/i);
    expect(formatResourceCount(resourceSummary('identities', 'ready', 0)))
      .toMatch(/not configured/i);
  });

  it('the catalogue and Overview render count states, not raw numbers', () => {
    expect(catalogueSrc).toContain('formatResourceCount');
    expect(overviewSrc).toContain('formatResourceCount');
  });

  it('readiness is two independent facets', () => {
    const projection = projectChannelReadiness({ channel: 'sms', configurationSummary: null });
    expect(projection.configuration.state).toBe('unknown');
    expect(projection.delivery.state).toBe('adapter_not_installed');
    expect(projection.delivery.label).toBe('Delivery adapter not installed');
  });

  it('configuration ready never implies delivery ready', () => {
    const summary = configurationSummary('sms', 'ready', 1);
    const facet = projectChannelConfigurationReadiness('sms', summary, false);
    expect(facet.state).toBe('ready');
    expect(facet.label).toBe('Configuration ready');
    const projection = projectChannelReadiness({
      channel: 'sms',
      configurationSummary: summary,
    });
    expect(projection.delivery.state).toBe('adapter_not_installed');
  });

  it('partial data yields unavailable, not a readiness verdict', () => {
    const facet = projectChannelConfigurationReadiness(
      'sms',
      configurationSummary('sms', 'unavailable'),
      false,
    );
    expect(facet.state).toBe('unavailable');
  });
});

describe('CG1 — Email is preserved verbatim', () => {
  it('the generic layer delegates to projectEmailReadiness', () => {
    expect(readinessSrc).toContain('projectEmailReadiness');
    expect(readinessSrc).not.toContain('email_send_ready');
    expect(page).toContain('projectEmailReadiness');
  });

  it('the Email verdict is copied, never recomputed', () => {
    const email = {
      state: 'prerequisites_met' as const,
      label: 'Configuration prerequisites met',
      explanation: 'verbatim email explanation',
      checks: [],
    };
    const projection = projectChannelReadiness({
      channel: 'email',
      emailProjection: email as never,
    });
    expect(projection.configuration.label).toBe('Configuration prerequisites met');
    expect(projection.configuration.detail).toBe('verbatim email explanation');
    expect(projection.email).toBe(email);
  });
});

describe('CG1 — boundaries', () => {
  it('no provider SDK, send facade, dispatch or live delivery from the UI', () => {
    for (const src of [page, catalogueSrc, overviewSrc, serviceSrc, readinessSrc]) {
      expect(src).not.toContain('sendCommunication(');
      expect(src).not.toContain('resend_adapter');
      expect(src).not.toContain('live_delivery_enabled: true');
    }
  });

  it('the UI never queries the raw audit log', () => {
    for (const src of [page, catalogueSrc, overviewSrc, serviceSrc]) {
      expect(src).not.toContain('core_audit_log');
    }
  });

  it('the coordinator stays a coordinator', () => {
    expect(page).toContain('loadChannelConfigurationSummary');
    expect(page).not.toContain('supabase.rpc(');
  });
});
