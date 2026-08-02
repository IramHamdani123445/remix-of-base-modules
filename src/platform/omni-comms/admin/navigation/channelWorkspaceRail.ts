/**
 * Omni-Comms UI Phase 1 — channel workspace navigation rail model.
 *
 * The selected-channel workspace previously rendered all ten tabs in a single
 * horizontal `TabsList`, which clipped below ~1500px and hid Release Control,
 * Test Centre and Diagnostics entirely. This module replaces that ordering
 * with a grouped, intent-based model consumed by a vertical rail.
 *
 * Boundaries (permanent):
 *   - Pure metadata. No React, no RPC, no provider SDK, no send behaviour.
 *   - The tab VOCABULARY is untouched: every rail item is addressed by an
 *     existing `?tab=` code from `domain/channelCatalogue.ts`. No tab code is
 *     added, renamed or removed, so every existing deep link still resolves.
 *   - `advanced` is a forbidden route/name segment (architecture Rule 10); the
 *     deep-configuration surface is named "Resources".
 */
import {
  OMNI_COMMS_GENERIC_TABS,
  type OmniCommsGenericTab,
} from '@/platform/omni-comms/domain/channelCatalogue';
import { OMNI_COMMS_OVERVIEW_ROUTE } from './omniCommsNavigation';

export type ChannelWorkspaceIntent =
  | 'get-ready'
  | 'configure'
  | 'prove'
  | 'observe';

export const CHANNEL_WORKSPACE_INTENT_ORDER: readonly ChannelWorkspaceIntent[] =
  ['get-ready', 'configure', 'prove', 'observe'] as const;

export const CHANNEL_WORKSPACE_INTENT_LABELS: Record<
  ChannelWorkspaceIntent,
  string
> = {
  'get-ready': 'Get ready',
  configure: 'Configure',
  prove: 'Prove it works',
  observe: 'Observe',
};

export interface ChannelRailTabItem {
  readonly kind: 'tab';
  /** Existing `?tab=` code. Never invented here. */
  readonly tab: OmniCommsGenericTab;
  readonly label: string;
  readonly description: string;
  readonly intent: ChannelWorkspaceIntent;
}

export interface ChannelRailLinkItem {
  readonly kind: 'link';
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly intent: ChannelWorkspaceIntent;
  /** Module-level destination (one of the seven permanent routes). */
  readonly href: string;
  /** Whether the link sits before or after the tabs of its intent group. */
  readonly placement: 'before' | 'after';
  /** Withheld outside non-production environments. */
  readonly nonProductionOnly?: boolean;
}


export type ChannelRailItem = ChannelRailTabItem | ChannelRailLinkItem;

/**
 * One rail item per existing workspace tab — exactly ten, no more, no fewer.
 * `providers` is presented as "Resources" because it lists the provider
 * adapter catalogue (a shared platform resource), not a tenant configuration.
 */
export const CHANNEL_RAIL_TAB_ITEMS: readonly ChannelRailTabItem[] = [
  {
    kind: 'tab',
    tab: 'overview',
    label: 'Overview',
    description: 'Channel posture, readiness and what is required next.',
    intent: 'get-ready',
  },
  {
    kind: 'tab',
    tab: 'accounts',
    label: 'Provider Accounts',
    description: 'Provider accounts and their bounded credential references.',
    intent: 'configure',
  },
  {
    kind: 'tab',
    tab: 'identities',
    label: 'Sender Identities',
    description: 'Channel identities used as the visible sender.',
    intent: 'configure',
  },
  {
    kind: 'tab',
    tab: 'endpoints',
    label: 'Endpoints',
    description: 'Sending domains and other channel endpoints.',
    intent: 'configure',
  },
  {
    kind: 'tab',
    tab: 'bindings',
    label: 'Bindings',
    description: 'Identity-to-provider bindings and fallback priority.',
    intent: 'configure',
  },
  {
    kind: 'tab',
    tab: 'policies',
    label: 'Policies',
    description: 'Channel policies and department overrides.',
    intent: 'configure',
  },
  {
    kind: 'tab',
    tab: 'providers',
    label: 'Resources',
    description: 'Provider adapter catalogue available to this channel.',
    intent: 'configure',
  },
  {
    kind: 'tab',
    tab: 'test-centre',
    label: 'Test Centre',
    description: 'Configuration preflight and controlled test evidence.',
    intent: 'prove',
  },
  {
    kind: 'tab',
    tab: 'release-control',
    label: 'Release Control',
    description: 'Governed release prerequisites, proposal and approval.',
    intent: 'observe',
  },
  {
    kind: 'tab',
    tab: 'diagnostics',
    label: 'Diagnostics',
    description: 'Read-only diagnostic evidence for this channel.',
    intent: 'observe',
  },
] as const;

/**
 * Module-level destinations surfaced inside the rail so an operator never has
 * to hunt for the two workflow steps that live on the Overview route. They are
 * links, not tabs: they leave the channel workspace.
 */
export const CHANNEL_RAIL_LINK_ITEMS: readonly ChannelRailLinkItem[] = [
  {
    kind: 'link',
    id: 'setup-readiness',
    label: 'Setup readiness',
    description: 'Guided readiness for one organisation, event and channel.',
    intent: 'get-ready',
    href: `${OMNI_COMMS_OVERVIEW_ROUTE}?view=setup`,
    placement: 'after',
  },
  {
    kind: 'link',
    id: 'safe-test',
    label: 'Safe Test',
    description:
      'One governed dry test with a synthetic recipient. Nothing is sent.',
    intent: 'prove',
    href: `${OMNI_COMMS_OVERVIEW_ROUTE}?view=safe-test`,
    placement: 'before',
    nonProductionOnly: true,
  },
] as const;

/** Rail label for a tab code (used by breadcrumbs and the mobile trigger). */
export const CHANNEL_RAIL_TAB_LABELS: Record<OmniCommsGenericTab, string> =
  CHANNEL_RAIL_TAB_ITEMS.reduce(
    (acc, item) => {
      acc[item.tab] = item.label;
      return acc;
    },
    {} as Record<OmniCommsGenericTab, string>,
  );

export interface ChannelRailGroup {
  readonly intent: ChannelWorkspaceIntent;
  readonly label: string;
  readonly items: readonly ChannelRailItem[];
}

/**
 * Build the rail for one channel.
 *
 * @param tabs        Tabs the channel definition actually offers.
 * @param environment Controls whether non-production-only links are shown.
 */
export function buildChannelRailGroups(
  tabs: readonly OmniCommsGenericTab[],
  environment: 'production' | 'non_production' | 'unknown' = 'unknown',
): ChannelRailGroup[] {
  const available = new Set<string>(tabs);
  const groups: ChannelRailGroup[] = [];

  for (const intent of CHANNEL_WORKSPACE_INTENT_ORDER) {
    const links = CHANNEL_RAIL_LINK_ITEMS.filter(
      (l) =>
        l.intent === intent &&
        (!l.nonProductionOnly || environment === 'non_production'),
    );
    const items: ChannelRailItem[] = [
      ...links.filter((l) => l.placement === 'before'),
    ];
    for (const item of CHANNEL_RAIL_TAB_ITEMS) {
      if (item.intent === intent && available.has(item.tab)) items.push(item);
    }
    items.push(...links.filter((l) => l.placement === 'after'));
    if (items.length > 0) {
      groups.push({
        intent,
        label: CHANNEL_WORKSPACE_INTENT_LABELS[intent],
        items,
      });
    }
  }

  return groups;
}

/** Every generic tab is represented exactly once — asserted by tests. */
export const CHANNEL_RAIL_COVERS_ALL_TABS =
  CHANNEL_RAIL_TAB_ITEMS.length === OMNI_COMMS_GENERIC_TABS.length;
