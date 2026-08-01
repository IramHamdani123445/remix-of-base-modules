/**
 * Omni-Comms admin — URL-controlled tab state.
 *
 * Every Omni-Comms workspace tab is addressable via `?tab=<id>` so Setup
 * Wizard deep links, browser smoke tests and operator bookmarks all land on
 * exactly the same surface.
 *
 * The tab identifiers declared here are the SINGLE source of truth and must
 * match, character for character:
 *   - the `TabsTrigger value` on each page,
 *   - the `?tab=` query emitted by `setupReadinessService.ts`,
 *   - the identifiers asserted in tests.
 *
 * Unknown or malformed values are ignored (never thrown) and fall back to the
 * page default, so a hand-edited URL can never break the workspace.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Legacy (pre-C1) email-only tab identifiers. Retained for deep links. */
export const OMNI_COMMS_CHANNEL_TABS = [
  'providers',
  'accounts',
  'senders',
  'bindings',
  'settings',
] as const;

/** C1 — common channel workspace tabs shared by every channel. */
export const OMNI_COMMS_CHANNEL_WORKSPACE_TABS = [
  'overview',
  'accounts',
  'identities',
  'endpoints',
  'bindings',
  'policies',
  'test-centre',
  'diagnostics',
] as const;

export type OmniCommsChannelWorkspaceTab =
  (typeof OMNI_COMMS_CHANNEL_WORKSPACE_TABS)[number];

/** Old deep links must keep working. */
export const OMNI_COMMS_CHANNEL_TAB_ALIASES: Readonly<
  Record<string, OmniCommsChannelWorkspaceTab>
> = {
  providers: 'overview',
  senders: 'identities',
  settings: 'policies',
};

/** Resolve a raw `?tab=` value (including legacy aliases). Never throws. */
export function resolveChannelWorkspaceTab(
  raw: string | null | undefined,
): OmniCommsChannelWorkspaceTab {
  if (typeof raw !== 'string') return 'overview';
  const value = raw.trim().toLowerCase();
  if (
    (OMNI_COMMS_CHANNEL_WORKSPACE_TABS as readonly string[]).includes(value)
  ) {
    return value as OmniCommsChannelWorkspaceTab;
  }
  return OMNI_COMMS_CHANNEL_TAB_ALIASES[value] ?? 'overview';
}


export const OMNI_COMMS_EVENT_TABS = [
  'definitions',
  'contracts',
  'routes',
  'producers',
] as const;

export const OMNI_COMMS_TEMPLATE_TABS = [
  'library',
  'versions',
  'preview',
  'assembly',
] as const;

export type OmniCommsChannelTab = (typeof OMNI_COMMS_CHANNEL_TABS)[number];
export type OmniCommsEventTab = (typeof OMNI_COMMS_EVENT_TABS)[number];
export type OmniCommsTemplateTab = (typeof OMNI_COMMS_TEMPLATE_TABS)[number];

/** Validate a raw query value against an allowed tab list. */
export function resolveTabParam<T extends string>(
  raw: string | null | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim().toLowerCase();
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Bind a Tabs component to `?tab=`. Selecting a tab replaces (does not push)
 * the history entry, so the back button still leaves the workspace.
 */
export function useOmniCommsTabParam<T extends string>(
  allowed: readonly T[],
  fallback: T,
): [T, (next: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const current = useMemo(
    () => resolveTabParam(searchParams.get('tab'), allowed, fallback),
    [searchParams, allowed, fallback],
  );

  const setTab = useCallback(
    (next: string) => {
      const resolved = resolveTabParam(next, allowed, fallback);
      const params = new URLSearchParams(searchParams);
      params.set('tab', resolved);
      setSearchParams(params, { replace: true });
    },
    [allowed, fallback, searchParams, setSearchParams],
  );

  return [current, setTab];
}

/** Health screen views, addressable via `?view=`. */
export const OMNI_COMMS_HEALTH_VIEWS = [
  'operational',
  'certification',
  'engineering',
] as const;

export type OmniCommsHealthView = (typeof OMNI_COMMS_HEALTH_VIEWS)[number];

/**
 * Bind a view switcher to `?view=`. Behaves exactly like
 * {@link useOmniCommsTabParam} but reads and writes the `view` parameter, so a
 * screen can carry both a coarse view and a nested `?tab=` selection.
 */
export function useOmniCommsViewParam<T extends string>(
  allowed: readonly T[],
  fallback: T,
): [T, (next: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const current = useMemo(
    () => resolveTabParam(searchParams.get('view'), allowed, fallback),
    [searchParams, allowed, fallback],
  );

  const setView = useCallback(
    (next: string) => {
      const resolved = resolveTabParam(next, allowed, fallback);
      const params = new URLSearchParams(searchParams);
      params.set('view', resolved);
      setSearchParams(params, { replace: true });
    },
    [allowed, fallback, searchParams, setSearchParams],
  );

  return [current, setView];
}

/**
 * C1 — bind the channel workspace tabs to `?tab=`, honouring legacy aliases
 * (providers → overview, senders → identities, settings → policies) and
 * falling back to `overview` for unknown values. Selection replaces the
 * history entry so the back button still leaves the workspace.
 */
export function useOmniCommsChannelWorkspaceTab(): [
  OmniCommsChannelWorkspaceTab,
  (next: string) => void,
] {
  const [searchParams, setSearchParams] = useSearchParams();
  const current = useMemo(
    () => resolveChannelWorkspaceTab(searchParams.get('tab')),
    [searchParams],
  );

  const setTab = useCallback(
    (next: string) => {
      const resolved = resolveChannelWorkspaceTab(next);
      const params = new URLSearchParams(searchParams);
      params.set('tab', resolved);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return [current, setTab];
}
