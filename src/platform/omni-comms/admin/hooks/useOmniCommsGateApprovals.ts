/**
 * Omni-Comms — bound reader for the central-workflow gate approval queue.
 *
 * Reading the queue mutates nothing and sends nothing.
 */
import React from 'react';
import {
  listOpenGateRequests,
  listRecentGateDecisions,
  type GateApprovalRequest,
} from '@/platform/omni-comms/application/gateApprovalWorkflowService';

export interface OmniCommsGateApprovalsState {
  open: GateApprovalRequest[];
  recent: GateApprovalRequest[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useOmniCommsGateApprovals(
  organizationId: string | null,
): OmniCommsGateApprovalsState {
  const [open, setOpen] = React.useState<GateApprovalRequest[]>([]);
  const [recent, setRecent] = React.useState<GateApprovalRequest[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (!organizationId) {
      setOpen([]);
      setRecent([]);
      return;
    }
    setLoading(true);
    try {
      const [openRows, recentRows] = await Promise.all([
        listOpenGateRequests(organizationId),
        listRecentGateDecisions(organizationId).catch(() => []),
      ]);
      setOpen(openRows);
      setRecent(recentRows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'approval_queue_unavailable');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return { open, recent, loading, error, refresh };
}

export default useOmniCommsGateApprovals;
