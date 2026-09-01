/**
 * IA Phase-B / DEF-A-01 — canonical workspace tab vocabularies.
 *
 * Single source of truth for the Plan and Engagement workspace tab names so
 * URL (?tab=) <-> Tabs state stay synchronized and no tab-name variants
 * proliferate across components.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export const PLAN_WORKSPACE_TABS = [
  'overview',
  'portfolio',
  'engagements',
  'coverage',
  'capacity',
  'autoplan',
  'approval',
  'boardpack',
  'distribution',
  'closure',
] as const;
export type PlanWorkspaceTab = (typeof PLAN_WORKSPACE_TABS)[number];

export const ENGAGEMENT_WORKSPACE_TABS = [
  'overview',
  'preparation',
  'programme',
  'activities',
  'control-tests',
  'evidence',
  'working-papers',
  'findings',
  'responses',
  'actions',
  'follow-ups',
  'quality-review',
  'timeline',
  'closure',
] as const;
export type EngagementWorkspaceTab = (typeof ENGAGEMENT_WORKSPACE_TABS)[number];

/** Tabs a management respondent (audited department) may open. */
export const ENGAGEMENT_MANAGEMENT_TABS: EngagementWorkspaceTab[] = [
  'overview',
  'findings',
  'responses',
  'actions',
  'timeline',
];

export const DEFAULT_TAB = 'overview';

export function isValidTab<T extends readonly string[]>(
  vocabulary: T,
  value: string | null | undefined,
): value is T[number] {
  return !!value && (vocabulary as readonly string[]).includes(value);
}

export function normalizeTab<T extends readonly string[]>(
  vocabulary: T,
  value: string | null | undefined,
  fallback: T[number] = DEFAULT_TAB as T[number],
): T[number] {
  return isValidTab(vocabulary, value) ? (value as T[number]) : fallback;
}

/**
 * Controlled tab state bound to ?tab=. Preserves all unrelated search
 * parameters (e.g. ?action=submit, ?findingId=..., ?actionId=...) and
 * normalizes invalid / disallowed values back to a safe tab.
 */
export function useUrlTab<T extends readonly string[]>(
  vocabulary: T,
  options?: { allowed?: readonly string[]; ready?: boolean },
): [T[number], (next: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('tab');
  const allowed = options?.allowed;
  const ready = options?.ready !== false;

  const activeTab = useMemo(() => {
    const normalized = normalizeTab(vocabulary, raw);
    if (ready && allowed && !allowed.includes(normalized)) {
      return DEFAULT_TAB as T[number];
    }
    return normalized;
  }, [vocabulary, raw, allowed, ready]);

  const setTab = useCallback(
    (next: string) => {
      const value = normalizeTab(vocabulary, next);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set('tab', value);
          return params;
        },
        { replace: false },
      );
    },
    [vocabulary, setSearchParams],
  );

  // Normalize the URL when it carries an invalid or disallowed tab so the
  // address bar never disagrees with what is rendered.
  useEffect(() => {
    if (!ready) return;
    if (raw && raw !== activeTab) {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set('tab', activeTab);
          return params;
        },
        { replace: true },
      );
    }
  }, [raw, activeTab, ready, setSearchParams]);

  return [activeTab, setTab];
}
