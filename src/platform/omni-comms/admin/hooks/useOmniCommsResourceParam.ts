/**
 * Omni-Comms UI Phase 2 — additive `?resource=` deep link.
 *
 * Purely additive: it never replaces `?channel=` or `?tab=`, never rewrites a
 * route, and an unknown value simply opens nothing. All seven Omni-Comms
 * routes and every existing tab alias remain untouched.
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const OMNI_COMMS_RESOURCE_PARAM = 'resource';

export interface UseOmniCommsResourceParamResult {
  /** The currently deep-linked resource id, if any. */
  resourceId: string | null;
  isSelected: (id: string) => boolean;
  selectResource: (id: string) => void;
  clearResource: () => void;
}

export function useOmniCommsResourceParam(): UseOmniCommsResourceParamResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(OMNI_COMMS_RESOURCE_PARAM);
  const resourceId = raw && raw.trim() !== '' ? raw.trim() : null;

  const selectResource = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams);
      params.set(OMNI_COMMS_RESOURCE_PARAM, id);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const clearResource = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete(OMNI_COMMS_RESOURCE_PARAM);
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const isSelected = useCallback((id: string) => resourceId === id, [resourceId]);

  return { resourceId, isSelected, selectResource, clearResource };
}
