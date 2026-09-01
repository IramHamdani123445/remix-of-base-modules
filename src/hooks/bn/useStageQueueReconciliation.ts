import { useQuery } from '@tanstack/react-query';
import { reconcileStageAgainstQueues } from '@/services/bn/workflow/stageQueueReconciliation';

/** Stage-vs-queue reconciliation for the Benefits queue health surface. */
export function useStageQueueReconciliation() {
  return useQuery({
    queryKey: ['bn', 'stage-queue-reconciliation'],
    queryFn: reconcileStageAgainstQueues,
    staleTime: 60_000,
  });
}
