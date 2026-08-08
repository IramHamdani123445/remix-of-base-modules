/**
 * BN Uprating — Operational execution queue (Epic 3).
 *
 * Backend-driven operational view of runs that are due, executing, partially
 * executed or complete. Read-only: every action is taken inside the run
 * workspace behind the governed boundary.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchUpratingExecutionQueue } from '@/services/bn/uprating/upratingRunService';
import { formatMinor, type BnUpratingExecutionQueueRow } from '@/types/bn/uprating/upratingRun';

interface Props {
  readonly onOpenRun?: (runId: string) => void;
}

const statusVariant = (status: string): 'default' | 'secondary' | 'outline' | 'destructive' => {
  if (status === 'COMPLETED') return 'secondary';
  if (status === 'PARTIAL' || status === 'FAILED') return 'destructive';
  if (status === 'EXECUTING') return 'default';
  return 'outline';
};

const progressOf = (r: BnUpratingExecutionQueueRow): number => {
  if (!r.planned_item_count) return 0;
  const done = r.applied_item_count + r.failed_item_count;
  return Math.min(100, Math.round((done / r.planned_item_count) * 100));
};

export const BnUpratingExecutionQueue: React.FC<Props> = ({ onOpenRun }) => {
  const queueQuery = useQuery({
    queryKey: ['bn-uprating-execution-queue'],
    queryFn: () => fetchUpratingExecutionQueue({}),
  });

  const failed = queueQuery.status === 'error' || queueQuery.data?.status === 'ERROR';
  const rows = failed ? [] : queueQuery.data?.data?.rows ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution queue</CardTitle>
        <CardDescription>
          Scheduled, executing and completed uprating runs. Figures come from the frozen approved
          package — nothing on this screen recalculates an amount.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {failed && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            The execution queue could not be loaded. This is not an empty queue — please retry.
          </p>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead className="text-right">Applied / failed</TableHead>
                <TableHead className="text-right">Applied change</TableHead>
                <TableHead>Timing</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {queueQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    Loading execution queue…
                  </TableCell>
                </TableRow>
              )}
              {!queueQuery.isLoading && rows.length === 0 && !failed && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No runs are scheduled, executing or complete.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.run_id}>
                  <TableCell>
                    <div className="font-medium">{r.run_reference}</div>
                    <div className="text-xs text-muted-foreground">{r.run_name ?? '—'}</div>
                  </TableCell>
                  <TableCell>{r.target_effective_date}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(r.status)}>{r.status_label ?? r.status}</Badge>
                  </TableCell>
                  <TableCell className="min-w-[9rem]">
                    <Progress value={progressOf(r)} className="h-2" />
                    <div className="mt-1 text-xs text-muted-foreground">
                      {r.completed_batch_count}/{r.planned_batch_count} batches
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.applied_item_count} / {r.failed_item_count}
                    <div className="text-xs text-muted-foreground">
                      of {r.planned_item_count} planned
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMinor(r.applied_delta_total_minor)}
                    <div className="text-xs text-muted-foreground">
                      approved {formatMinor(r.approved_delta_total_minor)}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div>
                      Planned:{' '}
                      {r.planned_execution_at
                        ? new Date(r.planned_execution_at).toLocaleString()
                        : '—'}
                    </div>
                    <div>
                      Started:{' '}
                      {r.execution_started_at
                        ? new Date(r.execution_started_at).toLocaleString()
                        : '—'}
                    </div>
                    <div>
                      Finished:{' '}
                      {r.execution_completed_at
                        ? new Date(r.execution_completed_at).toLocaleString()
                        : '—'}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {onOpenRun && (
                      <Button size="sm" variant="outline" onClick={() => onOpenRun(r.run_id)}>
                        Open
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
