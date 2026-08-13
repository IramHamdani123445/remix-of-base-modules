/**
 * Omni-Comms — the normal Activity area.
 *
 * A business feed: what was sent, for which business moment, to whom (masked),
 * and what happened. Plus the operational summary. No fingerprints, no
 * correlation identifiers, no release vocabulary on this surface.
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { businessEventLabel } from '@/platform/omni-comms/domain/businessEventLabels';
import type { AutomationStatus } from '@/platform/omni-comms/application/automationStatusService';
import { AutomationSection } from './AutomationSection';
import { ChannelActivitySummary, formatMoment } from './ChannelActivitySummary';


export type SimpleActivityOutcome =
  | 'delivered'
  | 'accepted'
  | 'waiting'
  | 'failed'
  | 'held';

export const ACTIVITY_OUTCOME_LABEL: Record<SimpleActivityOutcome, string> = {
  delivered: 'Delivered',
  accepted: 'Accepted',
  waiting: 'Waiting to send',
  failed: 'Failed',
  held: 'Held',
};

export interface SimpleActivityRow {
  readonly id: string;
  readonly eventCode: string | null;
  /** Already masked upstream. */
  readonly recipient: string | null;
  readonly outcome: SimpleActivityOutcome;
  readonly occurredAt: string | null;
}

export interface SimpleActivitySurfaceProps {
  loading: boolean;
  healthy: boolean;
  queueDepth: number | null;
  schedulerLastRunAt: string | null;
  lastAcceptedAt: string | null;
  lastDeliveredAt: string | null;
  rows: readonly SimpleActivityRow[];
  technicalDetails: React.ReactNode;
  /** Automation ownership: Activity is where operators watch the workers. */
  automationStatus?: AutomationStatus | null;
  automationLoading?: boolean;
  onRefreshAutomation?: () => void;
}

export const SimpleActivitySurface: React.FC<SimpleActivitySurfaceProps> = ({
  loading,
  healthy,
  queueDepth,
  schedulerLastRunAt,
  lastAcceptedAt,
  lastDeliveredAt,
  rows,
  technicalDetails,
  automationStatus = null,
  automationLoading = false,
  onRefreshAutomation,
}) => (
  <div className="space-y-6" data-testid="omni-comms-simple-activity">
    {onRefreshAutomation ? (
      <AutomationSection
        status={automationStatus}
        loading={automationLoading}
        onRefresh={onRefreshAutomation}
      />
    ) : null}

    <Card>
      <CardHeader>
        <CardTitle className="text-base">Delivery activity</CardTitle>
        <CardDescription>How sending is behaving right now.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <ChannelActivitySummary
            healthy={healthy}
            queueDepth={queueDepth}
            schedulerLastRunAt={schedulerLastRunAt}
            lastAcceptedAt={lastAcceptedAt}
            lastDeliveredAt={lastDeliveredAt}
          />
        )}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent messages</CardTitle>
        <CardDescription>The most recent business messages for this channel.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          <div className="divide-y" data-testid="omni-comms-activity-rows">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {row.eventCode ? businessEventLabel(row.eventCode) : 'Message'}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {row.recipient ?? 'Recipient hidden'} · {formatMoment(row.occurredAt)}
                  </div>
                </div>
                <Badge
                  variant={
                    row.outcome === 'failed'
                      ? 'destructive'
                      : row.outcome === 'delivered'
                        ? 'default'
                        : 'secondary'
                  }
                >
                  {ACTIVITY_OUTCOME_LABEL[row.outcome]}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>

    <div>{technicalDetails}</div>
  </div>
);

export default SimpleActivitySurface;
