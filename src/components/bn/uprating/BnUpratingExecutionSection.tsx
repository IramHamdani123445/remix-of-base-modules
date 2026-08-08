/**
 * BN Uprating — Execution section (Epic 3).
 *
 * Shows batch execution progress, per-batch results, a failure workbench and
 * the governed execute / retry actions. Every figure shown originates from the
 * approved package: this surface never recalculates an amount and never writes
 * to an award. Action availability comes from `bn_uprating_run_actions_v1`.
 */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AlertTriangle, PlayCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  formatMinor,
  upratingExecutionProgressPercent,
  type BnUpratingExecutionItemRow,
  type BnUpratingExecutionReadiness,
  type BnUpratingRunAction,
  type BnUpratingRunExecutionView,
} from '@/types/bn/uprating/upratingRun';

const sessionVariant = (
  status: string | null | undefined,
): 'default' | 'secondary' | 'outline' | 'destructive' => {
  if (status === 'COMPLETED') return 'secondary';
  if (status === 'PARTIAL') return 'destructive';
  if (status === 'IN_PROGRESS') return 'default';
  return 'outline';
};

const itemVariant = (
  status: string,
): 'default' | 'secondary' | 'outline' | 'destructive' => {
  if (status === 'APPLIED') return 'secondary';
  if (status === 'FAILED') return 'destructive';
  return 'outline';
};

export interface BnUpratingExecutionSectionProps {
  readonly readiness: BnUpratingExecutionReadiness | null;
  readonly execution: BnUpratingRunExecutionView | null;
  readonly items: readonly BnUpratingExecutionItemRow[];
  readonly itemTotal: number;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly onRetryLoad: () => void;
  readonly executeAction?: BnUpratingRunAction;
  readonly retryAction?: BnUpratingRunAction;
  readonly onExecuteBatch: () => void;
  readonly onRetryFailed: () => void;
  readonly failureFilter: boolean;
  readonly onFailureFilterChange: (onlyFailures: boolean) => void;
}

export const BnUpratingExecutionSection: React.FC<BnUpratingExecutionSectionProps> = ({
  readiness,
  execution,
  items,
  itemTotal,
  isLoading,
  isError,
  onRetryLoad,
  executeAction,
  retryAction,
  onExecuteBatch,
  onRetryFailed,
  failureFilter,
  onFailureFilterChange,
}) => {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading execution status…</p>;
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Execution status is unavailable</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>The execution status could not be loaded. No execution has been started or changed.</p>
          <Button size="sm" variant="outline" onClick={onRetryLoad}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const session = execution?.session ?? null;
  const progress = upratingExecutionProgressPercent(session);
  const blockers = readiness?.blockers ?? [];
  const warnings = readiness?.warnings ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Batch execution
              {session && (
                <Badge variant={sessionVariant(session.status)}>{session.status}</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Execution applies exactly what was approved. Amounts are taken from the frozen
              approval package — nothing is recalculated here, and an award that has moved since
              approval is failed rather than overwritten.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {executeAction && (
              <Button
                size="sm"
                disabled={!executeAction.available}
                title={executeAction.reason ?? undefined}
                onClick={onExecuteBatch}
              >
                <PlayCircle className="mr-2 h-4 w-4" />
                {executeAction.label}
              </Button>
            )}
            {retryAction && (
              <Button
                size="sm"
                variant="outline"
                disabled={!retryAction.available}
                title={retryAction.reason ?? undefined}
                onClick={onRetryFailed}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {retryAction.label}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {blockers.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Execution is not available</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {blockers.map((b) => (
                    <li key={b.code}>{b.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {warnings.length > 0 && (
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>Before you execute</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {warnings.map((w) => (
                    <li key={w.code}>{w.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {!session && (
            <p className="text-sm text-muted-foreground">
              This run has not started executing. When execution begins, the approved population is
              divided into fixed batches and each award change is recorded here individually.
            </p>
          )}

          {session && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {session.applied_item_count + session.failed_item_count + session.skipped_item_count}{' '}
                    of {session.planned_item_count} award(s) processed
                  </span>
                  <span className="font-medium">{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Batches completed</p>
                  <p className="font-medium">
                    {session.completed_batch_count} / {session.planned_batch_count}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Applied</p>
                  <p className="font-medium">{session.applied_item_count}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Failed / skipped</p>
                  <p className="font-medium">
                    {session.failed_item_count} / {session.skipped_item_count}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Applied vs approved change</p>
                  <p className="font-medium">
                    {formatMinor(session.applied_delta_total_minor)} of{' '}
                    {formatMinor(session.approved_delta_total_minor)}
                  </p>
                </div>
              </div>

              <Separator />

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Applied</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                      <TableHead className="text-right">Change applied</TableHead>
                      <TableHead>Executed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(execution?.batches ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground">
                          No batches have been prepared yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {(execution?.batches ?? []).map((b) => (
                      <TableRow key={b.batch_id}>
                        <TableCell className="font-medium">#{b.batch_no}</TableCell>
                        <TableCell>{b.batch_kind === 'RETRY' ? 'Retry' : 'Primary'}</TableCell>
                        <TableCell>
                          <Badge variant={sessionVariant(b.status)}>{b.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {b.applied_count}/{b.item_count}
                        </TableCell>
                        <TableCell className="text-right">{b.failed_count}</TableCell>
                        <TableCell className="text-right">
                          {formatMinor(b.applied_delta_minor)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {b.executed_at
                            ? `${new Date(b.executed_at).toLocaleString()} · ${b.executed_by_name ?? 'System'}`
                            : 'Not executed'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {(execution?.failure_summary ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Failure workbench</CardTitle>
            <CardDescription>
              Only transient failures can be retried. Anything else must be corrected in the owning
              domain, after which a new run is required — retrying never re-applies a change that
              already succeeded.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(execution?.failure_summary ?? []).map((f) => (
              <div
                key={f.failure_code ?? 'unknown'}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <div>
                  <p className="font-medium">{f.label ?? f.failure_code ?? 'Unknown failure'}</p>
                  <p className="text-xs text-muted-foreground">
                    {f.retryable
                      ? 'Eligible for retry.'
                      : 'Must be corrected at source; not retryable.'}
                  </p>
                </div>
                <Badge variant={f.retryable ? 'outline' : 'destructive'}>{f.count}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {session && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Execution items</CardTitle>
              <CardDescription>
                Immutable per-award results. Showing {items.length} of {itemTotal}.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant={failureFilter ? 'default' : 'outline'}
              onClick={() => onFailureFilterChange(!failureFilter)}
            >
              {failureFilter ? 'Showing failures only' : 'Show failures only'}
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Award</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead className="text-right">Approved amount</TableHead>
                  <TableHead className="text-right">Applied amount</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No execution items to show.
                    </TableCell>
                  </TableRow>
                )}
                {items.map((it) => (
                  <TableRow key={it.execution_item_id}>
                    <TableCell>
                      <div className="font-medium">{it.award_reference}</div>
                      <div className="text-xs text-muted-foreground">
                        {it.award_component_code ?? '—'}
                        {it.attempt_no > 1 ? ` · attempt ${it.attempt_no}` : ''}
                      </div>
                    </TableCell>
                    <TableCell>
                      #{it.batch_no}
                      {it.batch_kind === 'RETRY' ? ' (retry)' : ''}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMinor(it.approved_amount_minor)}
                    </TableCell>
                    <TableCell className="text-right">
                      {it.applied_amount_minor == null ? '—' : formatMinor(it.applied_amount_minor)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMinor(it.applied_delta_minor ?? it.approved_delta_minor)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={itemVariant(it.status)}>
                        {it.status_label ?? it.status}
                      </Badge>
                      {it.failure_code && (
                        <div className="text-xs text-muted-foreground">
                          {it.failure_label ?? it.failure_code}
                          {it.is_retryable ? ' · retryable' : ''}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
