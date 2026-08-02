/**
 * Omni-Comms UI Phase 1 — canonical breadcrumb model.
 *
 * Breadcrumb pattern:
 *   Admin → Omnichannel Communications → Section → Context
 *
 * Pure metadata: no React, no router, no RPC. The trail is derived from the
 * already-canonical navigation resolvers so the breadcrumb, the module
 * navigation and the workspace rail can never disagree about "where am I".
 */
import {
  OMNI_COMMS_OVERVIEW_ROUTE,
  resolveActiveNavItem,
} from './omniCommsNavigation';
import { CHANNEL_RAIL_TAB_LABELS } from './channelWorkspaceRail';
import { resolveChannelWorkspaceTab } from '../hooks/useOmniCommsTabParam';

export interface OmniCommsCrumb {
  readonly id: string;
  readonly label: string;
  /** Absent for the trailing (current) crumb and for non-navigable roots. */
  readonly href?: string;
}

export const OMNI_COMMS_MODULE_LABEL = 'Omnichannel Communications';

export interface BuildBreadcrumbsInput {
  readonly pathname: string;
  /** Raw `?view=` value, when present. */
  readonly view?: string | null;
  /** Raw `?channel=` value, when present. */
  readonly channel?: string | null;
  /** Human-readable channel name resolved from the channel catalogue. */
  readonly channelLabel?: string | null;
  /** Raw `?tab=` value, when present. */
  readonly tab?: string | null;
}

/**
 * Build the full breadcrumb trail for an Omni-Comms location.
 *
 * Levels:
 *   1. "Admin" — non-navigable context root.
 *   2. Module — links to the Overview route (unless already there).
 *   3. Section — the active module destination (Dashboard, Channels, …).
 *   4+. Context — selected channel and, inside it, the rail destination.
 */
export function buildOmniCommsBreadcrumbs(
  input: BuildBreadcrumbsInput,
): OmniCommsCrumb[] {
  const path = input.pathname.replace(/\/+$/, '') || OMNI_COMMS_OVERVIEW_ROUTE;
  const section = resolveActiveNavItem(path, input.view ?? null);

  const crumbs: OmniCommsCrumb[] = [{ id: 'admin', label: 'Admin' }];
  crumbs.push({
    id: 'module',
    label: OMNI_COMMS_MODULE_LABEL,
    href: OMNI_COMMS_OVERVIEW_ROUTE,
  });
  crumbs.push({
    id: `section-${section.id}`,
    label: section.label,
    href: section.href,
  });

  const isChannels = path === '/admin/omnichannel-communications/channels';
  const channelLabel = (input.channelLabel ?? '').trim();
  if (isChannels && channelLabel) {
    crumbs.push({
      id: 'channel',
      label: channelLabel,
      href: `${section.route}?channel=${encodeURIComponent(
        (input.channel ?? '').trim(),
      )}`,
    });
    const tab = resolveChannelWorkspaceTab(input.tab);
    crumbs.push({
      id: `tab-${tab}`,
      label: CHANNEL_RAIL_TAB_LABELS[tab],
    });
  }

  // The trailing crumb is always the current page and is never a link.
  const last = crumbs[crumbs.length - 1];
  crumbs[crumbs.length - 1] = { id: last.id, label: last.label };
  return crumbs;
}
