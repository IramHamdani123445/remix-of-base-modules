/**
 * Omni-Comms — business activity header.
 *
 * Answers the operational questions in business language: is delivery healthy,
 * how much is queued, when did the sending service last run, when was the last
 * message accepted and delivered. No counters like "7/7", no fingerprints.
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';

export interface ChannelActivitySummaryProps {
  healthy: boolean;
  queueDepth: number | null;
  schedulerLastRunAt: string | null;
  lastAcceptedAt: string | null;
  lastDeliveredAt: string | null;
}

export const formatMoment = (value: string | null | undefined): string => {
  if (!value) return 'Never';
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? 'Never' : at.toLocaleString();
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-4 border-b py-2 last:border-b-0">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span className="text-sm font-medium">{children}</span>
  </div>
);

export const ChannelActivitySummary: React.FC<ChannelActivitySummaryProps> = ({
  healthy,
  queueDepth,
  schedulerLastRunAt,
  lastAcceptedAt,
  lastDeliveredAt,
}) => (
  <div data-testid="omni-comms-activity-summary">
    <Row label="Delivery status">
      <Badge variant={healthy ? 'default' : 'destructive'}>
        {healthy ? 'Healthy' : 'Needs attention'}
      </Badge>
    </Row>
    <Row label="Queue">{queueDepth === null ? 'Unavailable' : queueDepth}</Row>
    <Row label="Last scheduler run">{formatMoment(schedulerLastRunAt)}</Row>
    <Row label="Last accepted">{formatMoment(lastAcceptedAt)}</Row>
    <Row label="Last delivered">{formatMoment(lastDeliveredAt)}</Row>
  </div>
);

export default ChannelActivitySummary;
