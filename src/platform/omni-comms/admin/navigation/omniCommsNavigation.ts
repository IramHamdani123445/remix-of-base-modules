/**
 * Omni-Comms — module-local navigation model.
 *
 * Eight administrator destinations mapped onto the SEVEN permanent routes.
 * Setup and Safe Test are query-parameter views of the Overview route, so no
 * new permanent route is introduced.
 *
 * Navigation copy is truthful: implemented screens are never described as
 * "future" or "coming soon". Preferences is declared separately as a planned,
 * non-navigable entry because its page is still a placeholder.
 */

export const OMNI_COMMS_OVERVIEW_ROUTE = '/admin/omnichannel-communications';

/**
 * Query-parameter views hosted by the Overview route.
 *
 * This list is the CANONICAL parser for `?view=`. The Overview page, the
 * module header, every deep link and every test resolve the view through
 * {@link resolveOverviewView} — no screen parses `?view=` itself.
 *
 * `reference-data` is a real surface (a non-production configuration tool),
 * not an alias of Setup. It is URL-addressable but is not a primary tab; it
 * highlights Setup in the module navigation.
 */
export const OMNI_COMMS_OVERVIEW_VIEWS = [
  'dashboard',
  'setup',
  'safe-test',
  'reference-data',
] as const;
export type OmniCommsOverviewView = (typeof OMNI_COMMS_OVERVIEW_VIEWS)[number];

/** Historic deep links that must keep resolving to their current surface. */
export const OMNI_COMMS_OVERVIEW_VIEW_ALIASES: Readonly<Record<string, OmniCommsOverviewView>> = {
  'dry-run': 'safe-test',
  dry_run: 'safe-test',
  'safe_test': 'safe-test',
  overview: 'dashboard',
  'reference_data': 'reference-data',
};

export function resolveOverviewView(raw: string | null | undefined): OmniCommsOverviewView {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return 'dashboard';
  if (OMNI_COMMS_OVERVIEW_VIEW_ALIASES[v]) return OMNI_COMMS_OVERVIEW_VIEW_ALIASES[v];
  return (OMNI_COMMS_OVERVIEW_VIEWS as readonly string[]).includes(v)
    ? (v as OmniCommsOverviewView)
    : 'dashboard';
}

/** Build the canonical href for an Overview view. */
export function overviewViewHref(view: OmniCommsOverviewView): string {
  return view === 'dashboard'
    ? OMNI_COMMS_OVERVIEW_ROUTE
    : `${OMNI_COMMS_OVERVIEW_ROUTE}?view=${view}`;
}

export interface OmniCommsNavItem {
  id: string;
  label: string;
  /** Destination. Always one of the seven permanent routes (plus ?view=). */
  href: string;
  /** Permanent route used for active-state matching. */
  route: string;
  /** Overview query view this item represents, when applicable. */
  view?: OmniCommsOverviewView;
  /** Withheld outside non-production environments. */
  nonProductionOnly?: boolean;
  description: string;
}

export const OMNI_COMMS_NAV_ITEMS: readonly OmniCommsNavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: OMNI_COMMS_OVERVIEW_ROUTE,
    route: OMNI_COMMS_OVERVIEW_ROUTE,
    view: 'dashboard',
    description: 'Current posture, next required action and safe actions.',
  },
  {
    id: 'setup',
    label: 'Setup',
    href: `${OMNI_COMMS_OVERVIEW_ROUTE}?view=setup`,
    route: OMNI_COMMS_OVERVIEW_ROUTE,
    view: 'setup',
    description: 'Setup Readiness for one organisation, event, channel and locale.',
  },
  {
    id: 'safe-test',
    label: 'Safe Test',
    href: `${OMNI_COMMS_OVERVIEW_ROUTE}?view=safe-test`,
    route: OMNI_COMMS_OVERVIEW_ROUTE,
    view: 'safe-test',
    nonProductionOnly: true,
    description: 'One governed dry test with a synthetic recipient. Nothing is sent.',
  },
  {
    id: 'operations',
    label: 'Operations',
    href: '/admin/omnichannel-communications/operations',
    route: '/admin/omnichannel-communications/operations',
    description: 'Read-only register of runtime requests and messages.',
  },
  {
    id: 'events',
    label: 'Events',
    href: '/admin/omnichannel-communications/events',
    route: '/admin/omnichannel-communications/events',
    description: 'Event definitions, contracts and routes.',
  },
  {
    id: 'templates',
    label: 'Templates',
    href: '/admin/omnichannel-communications/templates',
    route: '/admin/omnichannel-communications/templates',
    description: 'Template families, versions, layouts and shared assets.',
  },
  {
    id: 'channels',
    label: 'Channels',
    href: '/admin/omnichannel-communications/channels',
    route: '/admin/omnichannel-communications/channels',
    description: 'Providers, accounts, sender identities and channel settings.',
  },
  {
    id: 'health',
    label: 'Health',
    href: '/admin/omnichannel-communications/health',
    route: '/admin/omnichannel-communications/health',
    description: 'Operational health, certification evidence and engineering detail.',
  },
] as const;

/**
 * Planned destinations. Rendered as a disabled label with no navigable route
 * until the owning page is implemented.
 */
export interface OmniCommsPlannedNavItem {
  id: string;
  label: string;
  plannedLabel: 'Planned';
  route: string;
}

export const OMNI_COMMS_PLANNED_NAV_ITEMS: readonly OmniCommsPlannedNavItem[] = [
  {
    id: 'preferences',
    label: 'Preferences',
    plannedLabel: 'Planned',
    route: '/admin/omnichannel-communications/preferences',
  },
] as const;

/**
 * Navigation items available in an environment. Non-production-only
 * destinations (the safe dry test) are withheld in production so the
 * navigation never advertises a surface the operator cannot open.
 */
export function omniCommsNavItems(
  environment: 'production' | 'non_production' | 'unknown',
): OmniCommsNavItem[] {
  return OMNI_COMMS_NAV_ITEMS.filter(
    (i) => !i.nonProductionOnly || environment === 'non_production',
  );
}

/** Views that highlight another navigation item rather than one of their own. */
const VIEW_NAV_ALIAS: Readonly<Record<string, string>> = {
  'reference-data': 'setup',
};

/** Resolve the active navigation item for a pathname + `?view=` pair. */
export function resolveActiveNavItem(
  pathname: string,
  viewParam: string | null | undefined,
): OmniCommsNavItem {
  const path = pathname.replace(/\/+$/, '') || OMNI_COMMS_OVERVIEW_ROUTE;
  if (path === OMNI_COMMS_OVERVIEW_ROUTE) {
    const view = resolveOverviewView(viewParam);
    const navId = VIEW_NAV_ALIAS[view];
    if (navId) {
      return (
        OMNI_COMMS_NAV_ITEMS.find((i) => i.id === navId) ?? OMNI_COMMS_NAV_ITEMS[0]
      );
    }
    return (
      OMNI_COMMS_NAV_ITEMS.find((i) => i.view === view) ?? OMNI_COMMS_NAV_ITEMS[0]
    );
  }
  return (
    OMNI_COMMS_NAV_ITEMS.find((i) => i.route === path && !i.view) ??
    OMNI_COMMS_NAV_ITEMS[0]
  );
}
