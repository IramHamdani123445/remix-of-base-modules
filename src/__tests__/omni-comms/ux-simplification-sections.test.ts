/**
 * Omni-Comms UX Simplification — channel workspace section model.
 *
 * Guards the two promises this redesign makes:
 *   1. The operator sees five task-shaped sections, not ten object tabs.
 *   2. Every existing `?tab=` deep link still resolves to the same surface.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CHANNEL_SECTION_DEFINITIONS,
  CHANNEL_SECTION_TAB_HINTS,
  CHANNEL_SECTION_TAB_LABELS,
  CHANNEL_WORKSPACE_SECTIONS,
  buildChannelSections,
  defaultTabForSection,
  getSectionDefinition,
  sectionForTab,
  tabForReadinessCheck,
  validateChannelSectionModel,
} from '@/platform/omni-comms/admin/navigation/channelWorkspaceSections';
import { OMNI_COMMS_GENERIC_TABS } from '@/platform/omni-comms/domain/channelCatalogue';
import { buildOmniCommsBreadcrumbs } from '@/platform/omni-comms/admin/navigation/omniCommsBreadcrumbs';

const read = (rel: string): string =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const PAGE = 'src/platform/omni-comms/admin/views/OmniCommsChannelsPage.tsx';
const NAV = 'src/platform/omni-comms/admin/views/channels/ChannelWorkspaceSectionNav.tsx';
const SUMMARY = 'src/platform/omni-comms/admin/views/channels/EmailReadinessSummary.tsx';
const CREDENTIALS =
  'src/platform/omni-comms/admin/views/channels/ProviderCredentialsSection.tsx';
const RECIPIENTS =
  'src/platform/omni-comms/admin/views/channels/ControlledRecipientsSection.tsx';
const SURFACES =
  'src/platform/omni-comms/admin/views/channels/ChannelWorkspaceSurfaces.tsx';

describe('channel workspace section model', () => {
  it('is structurally valid', () => {
    expect(validateChannelSectionModel()).toEqual([]);
  });

  it('presents exactly five sections', () => {
    expect(CHANNEL_WORKSPACE_SECTIONS).toHaveLength(5);
    expect(CHANNEL_SECTION_DEFINITIONS).toHaveLength(5);
  });

  it('covers every canonical tab exactly once', () => {
    const covered = CHANNEL_SECTION_DEFINITIONS.flatMap((s) => [...s.tabs]).sort();
    expect(covered).toEqual([...OMNI_COMMS_GENERIC_TABS].sort());
  });

  it('resolves every existing deep link to a section', () => {
    for (const tab of OMNI_COMMS_GENERIC_TABS) {
      const section = sectionForTab(tab);
      expect(getSectionDefinition(section).tabs).toContain(tab);
    }
  });

  it('falls back to Overview for unknown or malformed values', () => {
    expect(sectionForTab('nonsense')).toBe('overview');
    expect(sectionForTab(null)).toBe('overview');
    expect(sectionForTab(undefined)).toBe('overview');
    expect(defaultTabForSection('overview')).toBe('overview');
  });

  it('omits sections the channel cannot use', () => {
    const sections = buildChannelSections(['overview', 'policies']);
    expect(sections.map((s) => s.id)).toEqual(['overview', 'delivery-setup']);
    expect(sections[1].availableTabs).toEqual(['policies']);
  });

  it('labels destinations in operator language, not object language', () => {
    expect(CHANNEL_SECTION_TAB_LABELS.identities).toBe('Sender addresses');
    expect(CHANNEL_SECTION_TAB_LABELS.bindings).toBe('Delivery routing');
    expect(CHANNEL_SECTION_TAB_LABELS.endpoints).toBe('Sending domains');
    expect(CHANNEL_SECTION_TAB_LABELS.policies).toBe('Sending rules');
    for (const tab of OMNI_COMMS_GENERIC_TABS) {
      expect(CHANNEL_SECTION_TAB_HINTS[tab].length).toBeGreaterThan(10);
    }
  });

  it('never uses the forbidden "advanced" segment', () => {
    const serialised = JSON.stringify({
      CHANNEL_SECTION_DEFINITIONS,
      CHANNEL_SECTION_TAB_LABELS,
    }).toLowerCase();
    expect(serialised).not.toContain('advanced');
  });

  it('routes every readiness blocker to a surface that can clear it', () => {
    expect(tabForReadinessCheck('credentials')).toBe('accounts');
    expect(tabForReadinessCheck('sending_domain_verification')).toBe('endpoints');
    expect(tabForReadinessCheck('provider_delivery_test')).toBe('test-centre');
    expect(tabForReadinessCheck('release_control')).toBe('release-control');
    expect(tabForReadinessCheck('unknown_key')).toBe('overview');
  });
});

describe('breadcrumbs follow the section model', () => {
  it('names the section rather than a rail destination', () => {
    const crumbs = buildOmniCommsBreadcrumbs({
      pathname: '/admin/omnichannel-communications/channels',
      channel: 'email',
      channelLabel: 'Email',
      tab: 'identities',
    });
    const labels = crumbs.map((c) => c.label);
    expect(labels).toContain('Delivery Setup');
    expect(labels[labels.length - 1]).toBe('Sender addresses');
    expect(crumbs[crumbs.length - 1].href).toBeUndefined();
  });

  it('does not repeat a single-surface section', () => {
    const labels = buildOmniCommsBreadcrumbs({
      pathname: '/admin/omnichannel-communications/channels',
      channel: 'email',
      channelLabel: 'Email',
      tab: 'diagnostics',
    }).map((c) => c.label);
    expect(labels.filter((l) => l === 'Health')).toHaveLength(1);
  });
});

describe('workspace composition', () => {
  it('mounts the section navigation and drops the ten-item rail', () => {
    const src = read(PAGE);
    expect(src).toContain('ChannelWorkspaceSectionNav');
    expect(src).toContain('ChannelSectionSteps');
    expect(src).not.toContain('ChannelWorkspaceRail');
  });

  it('shows readiness above the workspace navigation', () => {
    const src = read(PAGE);
    const readinessAt = src.indexOf('<EmailReadinessSummary');
    const navAt = src.indexOf('<ChannelWorkspaceSectionNav');
    expect(readinessAt).toBeGreaterThan(-1);
    expect(navAt).toBeGreaterThan(readinessAt);
  });

  it('mounts provider credentials with the account and recipients with the test', () => {
    const src = read(SURFACES);
    expect(src).toContain('<ProviderCredentialsSection');
    expect(src).toContain('<ControlledRecipientsSection');
  });

  it('keeps navigation presentation free of RPC and provider contact', () => {
    const src = read(NAV);
    expect(src).not.toMatch(/\brpc\(/);
    expect(src).not.toContain('supabase');
    expect(src).not.toContain('resend');
  });
});

describe('readiness summary offers one next action', () => {
  it('renders a single primary action bound to the next blocker', () => {
    const src = read(SUMMARY);
    expect(src).toContain('Next action');
    expect(src).toContain('tabForReadinessCheck');
    expect(src).toContain('omni-comms-readiness-fix-action');
    // The verdict is never derived locally.
    expect(src).not.toMatch(/\brpc\(/);
  });
});

describe('credential handling stays write-only', () => {
  it('never renders or logs a credential value', () => {
    const src = read(CREDENTIALS);
    expect(src).toContain("type=\"password\"");
    expect(src).toContain('writeProviderSecret');
    // No read-back path and no console leak.
    expect(src).not.toContain('console.log');
    expect(src).not.toMatch(/secretValue\s*\}/);
    // The value is cleared after every submission attempt.
    expect(src).toContain("setValue('')");
  });

  it('gates mutation on the server-reported permission', () => {
    const src = read(CREDENTIALS);
    expect(src).toContain('canManageCredentials');
    expect(src).toContain('disabled={!canManage}');
  });

  it('manages approved test recipients through bounded RPCs only', () => {
    const src = read(RECIPIENTS);
    expect(src).toContain('upsertTestRecipient');
    expect(src).toContain('setTestRecipientActive');
    expect(src).toContain('canManage');
    expect(src).not.toContain('supabase');
  });
});
