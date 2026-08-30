/**
 * Omni-Comms — business-friendly wording for the normal Activity surface.
 *
 * Internal request vocabulary (`accepted`, `completed_with_blockers`, …) is
 * technical. Normal operators see a business label. Raw statuses remain
 * available in Technical details.
 *
 * Claiming a job is NEVER "sent": only provider attempt evidence may say
 * "Provider accepted" and only callback evidence may say "Delivered".
 */
import type { OpsRequestListItem } from './operationsTypes';

export type ActivityFilterId =
  | 'all'
  | 'waiting'
  | 'accepted'
  | 'delivered'
  | 'failed'
  | 'needs_attention';

export const ACTIVITY_FILTERS: ReadonlyArray<{ id: ActivityFilterId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'failed', label: 'Failed' },
  { id: 'needs_attention', label: 'Needs attention' },
];

/** Business label for one activity row. */
export function activityStatusLabel(row: {
  status: string;
  mode: string;
  held_job_count: number;
  message_count: number;
  blocker_count: number;
}): string {
  if (row.status === 'blocked') return 'Needs configuration';
  if (row.status === 'failed') return 'Failed';
  if (row.status === 'completed_with_blockers') return 'Needs review';
  if (row.status === 'accepted') return 'Event queued';
  if (row.status === 'processing') return 'Preparing';
  if (row.mode === 'dry_run' || row.mode === 'shadow') return 'Test only';
  if (row.held_job_count > 0) return 'Held — awaiting authorisation';
  if (row.message_count > 0) return 'Sending';
  return 'Preparing';

}

/** Does this row belong to the chosen normal filter? */
export function matchesActivityFilter(
  row: Pick<OpsRequestListItem, 'status' | 'mode' | 'held_job_count' | 'message_count' | 'blocker_count'>,
  filter: ActivityFilterId,
): boolean {
  const label = activityStatusLabel(row);
  switch (filter) {
    case 'all':
      return true;
    case 'waiting':
      return label === 'Event queued' || label === 'Preparing' || label === 'Held — awaiting authorisation';
    case 'accepted':
      return label === 'Sending' || label === 'Provider accepted';
    case 'delivered':
      return label === 'Delivered';
    case 'failed':
      return label === 'Failed';
    case 'needs_attention':
      return label === 'Needs configuration' || label === 'Needs review' || label === 'Failed';
    default:
      return true;
  }
}

/** Bounded "needs attention" count from the summary projection. */
export function needsAttentionCount(input: {
  blockedRequests: number;
  failedRequests: number;
  needsReviewEvents: number;
  outcomeUnknown: boolean;
  staleWorker: boolean;
  callbackProblem: boolean;
}): number {
  return (
    input.blockedRequests +
    input.failedRequests +
    input.needsReviewEvents +
    (input.outcomeUnknown ? 1 : 0) +
    (input.staleWorker ? 1 : 0) +
    (input.callbackProblem ? 1 : 0)
  );
}
