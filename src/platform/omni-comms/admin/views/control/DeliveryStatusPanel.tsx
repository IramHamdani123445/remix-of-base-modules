/**
 * Omni-Comms Control Center — email delivery status at a glance.
 *
 * Shows whether delivery is LIVE or OFF, how many approvals are waiting, how
 * many jobs are held or queued, and when the next automatic dispatch attempt
 * is expected. Read-only: it changes nothing.
 */
import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import {
  automationBlockerMessage,
  type AutomationStatus,
} from '@/platform/omni-comms/application/automationStatusService';
import type { DeliveryToggleSnapshot } from '@/platform/omni-comms/application/deliveryToggleService';

const moment = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleString() : '—';

/** Next expected run of a worker that runs every minute. */
const nextAttempt = (lastRunAt: string | null | undefined): string => {
  if (!lastRunAt) return 'Waiting for the next run';
  const next = new Date(new Date(lastRunAt).getTime() + 60_000);
  return next.getTime() <= Date.now() ? 'Due now' : next.toLocaleTimeString();
};

export const DeliveryStatusPanel: React.FC<{
  snapshot: DeliveryToggleSnapshot | null;
  automation: AutomationStatus | null;
  pendingApprovals: number;
}> = ({ snapshot, automation, pendingApprovals }) => {
  const live = snapshot?.state === 'on';
  const delivery = automation?.delivery_processor;
  const warnings = [
    automationBlockerMessage(delivery?.last_blocker),
    automation && !automation.business_event_processor.healthy
      ? 'Business events are not being processed normally.'
      : null,
    automation && !automation.callback_receiver.callback_endpoint_ready
      ? 'Delivery result tracking is not switched on, so sends cannot be confirmed.'
      : null,
    (delivery?.held_jobs ?? 0) > 0 && !live
      ? 'Emails are held because automatic delivery is off.'
      : null,
  ].filter((w): w is string => Boolean(w));

  return (
    <Card data-testid="omni-comms-delivery-status">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Email delivery status</CardTitle>
          <Badge variant={live ? 'default' : 'secondary'}>{live ? 'LIVE' : 'OFF'}</Badge>
        </div>
        <CardDescription>
          What the system is doing right now with business Email.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <p>
            Approvals waiting:{' '}
            <strong data-testid="omni-comms-status-approvals">{pendingApprovals}</strong>
          </p>
          <p>
            Held emails:{' '}
            <strong data-testid="omni-comms-status-held">{delivery?.held_jobs ?? 0}</strong>
          </p>
          <p>
            Waiting to send:{' '}
            <strong data-testid="omni-comms-status-waiting">
              {delivery?.waiting_jobs ?? 0}
            </strong>
          </p>
          <p>
            Next attempt:{' '}
            <strong data-testid="omni-comms-status-next">
              {nextAttempt(delivery?.last_run_at ?? null)}
            </strong>
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 text-muted-foreground">
          <p>Last attempt: {moment(delivery?.last_attempt_at)}</p>
          <p>Last accepted: {moment(delivery?.last_provider_accepted_at)}</p>
          <p>Last delivered: {moment(delivery?.last_delivered_at)}</p>
        </div>
        {warnings.length > 0 ? (
          <Alert variant="destructive" data-testid="omni-comms-status-warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Attention needed before emails get stuck</AlertTitle>
            <AlertDescription>
              <ul className="ml-4 list-disc">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default DeliveryStatusPanel;
