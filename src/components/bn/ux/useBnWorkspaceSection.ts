/**
 * URL-driven workflow focus for Benefits record workspaces.
 *
 * The selected workflow section lives in the query string (`?section=…`) so
 * refresh, bookmarking, link sharing and browser Back all preserve the
 * officer's position. React state is never the source of truth.
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useBnWorkspaceSection(
  defaultSection: string,
  paramName = 'section',
): [string, (section: string, options?: { replace?: boolean }) => void] {
  const [params, setParams] = useSearchParams();
  const section = params.get(paramName) ?? defaultSection;

  const setSection = useCallback(
    (next: string, options?: { replace?: boolean }) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          updated.set(paramName, next);
          return updated;
        },
        { replace: options?.replace ?? false },
      );
    },
    [paramName, setParams],
  );

  return [section, setSection];
}
