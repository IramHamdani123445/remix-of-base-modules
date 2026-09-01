import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as workbasketService from '@/services/bn/workbasketService';
import type { BnWorkbasket } from '@/types/bn';

export function useBnWorkbaskets() {
  return useQuery({
    queryKey: ['bn', 'workbaskets'],
    queryFn: () => workbasketService.fetchWorkbaskets(),
  });
}

export function useBnMyQueue(userCode: string | null) {
  return useQuery({
    queryKey: ['bn', 'my-queue', userCode],
    queryFn: () => workbasketService.fetchMyQueue(userCode!),
    enabled: !!userCode,
  });
}

export function useBnQueueClaims(workbasketId: string | undefined) {
  return useQuery({
    queryKey: ['bn', 'queue-claims', workbasketId],
    queryFn: () => workbasketService.fetchQueueClaims(workbasketId!),
    enabled: !!workbasketId,
  });
}

export function useCreateBnWorkbasket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (basket: Partial<BnWorkbasket>) => workbasketService.createWorkbasket(basket),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bn', 'workbaskets'] }),
  });
}

export function useUpdateBnWorkbasket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<BnWorkbasket> }) =>
      workbasketService.updateWorkbasket(id, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bn', 'workbaskets'] }),
  });
}

export function usePickBnClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, userCode }: { assignmentId: string; userCode: string }) =>
      workbasketService.pickClaim(assignmentId, userCode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bn', 'queue-claims'] });
      qc.invalidateQueries({ queryKey: ['bn', 'my-queue'] });
    },
  });
}

export function useReleaseBnClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) => workbasketService.releaseClaim(assignmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bn', 'queue-claims'] });
      qc.invalidateQueries({ queryKey: ['bn', 'my-queue'] });
    },
  });
}

/**
 * Active, uncompleted claim counts per workbasket (total + overdue),
 * so the queue can show where the work actually is.
 */
export function useBasketClaimCounts(basketIds: string[]) {
  const key = [...basketIds].sort().join(',');
  return useQuery({
    queryKey: ['bn', 'basket-claim-counts', key],
    enabled: basketIds.length > 0,
    staleTime: 30_000,
    queryFn: () => workbasketService.fetchBasketClaimCounts(basketIds),
  });
}
