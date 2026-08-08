/**
 * BN Uprating — Execution schedule section (Epic 2).
 *
 * Records and displays when an approved run is intended to execute later.
 * Scheduling changes nothing: no award, entitlement, payment schedule or
 * communication is touched at this stage.
 */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarClock, ShieldAlert } from 'lucide-react';
import type {
  BnUpratingExecutionSchedule,
  BnUpratingRunAction,
  BnUpratingScheduleReadiness,
} from '@/types/bn/uprating/upratingRun';

interface Props {
  readonly readiness: BnUpratingScheduleReadiness | null;
  readonly schedules: readonly BnUpratingExecutionSchedule[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly onRetry: () => void;
  readonly scheduleAction?: BnUpratingRunAction;
  readonly rescheduleAction?: BnUpratingRunAction;
  readonly cancelAction?: BnUpratingRunAction;
  readonly onSchedule: () => void;
  readonly onReschedule: () => void;
  readonly onCancel: () => void;
}

export const BnUpratingExecutionScheduleSection: React.FC<Props> = ({
  readiness,
  schedules,
  isLoading,
  isError,
  onRetry,
  scheduleAction,
  rescheduleAction,
  cancelAction,
  onSchedule,
  onReschedule,
  onCancel,
}) => {
  if (isError) {
    return (
      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Scheduling information could not be loaded</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>This section could not be loaded. The rest of the run is unaffected.</p>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading || !readiness) {
    return <p className="text-sm text-muted-foreground">Loading execution schedule…</p>;
  }

  const current = readiness.current_schedule;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Execution schedule</CardTitle>
            <CardDescription>
              Scheduling records the intent to execute an approved run later. Batch execution itself is
              delivered in a later stage — nothing here changes an award or a payment.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {scheduleAction && (
              <Button
                size="sm"
                disabled={!scheduleAction.available}
                title={scheduleAction.reason ?? undefined}
                onClick={onSchedule}
              >
                <CalendarClock className="mr-2 h-4 w-4" />
                {scheduleAction.label}
              </Button>
            )}
            {rescheduleAction && (
              <Button
                size="sm"
                variant="outline"
                disabled={!rescheduleAction.available}
                title={rescheduleAction.reason ?? undefined}
                onClick={onReschedule}
              >
                {rescheduleAction.label}
              </Button>
            )}
            {cancelAction && (
              <Button
                size="sm"
                variant="outline"
                disabled={!cancelAction.available}
                title={cancelAction.reason ?? undefined}
                onClick={onCancel}
              >
                {cancelAction.label}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {readiness.blockers.length > 0 && !current && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Not ready for scheduling</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {readiness.blockers.map((b) => (
                    <li key={b.code}>{b.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {current ? (
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Planned execution</p>
                <p className="font-medium">{new Date(current.planned_execution_at).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Time zone</p>
                <p className="font-medium">{current.time_zone}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Batch size</p>
                <p className="font-medium">{current.batch_size ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Concurrent batches</p>
                <p className="font-medium">{current.max_concurrent_batches ?? '—'}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No execution schedule has been recorded.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule history</CardTitle>
          <CardDescription>Every scheduling decision, including supersedes and cancellations.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Planned</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recorded by</TableHead>
                <TableHead>Reason / notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No scheduling history.
                  </TableCell>
                </TableRow>
              )}
              {schedules.map((s) => (
                <TableRow key={s.schedule_id}>
                  <TableCell>v{s.schedule_version}</TableCell>
                  <TableCell>
                    {new Date(s.planned_execution_at).toLocaleString()} ({s.time_zone})
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        s.status === 'PLANNED' || s.status === 'DUE'
                          ? 'secondary'
                          : s.status === 'CANCELLED'
                            ? 'destructive'
                            : 'outline'
                      }
                    >
                      {s.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{s.created_by_name ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {s.cancelled_reason ?? s.notes ?? '—'}
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
