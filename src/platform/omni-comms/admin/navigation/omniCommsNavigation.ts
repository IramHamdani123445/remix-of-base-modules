/**
 * Omni-Comms — module navigation model (route-driven).
 *
 * Every administrator destination is a REAL route with its own page. The
 * previous `?view=` tab vocabulary is retained only as a redirect shim so
 * historic deep links keep working.
 *
 * Navigation copy is truthful: implemented screens are never described as
 * "future" or "coming soon".
 */

export const OMNI_COMMS_OVERVIEW_ROUTE = '/admin/omnichannel-communications';

const R = (suffix: string) => `${OMNI_COMMS_OVERVIEW_ROUTE}${suffix}`;

export const OMNI_COMMS_ROUTES = {
  overview: OMNI_COMMS_OVERVIEW_ROUTE,
  controlCenter: R('/control-center'),
  operations: R('/operations'),
  channels: R('/channels'),
  events: R('/events'),
  templates: R('/templates'),
  stationeryLetterheads: R('/stationery/letterheads'),
  stationeryEmailLayouts: R('/stationery/email-layouts'),
  stationeryMedia: R('/stationery/media'),
  stationeryTextBlocks: R('/stationery/text-blocks'),
  stationeryHeadersFooters: R('/stationery/headers-footers'),
  stationerySignatures: R('/stationery/signatures'),
  setup: R('/setup'),
  safeTest: R('/safe-test'),
  referenceData: R('/reference-data'),
  health: R('/health'),
  preferences: R('/preferences'),
} as const;

/* ── Legacy `?view=` vocabulary (redirect shim only) ─────────────────────── */

export const OMNI_COMMS_OVERVIEW_VIEWS = [
  'dashboard',
  'control-center',
  'setup',
  'safe-test',
  'reference-data',
  'stationery',
] as const;
export type OmniCommsOverviewView = (typeof OMNI_COMMS_OVERVIEW_VIEWS)[number];

/** Historic deep links that must keep resolving to their current surface. */
export const OMNI_COMMS_OVERVIEW_VIEW_ALIASES: Readonly<Record<string, OmniCommsOverviewView>> = {
  'dry-run': 'safe-test',
  dry_run: 'safe-test',
  safe_test: 'safe-test',
  overview: 'dashboard',
  reference_data: 'reference-data',
  control_center: 'control-center',
  controls: 'control-center',
  gates: 'control-center',
  letterheads: 'stationery',
  'brand-assets': 'stationery',
  'media-library': 'stationery',
  'text-blocks': 'stationery',
};

export function resolveOverviewView(raw: string | null | undefined): OmniCommsOverviewView {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return 'dashboard';
  if (OMNI_COMMS_OVERVIEW_VIEW_ALIASES[v]) return OMNI_COMMS_OVERVIEW_VIEW_ALIASES[v];
  return (OMNI_COMMS_OVERVIEW_VIEWS as readonly string[]).includes(v)
    ? (v as OmniCommsOverviewView)
    : 'dashboard';
}

/** Stationery sections, previously a second tab strip, now real routes. */
export const OMNI_COMMS_STATIONERY_SECTION_ROUTES: Readonly<Record<string, string>> = {
  letterheads: OMNI_COMMS_ROUTES.stationeryLetterheads,
  'email-layouts': OMNI_COMMS_ROUTES.stationeryEmailLayouts,
  email: OMNI_COMMS_ROUTES.stationeryEmailLayouts,
  media: OMNI_COMMS_ROUTES.stationeryMedia,
  'media-library': OMNI_COMMS_ROUTES.stationeryMedia,
  'text-blocks': OMNI_COMMS_ROUTES.stationeryTextBlocks,
  'headers-footers': OMNI_COMMS_ROUTES.stationeryHeadersFooters,
  signatures: OMNI_COMMS_ROUTES.stationerySignatures,
};

/**
 * Where a historic `?view=` (+ optional `?section=`) link should now land.
 * Returns `null` for the dashboard, which is the Overview route itself.
 */
export function legacyViewRedirect(
  rawView: string | null | undefined,
  rawSection?: string | null,
): string | null {
  const view = resolveOverviewView(rawView);
  switch (view) {
    case 'dashboard':
      return null;
    case 'control-center':
      return OMNI_COMMS_ROUTES.controlCenter;
    case 'setup':
      return OMNI_COMMS_ROUTES.setup;
    case 'safe-test':
      return OMNI_COMMS_ROUTES.safeTest;
    case 'reference-data':
      return OMNI_COMMS_ROUTES.referenceData;
    case 'stationery': {
      const section = (rawSection ?? '').trim().toLowerCase();
      return (
        OMNI_COMMS_STATIONERY_SECTION_ROUTES[section] ??
        OMNI_COMMS_ROUTES.stationeryLetterheads
      );
    }
    default:
      return null;
  }
}

/** Build the canonical href for a legacy Overview view. */
export function overviewViewHref(view: OmniCommsOverviewView): string {
  return legacyViewRedirect(view) ?? OMNI_COMMS_OVERVIEW_ROUTE;
}

/* ── Navigation model ────────────────────────────────────────────────────── */

export interface OmniCommsNavItem {
  id: string;
  label: string;
  /** Destination — always a real route. */
  href: string;
  /** Permanent route used for active-state matching. */
  route: string;
  /** Group this destination belongs to. */
  groupId: OmniCommsNavGroupId;
  /** Withheld outside non-production environments. */
  nonProductionOnly?: boolean;
  description: string;
}

export type OmniCommsNavGroupId = 'operate' | 'configure' | 'stationery' | 'setup';

export interface OmniCommsNavGroup {
  id: OmniCommsNavGroupId;
  label: string;
  items: readonly OmniCommsNavItem[];
}

const item = (
  id: string,
  label: string,
  route: string,
  groupId: OmniCommsNavGroupId,
  description: string,
  nonProductionOnly = false,
): OmniCommsNavItem => ({
  id,
  label,
  href: route,
  route,
  groupId,
  description,
  ...(nonProductionOnly ? { nonProductionOnly: true } : {}),
});

export const OMNI_COMMS_NAV_GROUPS: readonly OmniCommsNavGroup[] = [
  {
    id: 'operate',
    label: 'Operate',
    items: [
      item(
        'overview',
        'Overview',
        OMNI_COMMS_ROUTES.overview,
        'operate',
        'What communication capabilities work right now.',
      ),
      item(
        'control-center',
        'Control Center',
        OMNI_COMMS_ROUTES.controlCenter,
        'operate',
        'Every delivery gate, the test send and the approval queue, in one place.',
      ),
      item(
        'activity',
        'Operations',
        OMNI_COMMS_ROUTES.operations,
        'operate',
        'Automatic processing, queued communications and delivery outcomes.',
      ),
    ],
  },
  {
    id: 'configure',
    label: 'Configure',
    items: [
      item(
        'providers',
        'Channels',
        OMNI_COMMS_ROUTES.channels,
        'configure',
        'Transport connections for every channel.',
      ),
      item(
        'communications',
        'Events',
        OMNI_COMMS_ROUTES.events,
        'configure',
        'Business communications by module, event and channel.',
      ),
      item(
        'templates',
        'Templates',
        OMNI_COMMS_ROUTES.templates,
        'configure',
        'Channel templates and their active versions.',
      ),
    ],
  },
  {
    id: 'stationery',
    label: 'Stationery',
    items: [
      item(
        'stationery-letterheads',
        'Letterheads',
        OMNI_COMMS_ROUTES.stationeryLetterheads,
        'stationery',
        'Printed letterhead designs used by physical correspondence.',
      ),
      item(
        'stationery-email-layouts',
        'Email layouts',
        OMNI_COMMS_ROUTES.stationeryEmailLayouts,
        'stationery',
        'Branded email shells applied to every outgoing email.',
      ),
      item(
        'stationery-media',
        'Media library',
        OMNI_COMMS_ROUTES.stationeryMedia,
        'stationery',
        'Logos, seals, watermarks and banners used by correspondence.',
      ),
      item(
        'stationery-text-blocks',
        'Text blocks',
        OMNI_COMMS_ROUTES.stationeryTextBlocks,
        'stationery',
        'Reusable copy, disclaimers and legal footers.',
      ),
      item(
        'stationery-headers-footers',
        'Headers & footers',
        OMNI_COMMS_ROUTES.stationeryHeadersFooters,
        'stationery',
        'Page headers and footers shared across correspondence.',
      ),
      item(
        'stationery-signatures',
        'Signatures',
        OMNI_COMMS_ROUTES.stationerySignatures,
        'stationery',
        'Signing officers and signature images.',
      ),
    ],
  },
  {
    id: 'setup',
    label: 'Setup & health',
    items: [
      item(
        'setup',
        'Setup',
        OMNI_COMMS_ROUTES.setup,
        'setup',
        'Guided configuration readiness for the selected scope.',
      ),
      item(
        'safe-test',
        'Safe test',
        OMNI_COMMS_ROUTES.safeTest,
        'setup',
        'Controlled dry run that never contacts a provider.',
        true,
      ),
      item(
        'health',
        'Health',
        OMNI_COMMS_ROUTES.health,
        'setup',
        'Runtime diagnostics for the deployed communication runtime.',
      ),
    ],
  },
] as const;

export const OMNI_COMMS_NAV_ITEMS: readonly OmniCommsNavItem[] =
  OMNI_COMMS_NAV_GROUPS.flatMap((g) => g.items);

/**
 * Historic technical routes that stay functional but are not advertised.
 * Each maps to the normal surface that now owns it.
 */
export const OMNI_COMMS_UNADVERTISED_ROUTE_OWNERS: Readonly<Record<string, string>> = {
  [OMNI_COMMS_ROUTES.preferences]: 'overview',
  [OMNI_COMMS_ROUTES.referenceData]: 'setup',
};

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

export const OMNI_COMMS_PLANNED_NAV_ITEMS: readonly OmniCommsPlannedNavItem[] = [] as const;

/**
 * Navigation items available in an environment. Non-production-only
 * destinations (the safe dry test) are withheld in production.
 */
export function omniCommsNavItems(
  environment: 'production' | 'non_production' | 'unknown',
): OmniCommsNavItem[] {
  return OMNI_COMMS_NAV_ITEMS.filter(
    (i) => !i.nonProductionOnly || environment === 'non_production',
  );
}

/** Groups, with unavailable destinations removed and empty groups dropped. */
export function omniCommsNavGroups(
  environment: 'production' | 'non_production' | 'unknown',
): OmniCommsNavGroup[] {
  return OMNI_COMMS_NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.nonProductionOnly || environment === 'non_production'),
  })).filter((g) => g.items.length > 0);
}

/** Resolve the active navigation item for a pathname + legacy `?view=` pair. */
export function resolveActiveNavItem(
  pathname: string,
  viewParam?: string | null,
): OmniCommsNavItem {
  const path = pathname.replace(/\/+$/, '') || OMNI_COMMS_OVERVIEW_ROUTE;

  if (path === OMNI_COMMS_OVERVIEW_ROUTE) {
    const redirect = legacyViewRedirect(viewParam ?? null);
    if (redirect) {
      const byRedirect = OMNI_COMMS_NAV_ITEMS.find((i) => i.route === redirect);
      if (byRedirect) return byRedirect;
    }
    return OMNI_COMMS_NAV_ITEMS[0];
  }

  const owner = OMNI_COMMS_UNADVERTISED_ROUTE_OWNERS[path];
  if (owner) {
    return OMNI_COMMS_NAV_ITEMS.find((i) => i.id === owner) ?? OMNI_COMMS_NAV_ITEMS[0];
  }

  // Longest-prefix wins so `/stationery/letterheads` never matches a shorter
  // sibling route by accident.
  const matches = OMNI_COMMS_NAV_ITEMS.filter(
    (i) => i.route !== OMNI_COMMS_OVERVIEW_ROUTE && path.startsWith(i.route),
  ).sort((a, b) => b.route.length - a.route.length);

  return matches[0] ?? OMNI_COMMS_NAV_ITEMS[0];
}

/** The group a pathname belongs to, for the in-page section rail. */
export function resolveActiveNavGroup(
  pathname: string,
  viewParam?: string | null,
): OmniCommsNavGroup | null {
  const active = resolveActiveNavItem(pathname, viewParam);
  return OMNI_COMMS_NAV_GROUPS.find((g) => g.id === active.groupId) ?? null;
}
