/**
 * Omni-Comms Control Center — end-to-end trace of recent test sends.
 *
 * Read-only. Shows, for each recent technical test delivery: the request id,
 * the provider response, the delivery callback outcome and how many provider
 * attempts were made. Nothing here sends, retries or mutates evidence.
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  deliveryOutcome,
  type ChannelTestDelivery,
} from '@/platform/omni-comms/application/channelTestDeliveryTypes';

const OUTCOME_LABEL: Record<string, string> = {
  delivered: 'Delivered',
  sent: 'Handed to provider',
  delivery_delayed: 'Delayed',
  bounced: 'Bounced',
  complained: 'Marked as spam',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Preparing',
  dispatching: 'Sending',
  accepted: 'Accepted by provider',
  failed: 'Failed',
  outcome_unknown: 'Outcome unknown',
};

const moment = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleString() : '—';

export const TestDeliveryTraceCard: React.FC<{
  deliveries: readonly ChannelTestDelivery[];
  loading?: boolean;
  onRefresh?: () => void;
}> = ({ deliveries, loading, onRefresh }) => (
  <Card data-testid="omni-comms-test-trace">
    <CardHeader className="pb-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Test send results</CardTitle>
          <CardDescription>
            The full chain for each recent test: request, provider response and
            the delivery result reported back by the provider.
          </CardDescription>
        </div>
        {onRefresh ? (
          <Button size="sm" variant="outline" onClick={onRefresh}>
            Refresh
          </Button>
        ) : null}
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      {loading && deliveries.length === 0 ? <Skeleton className="h-24 w-full" /> : null}
      {!loading && deliveries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No test send has been made yet.</p>
      ) : null}
      {deliveries.map((d) => {
        const outcome = deliveryOutcome(d);
        const verified = (d.events ?? []).some((e) => e.signature_verified);
        const attempts = d.attempts?.length ?? d.attempt_count ?? 0;
        return (
          <div
            key={d.id}
            className="rounded-md border p-3 text-sm"
            data-testid="omni-comms-test-trace-row"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{d.target_masked}</span>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{STATUS_LABEL[d.status] ?? d.status}</Badge>
                <Badge
                  variant={
                    outcome === 'delivered'
                      ? 'default'
                      : outcome === 'bounced' || outcome === 'complained'
                        ? 'destructive'
                        : 'secondary'
                  }
                >
                  {outcome ? OUTCOME_LABEL[outcome] ?? outcome : 'Awaiting delivery result'}
                </Badge>
              </div>
            </div>
            <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Request id</dt>
                <dd className="font-mono text-xs">{d.id}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Provider message id</dt>
                <dd className="font-mono text-xs">{d.provider_message_id ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Provider response</dt>
                <dd>
                  {d.provider_status_code ?? '—'}
                  {d.result_code ? ` · ${d.result_code}` : ''}
                  {d.error_code ? ` · ${d.error_code}` : ''}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Attempts</dt>
                <dd>{attempts}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Requested</dt>
                <dd>{moment(d.requested_at)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Callback signature</dt>
                <dd>{verified ? 'Verified' : 'Not received'}</dd>
              </div>
            </dl>
            {(d.events ?? []).length > 0 ? (
              <ul className="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">
                {d.events.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3">
                    <span>{OUTCOME_LABEL[e.event_type] ?? e.event_type}</span>
                    <span>{moment(e.occurred_at ?? e.received_at)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </CardContent>
  </Card>
);

export default TestDeliveryTraceCard;
