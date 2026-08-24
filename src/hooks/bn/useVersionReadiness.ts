/**
 * Shared publish-readiness query for a product version.
 *
 * Rule Version Governance and the Product Editor must never disagree about
 * whether a version can be submitted/approved/published, so both read the same
 * gate through the same cache key.
 */
import { useQuery } from '@tanstack/react-query';
import { assertVersionReadiness } from '@/services/bn/rulesAdminService';

export function useVersionReadiness(versionId?: string, enabled = true) {
  return useQuery({
    queryKey: ['bn', 'version-readiness', versionId],
    queryFn: () => assertVersionReadiness(versionId!),
    enabled: !!versionId && enabled,
    staleTime: 60_000,
    retry: false,
  });
}
