/**
 * BN Uprating — Reconciliation section (Epic 4).
 *
 * Post-execution operational workspace: schedule consequences, Communication
 * Hub issuance and reconciliation of the approved package against what was
 * actually applied. Every action shown, and every reason an action is
 * unavailable, comes from `bn_uprating_post_execution_readiness_v1`.
 *
 * This surface never recalculates an amount, never writes to a payment or
 * award table and never closes a run — closure is Epic 5.
 */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, CalendarClock, CheckCircle2, Mail, Scale, XOctagon } from 'lucide-react';
import {
  formatMinor,
  upratingCompletionPercent,
  type BnUpratingPostExecutionReadiness,
  type BnUpratingReconciliationView,
} from '@/types/bn/uprating/upratingRun';

export interface BnUpratingReconciliationSectionProps {
  readonly readiness: BnUpratingPostExecutionReadiness | null;
  readonly view: BnUpratingReconciliationView | null;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly isBusy: boolean;
  readonly onRetryLoad: () => void;
  readonly onRebuildSchedules: () => void;
  readonly onIssueCommunications: () => void;
  readonly onReconcile: () => void;
  readonly onMarkFailed: () => void;
}

const reconciliationVariant = (
  status: string | null | undefined,
): 'default' | 'secondary' | 'outline' | 'destructive' => {
  if (status === 'PASS') return 'secondary';
  if (status === 'PASS_WITH_WARNINGS') return 'default';
  if (status === 'BLOCKED') return 'destructive';
  return 'outline';
};

const rowVariant = (
  status: string,
): 'default' | 'secondary' | 'outline' | 'destructive' => {
  if (status === 'COMPLETED' || status === 'REQUESTED' || status === 'NOT_REQUIRED') return 'secondary';
  if (status === 'FAILED') return 'destructive';
  return 'outline';
};

/** First backend blocker, or a backend-fact based explanation. Never a guess. */
function unavailableReason(
  readiness: BnUpratingPostExecutionReadiness | null,
  operation: 'REBUILD' | 'COMMUNICATIONS' | 'RECONCILE' | 'MARK_FAILED',
): string {
  if (!readiness) return 'Post-execution readiness is still loading.';
  const blocker = readiness.blockers?.[0];
  if (blocker) return blocker.message;
  switch (operation) {
    case 'REBUILD':
      return `Schedule consequences cannot be rebuilt while this run is ${readiness.status}.`;
    case 'COMMUNICATIONS':
      return readiness.schedule_failed_count > 0 || readiness.schedule_pending_count > 0
        ? 'Schedule consequences are incomplete, so claimant notices cannot be issued yet.'
        : 'Claimant notices can only be issued once schedule consequences are complete.';
    case 'RECONCILE':
      return readiness.communication_pending_count > 0 || readiness.communication_failed_count > 0
        ? 'Claimant notice issuance is incomplete, so this run cannot be reconciled yet.'
        : 'A run can only be reconciled once execution, schedules and notices are complete. An officer who did not execute the run must reconcile it.';
    case 'MARK_FAILED':
    default:
      return 'A run can only be recorded as failed by an authorised administrator while execution failures remain.';
  }
}

const GovernedAction: React.FC<{
  readonly label: string;
  readonly available: boolean;
  readonly reason: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly variant?: 'default' | 'outline' | 'destructive';
  readonly icon?: React.ReactNode;
}> = ({ label, available, reason, onClick, disabled, variant = 'outline', icon }) => (
  <div className="flex flex-col gap-1">
    <Button
      size="sm"
      variant={variant}
      disabled={!available || disabled}
      title={available ? undefined : reason}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
    {!available && <span className="max-w-xs text-xs text-muted-foreground">{reason}</span>}
  </div>
);

export const BnUpratingReconciliationSection: React.FC<BnUpratingReconciliationSectionProps> = ({
  readiness,
  view,
  isLoading,
  isError,
  isBusy,
  onRetryLoad,
  onRebuildSchedules,
  onIssueCommunications,
  onReconcile,
  onMarkFailed,
}) => {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading post-execution status…</p>;
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Post-execution status is unavailable</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            Reconciliation information could not be loaded. This is not an empty result — nothing
            has been rebuilt, issued or reconciled.
          </p>
          <Button size="sm" variant="outline" onClick={onRetryLoad}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const current = view?.current ?? null;
  const blockers = readiness?.blockers ?? [];
  const canRebuild =
    !!readiness && (readiness.can_rebuild_schedules || readiness.can_retry_schedule_rebuild);
  const canIssue =
    !!readiness && (readiness.can_issue_communications || readiness.can_retry_communications);
  const canReconcile = readiness?.status === 'COMMUNICATIONS_ISSUED';
  const schedulePercent = upratingCompletionPercent(
    readiness?.schedule_completed_count ?? 0,
    readiness?.schedule_required_count ?? 0,
  );
  const commPercent = upratingCompletionPercent(
    readiness?.communication_requested_count ?? 0,
    readiness?.communication_required_count ?? 0,
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Post-execution completion
              {readiness && <Badge variant="outline">{readiness.status}</Badge>}
            </CardTitle>
            <CardDescription>
              Complete the consequences of what was executed: rebuild affected payment schedules,
              issue claimant notices through the Communication Hub, then reconcile the approved
              package against what was actually applied.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-3">
            <GovernedAction
              label="Rebuild affected schedules"
              available={canRebuild && !isBusy}
              reason={unavailableReason(readiness, 'REBUILD')}
              onClick={onRebuildSchedules}
              icon={<CalendarClock className="mr-2 h-4 w-4" />}
            />
            <GovernedAction
              label="Issue Uprating communications"
              available={canIssue && !isBusy}
              reason={unavailableReason(readiness, 'COMMUNICATIONS')}
              onClick={onIssueCommunications}
              icon={<Mail className="mr-2 h-4 w-4" />}
            />
            <GovernedAction
              label="Reconcile run"
              variant="default"
              available={!!canReconcile && !isBusy}
              reason={unavailableReason(readiness, 'RECONCILE')}
              onClick={onReconcile}
              icon={<Scale className="mr-2 h-4 w-4" />}
            />
            <GovernedAction
              label="Record run as failed"
              variant="destructive"
              available={!!readiness?.can_mark_failed && !isBusy}
              reason={unavailableReason(readiness, 'MARK_FAILED')}
              onClick={onMarkFailed}
              icon={<XOctagon className="mr-2 h-4 w-4" />}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {blockers.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Post-execution processing is not available yet</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {blockers.map((b) => (
                    <li key={b.code}>{b.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Schedule consequences</span>
                <span className="text-muted-foreground">
                  {readiness?.schedule_completed_count ?? 0} of{' '}
                  {readiness?.schedule_required_count ?? 0} rebuilt
                </span>
              </div>
              <Progress value={schedulePercent} />
              <p className="text-xs text-muted-foreground">
                Pending {readiness?.schedule_pending_count ?? 0} · failed{' '}
                {readiness?.schedule_failed_count ?? 0}.{' '}
                <strong>A rebuilt schedule is not a payment.</strong> Future unpaid instalments were
                regenerated by the paying domain; no money has been issued or marked as paid.
              </p>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Claimant notices</span>
                <span className="text-muted-foreground">
                  {readiness?.communication_requested_count ?? 0} of{' '}
                  {readiness?.communication_required_count ?? 0} requested
                </span>
              </div>
              <Progress value={commPercent} />
              <p className="text-xs text-muted-foreground">
                Pending {readiness?.communication_pending_count ?? 0} · not accepted{' '}
                {readiness?.communication_failed_count ?? 0} · confirmed delivered{' '}
                {readiness?.communication_delivered_count ?? 0}.{' '}
                <strong>Requested is not delivered.</strong> Delivery is owned and reported by the
                Communication Hub.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Reconciliation
            {current && (
              <Badge variant={reconciliationVariant(current.status)}>{current.status}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Expected figures come from the approved package. Actual figures come from the immutable
            execution, schedule and communication records.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!current && (
            <p className="text-sm text-muted-foreground">
              This run has not been reconciled yet.
            </p>
          )}

          {current && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Expected / applied awards</p>
                  <p className="font-medium">
                    {current.expected_item_count} / {current.actual_applied_item_count}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Expected change</p>
                  <p className="font-medium">{formatMinor(current.expected_delta_total_minor)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Actual change</p>
                  <p className="font-medium">{formatMinor(current.actual_delta_total_minor)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Variance (tolerance)</p>
                  <p className="font-medium">
                    {formatMinor(current.variance_amount_minor)} (
                    {formatMinor(current.tolerance_amount_minor)})
                  </p>
                </div>
              </div>

              <Separator />

              {current.status !== 'BLOCKED' && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>Reconciled — not closed</AlertTitle>
                  <AlertDescription>
                    Reconciliation {current.reconciliation_no} was recorded by{' '}
                    {current.performed_by_name ?? 'an officer'}. The run remains open for closure.
                  </AlertDescription>
                </Alert>
              )}

              {(view?.findings ?? []).length > 0 && (
                <div className="space-y-2">
                  {(view?.findings ?? []).map((f) => (
                    <div key={f.finding_id} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{f.label ?? f.finding_code}</span>
                        <Badge variant={f.severity === 'BLOCKING' ? 'destructive' : 'outline'}>
                          {f.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{f.detail}</p>
                      {(f.expected_value || f.actual_value) && (
                        <p className="text-xs text-muted-foreground">
                          Expected {f.expected_value ?? '—'} · actual {f.actual_value ?? '—'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {(view?.history ?? []).length > 1 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Attempt</TableHead>
                        <TableHead>Result</TableHead>
                        <TableHead>Findings</TableHead>
                        <TableHead>Performed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(view?.history ?? []).map((h) => (
                        <TableRow key={h.reconciliation_id}>
                          <TableCell>#{h.reconciliation_no}</TableCell>
                          <TableCell>
                            <Badge variant={reconciliationVariant(h.status)}>{h.status}</Badge>
                          </TableCell>
                          <TableCell>{h.finding_count}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {h.performed_at ? new Date(h.performed_at).toLocaleString() : '—'} ·{' '}
                            {h.performed_by_name ?? 'System'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule rebuild detail</CardTitle>
          <CardDescription>
            One row per applied award change, handled by the paying domain.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Award</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Instalments rebuilt</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(view?.schedule_rebuilds ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No schedule consequences have been prepared yet.
                  </TableCell>
                </TableRow>
              )}
              {(view?.schedule_rebuilds ?? []).map((s) => (
                <TableRow key={s.rebuild_id}>
                  <TableCell className="font-medium">{s.award_reference}</TableCell>
                  <TableCell>
                    <Badge variant={rowVariant(s.status)}>{s.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{s.schedule_rows_rebuilt}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.failure_code
                      ? `${s.failure_reason ?? s.failure_code}${s.is_retryable ? ' · retryable' : ''}`
                      : s.processed_at
                        ? new Date(s.processed_at).toLocaleString()
                        : 'Not processed'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Communication Hub requests</CardTitle>
          <CardDescription>
            Uprating never sends directly. Each row is a request handed to the Communication Hub,
            which owns templating, channel selection, dispatch and delivery reporting.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Award</TableHead>
                <TableHead>Notice</TableHead>
                <TableHead>Request status</TableHead>
                <TableHead>Hub delivery status</TableHead>
                <TableHead>Requested</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(view?.communications ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No claimant notices have been prepared yet.
                  </TableCell>
                </TableRow>
              )}
              {(view?.communications ?? []).map((c) => (
                <TableRow key={c.intent_id}>
                  <TableCell className="font-medium">{c.award_reference}</TableCell>
                  <TableCell className="text-xs">
                    {c.intent_kind === 'UPRATING_REVERSED' ? 'Uprating reversed' : 'Uprating applied'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={rowVariant(c.status)}>{c.status}</Badge>
                    {c.failure_code && (
                      <div className="text-xs text-muted-foreground">
                        {c.failure_reason ?? c.failure_code}
                        {c.is_retryable ? ' · retryable' : ''}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.hub_delivery_status ?? 'Not reported by the Hub'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.requested_at ? new Date(c.requested_at).toLocaleString() : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
