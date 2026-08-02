/**
 * Omni-Comms UI Phase 1 — navigation shell, breadcrumbs and workspace rail.
 *
 * Source-only assertions (no DOM render, no RPC, no provider contact):
 * every claim is checked against the canonical navigation model or against
 * the component source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  mergeOmniCommsHref,
  mergeSearchParams,
  OMNI_COMMS_SCOPE_PARAMS,
} from '@/platform/omni-comms/admin/navigation/searchParamMerge';
import {
  buildChannelRailGroups,
  CHANNEL_RAIL_LINK_ITEMS,
  CHANNEL_RAIL_TAB_ITEMS,
  CHANNEL_RAIL_TAB_LABELS,
  CHANNEL_WORKSPACE_INTENT_ORDER,
} from '@/platform/omni-comms/admin/navigation/channelWorkspaceRail';
import { buildOmniCommsBreadcrumbs } from '@/platform/omni-comms/admin/navigation/omniCommsBreadcrumbs';
import { OMNI_COMMS_GENERIC_TABS } from '@/platform/omni-comms/domain/channelCatalogue';
import { resolveChannelWorkspaceTab } from '@/platform/omni-comms/admin/hooks/useOmniCommsTabParam';
import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const CHANNELS_PAGE = 'src/platform/omni-comms/admin/views/OmniCommsChannelsPage.tsx';
const LANDING_PAGE = 'src/platform/omni-comms/admin/views/OmniCommsLandingPage.tsx';
const SHELL = 'src/platform/omni-comms/admin/components/OmniCommsShell.tsx';
const HEADER = 'src/platform/omni-comms/admin/components/OmniCommsModuleHeader.tsx';
const RAIL = 'src/platform/omni-comms/admin/views/channels/ChannelWorkspaceRail.tsx';

describe('UI Phase 1 — safe query-parameter merge', () => {
  it('preserves the working scope when navigating', () => {
    const href = mergeOmniCommsHref(
      '/admin/omnichannel-communications/channels',
      '?org=abc&department=d1&channel=email',
    );
    expect(href).toContain('org=abc');
    expect(href).toContain('department=d1');
    expect(href).toContain('channel=email');
  });

  it('lets an explicit target value win over the preserved one', () => {
    const href = mergeOmniCommsHref(
      '/admin/omnichannel-communications/channels?channel=sms',
      '?channel=email',
    );
    expect(href).toContain('channel=sms');
    expect(href).not.toContain('channel=email');
  });

  it('drops parameters outside the declared scope list', () => {
    const href = mergeOmniCommsHref(
      '/admin/omnichannel-communications',
      '?tab=identities&view=setup',
    );
    expect(href).toBe('/admin/omnichannel-communications');
  });

  it('returns a bare path when there is nothing to merge', () => {
    expect(mergeOmniCommsHref('/admin/omnichannel-communications', '')).toBe(
      '/admin/omnichannel-communications',
    );
  });

  it('never mutates the caller parameters', () => {
    const current = new URLSearchParams('org=abc');
    const next = mergeSearchParams(current, { tab: 'policies' });
    expect(current.get('tab')).toBeNull();
    expect(next.get('tab')).toBe('policies');
    expect(next.get('org')).toBe('abc');
  });

  it('deletes a key when the change value is null', () => {
    const next = mergeSearchParams('?tab=policies&org=abc', { tab: null });
    expect(next.get('tab')).toBeNull();
    expect(next.get('org')).toBe('abc');
  });

  it('declares channel scope as preserved', () => {
    expect(OMNI_COMMS_SCOPE_PARAMS).toContain('channel');
    expect(OMNI_COMMS_SCOPE_PARAMS).toContain('department');
  });
});

describe('UI Phase 1 — channel workspace rail model', () => {
  it('maps every existing tab code to exactly one rail item', () => {
    const railTabs = CHANNEL_RAIL_TAB_ITEMS.map((i) => i.tab).sort();
    expect(railTabs).toEqual([...OMNI_COMMS_GENERIC_TABS].sort());
    expect(new Set(railTabs).size).toBe(OMNI_COMMS_GENERIC_TABS.length);
  });

  it('groups the workspace under the four operator intents', () => {
    expect(CHANNEL_WORKSPACE_INTENT_ORDER).toEqual([
      'get-ready',
      'configure',
      'prove',
      'observe',
    ]);
    const intents = new Set(CHANNEL_RAIL_TAB_ITEMS.map((i) => i.intent));
    for (const intent of CHANNEL_WORKSPACE_INTENT_ORDER) {
      expect(intents.has(intent)).toBe(true);
    }
  });

  it('names the deep-configuration surface "Resources", never "Advanced"', () => {
    expect(CHANNEL_RAIL_TAB_LABELS.providers).toBe('Resources');
    const serialised = JSON.stringify(CHANNEL_RAIL_TAB_ITEMS).toLowerCase();
    expect(serialised).not.toContain('advanced');
  });

  it('surfaces Release Control, Test Centre and Diagnostics as first-class items', () => {
    for (const tab of ['release-control', 'test-centre', 'diagnostics'] as const) {
      expect(CHANNEL_RAIL_TAB_ITEMS.some((i) => i.tab === tab)).toBe(true);
    }
  });

  it('withholds the Safe Test link outside non-production', () => {
    const production = buildChannelRailGroups(OMNI_COMMS_GENERIC_TABS, 'production');
    const flat = production.flatMap((g) => g.items);
    expect(flat.some((i) => i.kind === 'link' && i.id === 'safe-test')).toBe(false);

    const nonProduction = buildChannelRailGroups(
      OMNI_COMMS_GENERIC_TABS,
      'non_production',
    );
    expect(
      nonProduction.flatMap((g) => g.items).some((i) => i.kind === 'link' && i.id === 'safe-test'),
    ).toBe(true);
  });

  it('only offers tabs the selected channel actually declares', () => {
    const groups = buildChannelRailGroups(['overview', 'policies'], 'unknown');
    const tabs = groups.flatMap((g) => g.items).filter((i) => i.kind === 'tab');
    expect(tabs.map((i) => (i as { tab: string }).tab).sort()).toEqual([
      'overview',
      'policies',
    ]);
  });

  it('points its module-level links at permanent routes only', () => {
    const routes = new Set(OMNI_COMMS_ROUTE_REGISTRY.map((r) => r.path));
    for (const link of CHANNEL_RAIL_LINK_ITEMS) {
      expect(routes.has(link.href.split('?')[0])).toBe(true);
    }
  });
});

describe('UI Phase 1 — breadcrumbs', () => {
  it('renders Admin → Omnichannel Communications → Section on the Overview route', () => {
    const crumbs = buildOmniCommsBreadcrumbs({
      pathname: '/admin/omnichannel-communications',
      view: null,
    });
    expect(crumbs.map((c) => c.label)).toEqual([
      'Admin',
      'Omnichannel Communications',
      'Dashboard',
    ]);
  });

  it('names the human-readable section for each permanent route', () => {
    const crumbs = buildOmniCommsBreadcrumbs({
      pathname: '/admin/omnichannel-communications/operations',
    });
    expect(crumbs[crumbs.length - 1].label).toBe('Operations');
  });

  it('adds channel and workspace context inside a channel workspace', () => {
    const crumbs = buildOmniCommsBreadcrumbs({
      pathname: '/admin/omnichannel-communications/channels',
      channel: 'email',
      channelLabel: 'Email',
      tab: 'identities',
    });
    expect(crumbs.map((c) => c.label)).toEqual([
      'Admin',
      'Omnichannel Communications',
      'Channels',
      'Email',
      'Sender Identities',
    ]);
  });

  it('honours legacy tab aliases in the context crumb', () => {
    expect(resolveChannelWorkspaceTab('senders')).toBe('identities');
    const crumbs = buildOmniCommsBreadcrumbs({
      pathname: '/admin/omnichannel-communications/channels',
      channel: 'email',
      channelLabel: 'Email',
      tab: 'senders',
    });
    expect(crumbs[crumbs.length - 1].label).toBe('Sender Identities');
  });

  it('never makes the trailing crumb a link', () => {
    const crumbs = buildOmniCommsBreadcrumbs({
      pathname: '/admin/omnichannel-communications/health',
    });
    expect(crumbs[crumbs.length - 1].href).toBeUndefined();
  });

  it('resolves `?view=setup` to the Setup section', () => {
    const crumbs = buildOmniCommsBreadcrumbs({
      pathname: '/admin/omnichannel-communications',
      view: 'setup',
    });
    expect(crumbs[crumbs.length - 1].label).toBe('Setup');
  });
});

describe('UI Phase 1 — shell composition', () => {
  it('renders exactly one breadcrumb trail, in the shell', () => {
    expect(read(SHELL)).toContain('OmniCommsBreadcrumbs');
    expect(read(CHANNELS_PAGE)).not.toContain('OmniCommsBreadcrumbs');
    expect(read(LANDING_PAGE)).not.toContain('OmniCommsBreadcrumbs');
  });

  it('removes the duplicated Overview tab strip', () => {
    const src = read(LANDING_PAGE);
    expect(src).not.toContain('TabsList');
    expect(src).not.toContain('TabsTrigger');
  });

  it('removes the clipping horizontal tab strip from the channel workspace', () => {
    const src = read(CHANNELS_PAGE);
    expect(src).not.toContain('TabsList');
    expect(src).not.toContain('overflow-x-auto');
    expect(src).toContain('ChannelWorkspaceRail');
  });

  it('offers the rail as a persistent rail on desktop and a drawer below lg', () => {
    const src = read(RAIL);
    expect(src).toContain('hidden lg:block');
    expect(src).toContain('lg:hidden');
    expect(src).toContain('SheetContent');
  });

  it('preserves scope on every module navigation link', () => {
    expect(read(HEADER)).toContain('mergeOmniCommsHref(item.href, location.search)');
  });

  it('keeps exactly the seven permanent routes', () => {
    expect(OMNI_COMMS_ROUTE_REGISTRY).toHaveLength(7);
    for (const route of OMNI_COMMS_ROUTE_REGISTRY) {
      expect(route.path.includes('advanced')).toBe(false);
    }
  });
});
