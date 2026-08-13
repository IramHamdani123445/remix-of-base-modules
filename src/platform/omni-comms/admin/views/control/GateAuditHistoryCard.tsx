/**
 * Omni-Comms Control Center — gate audit history.
 *
 * Shows who changed each delivery gate, when, and which central workflow
 * request the change belongs to. Read-only projection of the server-side
 * release history; it can never alter a gate.
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { ReleaseHistoryEntry } from '@/platform/omni-comms/application/channelReleaseControlTypes';
import type { GateApprovalRequest } from '@/platform/omni-comms/application/gateApprovalWorkflowService';

const EVENT_LABEL: Record<string, string> = {
  transition_proposed: 'Change requested',
  transition_approved: 'Change approved',
  transition_withdrawn: 'Request withdrawn',
  transition_rejected: 'Change rejected',
  transition_executed: 'Change applied',
  suspended: 'Delivery suspended',
  resumed: 'Delivery resumed',
  configuration_updated: 'Settings updated',
  environment_confirmed: 'Environment confirmed',
  runtime_certified: 'Deployment certified',
};

const STATE_LABEL: Record<string, string> = {
  live: 'ON',
  suspended: 'OFF',
  test_only: 'Test only',
  draft: 'Not set up',
  retired: 'Retired',
};

const moment = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleString() : '—';

/** Workflow request closest in time to the recorded gate change. */
const matchWorkflow = (
  entry: ReleaseHistoryEntry,
  requests: readonly GateApprovalRequest[],
): GateApprovalRequest | null => {
  const at = new Date(entry.occurred_at).getTime();
  let best: GateApprovalRequest | null = null;
  let bestDelta = 5 * 60 * 1000;
  for (const r of requests) {
    if (!r.requestedAt) continue;
    const delta = Math.abs(new Date(r.requestedAt).getTime() - at);
    if (delta <= bestDelta) {
      best = r;
      bestDelta = delta;
    }
  }
  return best;
};

export const GateAuditHistoryCard: React.FC<{
  history: readonly ReleaseHistoryEntry[];
  requests: readonly GateApprovalRequest[];
  loading?: boolean;
}> = ({ history, requests, loading }) => (
  <Card data-testid="omni-comms-gate-audit">
    <CardHeader className="pb-2">
      <CardTitle className="text-base">Gate audit history</CardTitle>
      <CardDescription>
        Every change to the delivery gates, who made it, and the workflow step
        it triggered.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-2 text-sm">
      {loading && history.length === 0 ? <Skeleton className="h-24 w-full" /> : null}
      {!loading && history.length === 0 ? (
        <p className="text-sm text-muted-foreground">No gate change has been recorded yet.</p>
      ) : null}
      {history.map((entry) => {
        const workflow = matchWorkflow(entry, requests);
        return (
          <div
            key={entry.id}
            className="rounded-md border p-3"
            data-testid="omni-comms-gate-audit-row"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {EVENT_LABEL[entry.event_type] ?? entry.event_type}
              </span>
              <div className="flex items-center gap-2">
                {entry.from_state || entry.to_state ? (
                  <Badge variant="outline">
                    {STATE_LABEL[entry.from_state ?? ''] ?? entry.from_state ?? '—'} →{' '}
                    {STATE_LABEL[entry.to_state ?? ''] ?? entry.to_state ?? '—'}
                  </Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {moment(entry.occurred_at)}
                </span>
              </div>
            </div>
            {entry.reason ? <p className="mt-1">{entry.reason}</p> : null}
            <p className="mt-1 text-xs text-muted-foreground">
              Changed by: <span className="font-mono">{entry.actor_id ?? 'system'}</span>
              {workflow
                ? ` · Workflow step: ${workflow.status}${
                  workflow.intent ? ` (${workflow.intent})` : ''
                }`
                : ' · No workflow request linked'}
            </p>
          </div>
        );
      })}
    </CardContent>
  </Card>
);

export default GateAuditHistoryCard;
