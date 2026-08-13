/**
 * Omni-Comms — Automation, at the TOP of the normal Activity surface.
 *
 * Two automatic workers are shown SEPARATELY, never merged into one ambiguous
 * "scheduler" and never as one ambiguous "Queue":
 *   * Business event processing — events waiting to process.
 *   * Email delivery — emails waiting to send.
 *
 * Presentation only. No manual dispatch action lives here: production delivery
 * is automatic. No cron expression, no keys, no nonce, no internal identifiers.
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw } from 'lucide-react';
import {
  AUTOMATION_RECENT_RUN_LIMIT,
  AUTOMATION_STAGE_LABEL,
  automationBlockerMessage,
  automationHealthLabel,
  runResultLabel,
  type AutomationStatus,
} from '@/platform/omni-comms/application/automationStatusService';
import { formatMoment } from './ChannelActivitySummary';

export interface AutomationSectionProps {
  status: AutomationStatus | null;
  loading: boolean;
  onRefresh: () => void;
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-4 border-b py-2 last:border-b-0">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span className="text-sm font-medium">{children}</span>
  </div>
);

const WorkerCard: React.FC<{
  testId: string;
  title: string;
  description: string;
  healthy: boolean;
  frequencyLabel?: string;
  blocker?: string | null;
  rows: ReadonlyArray<{ label: string; value: React.ReactNode }>;
}> = ({ testId, title, description, healthy, frequencyLabel, blocker, rows }) => (
  <Card data-testid={testId}>
    <CardHeader className="pb-2">
      <div className="flex items-center justify-between gap-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <Badge variant={healthy ? 'default' : 'destructive'}>
          {automationHealthLabel(healthy)}
        </Badge>
      </div>
      <CardDescription>{frequencyLabel ?? description}</CardDescription>
    </CardHeader>
    <CardContent>
      {rows.map((r) => (
        <Row key={r.label} label={r.label}>{r.value}</Row>
      ))}
      {!healthy && blocker ? (
        <p className="pt-3 text-sm text-destructive" data-testid={`${testId}-blocker`}>
          {blocker}
        </p>
      ) : null}
    </CardContent>
  </Card>
);

export const AutomationSection: React.FC<AutomationSectionProps> = ({
  status,
  loading,
  onRefresh,
}) => {
  if (loading && !status) {
    return <Skeleton className="h-64 w-full" data-testid="omni-comms-automation-loading" />;
  }
  if (!status) {
    return (
      <Card data-testid="omni-comms-automation">
        <CardHeader>
          <CardTitle className="text-base">Automation</CardTitle>
          <CardDescription>Automation status is unavailable right now.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const events = status.business_event_processor;
  const delivery = status.delivery_processor;
  const callbacks = status.callback_receiver;
  const runs = status.recent_runs.slice(0, AUTOMATION_RECENT_RUN_LIMIT);

  return (
    <div className="space-y-4" data-testid="omni-comms-automation">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">Automation</h3>
          <p className="text-sm text-muted-foreground">
            The automatic workers that turn business moments into delivered messages.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onRefresh}
          data-testid="omni-comms-automation-refresh"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <WorkerCard
          testId="omni-comms-automation-events"
          title="Business event processing"
          description="Turns business moments into prepared communications."
          healthy={events.healthy}
          frequencyLabel={events.frequency_label}
          blocker={automationBlockerMessage(events.last_blocker)}
          rows={[
            { label: 'Last run', value: formatMoment(events.last_run_at) },
            { label: 'Last successful', value: formatMoment(events.last_success_at) },
            {
              label: 'Events waiting to process',
              value: (
                <span data-testid="omni-comms-events-waiting">
                  {events.pending_events}
                </span>
              ),
            },
            {
              label: 'Retrying',
              value: (
                <span data-testid="omni-comms-events-retrying">
                  {events.retry_events}
                </span>
              ),
            },
            {
              label: 'Needs review',
              value: (
                <span data-testid="omni-comms-events-needs-review">
                  {events.needs_review_events}
                </span>
              ),
            },
            { label: 'Oldest waiting', value: formatMoment(events.oldest_pending_at) },
          ]}
        />

        <WorkerCard
          testId="omni-comms-automation-delivery"
          title="Email delivery"
          description="Sends prepared emails to the provider."
          healthy={delivery.healthy}
          frequencyLabel={delivery.frequency_label}
          blocker={automationBlockerMessage(delivery.last_blocker)}
          rows={[
            { label: 'Last run', value: formatMoment(delivery.last_run_at) },
            { label: 'Last successful', value: formatMoment(delivery.last_success_at) },
            { label: 'Jobs found in last run', value: delivery.last_run_found ?? 0 },
            // "Claimed" is NOT "sent": claiming only picks a job up. Provider
            // acceptance and delivery are proven by attempt/callback evidence.
            { label: 'Jobs picked up in last run', value: delivery.last_run_handled ?? 0 },
            {
              label: 'Emails waiting to send',
              value: (
                <span data-testid="omni-comms-emails-waiting">{delivery.waiting_jobs}</span>
              ),
            },
            {
              label: 'Retrying',
              value: (
                <span data-testid="omni-comms-emails-retrying">{delivery.retry_wait_jobs}</span>
              ),
            },
            { label: 'Oldest waiting', value: formatMoment(delivery.oldest_waiting_at) },
          ]}
        />

        <WorkerCard
          testId="omni-comms-automation-callbacks"
          title="Delivery callbacks"
          description="Confirms what the provider did with each message."
          healthy={callbacks.healthy}
          blocker={callbacks.healthy ? null : 'No delivery callbacks received yet.'}
          rows={[
            {
              label: 'Callback configuration',
              value: callbacks.callback_endpoint_ready ? 'Ready' : 'Not configured',
            },
            { label: 'Last callback', value: formatMoment(callbacks.last_callback_at) },
            {
              label: 'Last delivered',
              value: formatMoment(callbacks.last_delivered_callback_at),
            },
            { label: 'Last bounce', value: formatMoment(callbacks.last_bounce_at) },
            { label: 'Last complaint', value: formatMoment(callbacks.last_complaint_at) },
          ]}
        />
      </div>


      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent automation runs</CardTitle>
          <CardDescription>
            A run that finds nothing to do is a healthy run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No automation runs recorded yet.</p>
          ) : (
            <div className="divide-y" data-testid="omni-comms-automation-runs">
              <div className="grid grid-cols-5 gap-2 py-2 text-xs font-medium text-muted-foreground">
                <span>Time</span>
                <span>Process</span>
                <span className="text-right">Found</span>
                <span className="text-right">Handled</span>
                <span>Result</span>
              </div>
              {runs.map((run) => (
                <div
                  key={`${run.stage}-${run.at}`}
                  className="grid grid-cols-5 items-center gap-2 py-2 text-sm"
                >
                  <span className="text-muted-foreground">
                    {new Date(run.at).toLocaleTimeString()}
                  </span>
                  <span>{AUTOMATION_STAGE_LABEL[run.stage]}</span>
                  <span className="text-right tabular-nums">{run.found}</span>
                  <span className="text-right tabular-nums">{run.handled}</span>
                  <span className={run.result === 'success' ? '' : 'text-destructive'}>
                    {runResultLabel(run)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>

      </Card>
    </div>
  );
};

export default AutomationSection;
