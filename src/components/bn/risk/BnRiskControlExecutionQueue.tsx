/**
 * BN Risk — approved control execution queue (EPIC 4).
 *
 * Operational view of approved controls awaiting execution, in progress with
 * the owning domain, failed, retryable, or awaiting a referral response.
 * Safe labels only: the queue states that an action is required, never that a
 * benefit action has been applied. Sensitive control detail appears only when
 * the backend publishes it for the caller.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatAuditDate } from '@/lib/dateFormat';
import { riskControlExecutionService } from '@/services/bn/risk/riskControlExecutionService';
import type { BnRiskExecutionQueueBucket } from '@/types/bn/risk/riskControlExecution';

const BUCKETS: ReadonlyArray<{ code: BnRiskExecutionQueueBucket | 'ALL'; label: string }> = [
  { code: 'ALL', label: 'All' },
  { code: 'AWAITING_EXECUTION', label: 'Awaiting execution' },
  { code: 'IN_PROGRESS', label: 'In progress' },
  { code: 'FAILED', label: 'Failed' },
  { code: 'RETRY_AVAILABLE', label: 'Retry available' },
  { code: 'REFERRAL_PENDING', label: 'Referral pending' },
  { code: 'REJECTED_BY_TARGET', label: 'Rejected by owning domain' },
  { code: 'AWAITING_OUTCOME', label: 'Awaiting outcome' },
];

interface Props {
  /** Deep link into the assessment workspace, focused on execution. */
  onOpenExecution: (assessmentId: string) => void;
}

export const BnRiskControlExecutionQueue: React.FC<Props> = ({ onOpenExecution }) => {
  const [bucket, setBucket] = React.useState<BnRiskExecutionQueueBucket | 'ALL'>('ALL');
  const [page, setPage] = React.useState(1);

  const queue = useQuery({
    queryKey: ['bn-risk-control-execution-queue', bucket, page],
    queryFn: async () => {
      const result = await riskControlExecutionService.executionQueue(
        bucket === 'ALL' ? {} : { bucket },
        page,
        20,
      );
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  if (queue.isLoading) return <Skeleton className="h-64 w-full" />;

  if (queue.isError || !queue.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>The execution queue could not be loaded</AlertTitle>
        <AlertDescription>Nothing has changed. Please retry.</AlertDescription>
      </Alert>
    );
  }

  const { rows, total, page_size: pageSize, bucket_counts: counts } = queue.data;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Card data-testid="bn-risk-control-execution-queue">
      <CardHeader>
        <CardTitle>Control execution</CardTitle>
        <CardDescription>
          Approved controls awaiting execution or a response from the owning domain. Risk records
          the reference and status the owning domain returns.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {BUCKETS.map((b) => (
            <Button
              key={b.code}
              size="sm"
              variant={bucket === b.code ? 'default' : 'outline'}
              onClick={() => { setBucket(b.code); setPage(1); }}
            >
              {b.label}
              {b.code !== 'ALL' && counts?.[b.code] !== undefined && (
                <span className="ml-1 text-xs">({counts[b.code]})</span>
              )}
            </Button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assessment</TableHead>
                <TableHead>Person</TableHead>
                {queue.data.restricted_detail_visible && <TableHead>Control</TableHead>}
                <TableHead>Owning domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Action required</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={queue.data.restricted_detail_visible ? 10 : 9}
                    className="text-center text-sm text-muted-foreground"
                  >
                    No approved control is awaiting execution.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.assessment_id}>
                  <TableCell className="font-medium">{row.assessment_reference}</TableCell>
                  <TableCell>
                    {row.person_name ?? '—'}
                    {row.person_masked_identifier ? ` · ${row.person_masked_identifier}` : ''}
                  </TableCell>
                  {queue.data.restricted_detail_visible && (
                    <TableCell>{row.control_label ?? row.control_code ?? '—'}</TableCell>
                  )}
                  <TableCell>{row.target_module ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{row.execution_status_label}</Badge>
                  </TableCell>
                  <TableCell>
                    {row.approved_at ? formatAuditDate(row.approved_at, false) : '—'}
                  </TableCell>
                  <TableCell>{row.age_days} day(s)</TableCell>
                  <TableCell>
                    {row.assigned_owner_name ?? row.assigned_team_code ?? 'Unassigned'}
                  </TableCell>
                  <TableCell>{row.action_required}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onOpenExecution(row.assessment_id)}
                    >
                      Open execution
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total} item(s)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= pageCount}
              onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
