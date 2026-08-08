/**
 * BN Uprating — Post-execution operational queue (Epic 4).
 *
 * Backend-owned work list for runs that have executed. Buckets, labels and
 * counts all come from `bn_uprating_operational_queue_v1`; nothing on this
 * screen invents a status. Rows deep-link into the exact workspace section
 * where the next governed action lives.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchUpratingOperationalQueue } from '@/services/bn/uprating/upratingRunService';
import {
  formatMinor,
  type BnUpratingOperationalQueueRow,
} from '@/types/bn/uprating/upratingRun';

export interface BnUpratingOperationalQueueProps {
  readonly onOpenRun?: (runId: string, section: 'reconciliation' | 'rollback') => void;
}

const bucketVariant = (
  code: string,
): 'default' | 'secondary' | 'outline' | 'destructive' => {
  if (code === 'RECONCILED' || code === 'ROLLED_BACK') return 'secondary';
  if (code === 'RECONCILIATION_BLOCKED' || code === 'ROLLBACK_BLOCKED') return 'destructive';
  if (code === 'ROLLBACK_ASSESSMENT_REQUIRED' || code === 'ROLLBACK_AWAITING_AUTHORISATION') {
    return 'default';
  }
  return 'outline';
};

const nextStep = (r: BnUpratingOperationalQueueRow): string => {
  switch (r.bucket_code) {
    case 'SCHEDULE_REBUILD_REQUIRED':
      return 'Rebuild affected schedules';
    case 'COMMUNICATION_PENDING':
      return 'Issue Uprating communications';
    case 'READY_TO_RECONCILE':
      return 'Reconcile run';
    case 'RECONCILIATION_BLOCKED':
      return 'Review reconciliation findings';
    case 'ROLLBACK_ASSESSMENT_REQUIRED':
      return 'Assess rollback eligibility';
    case 'ROLLBACK_AWAITING_AUTHORISATION':
      return 'Independent rollback authorisation';
    case 'ROLLBACK_IN_PROGRESS':
    case 'ROLLBACK_BLOCKED':
      return 'Resolve owning-domain blockers';
    case 'RECONCILED':
      return 'Awaiting closure';
    case 'ROLLED_BACK':
    default:
      return 'No further Uprating action';
  }
};

export const BnUpratingOperationalQueue: React.FC<BnUpratingOperationalQueueProps> = ({
  onOpenRun,
}) => {
  const [bucket, setBucket] = React.useState<string | null>(null);

  const queueQuery = useQuery({
    queryKey: ['bn-uprating-operational-queue', bucket],
    queryFn: () => fetchUpratingOperationalQueue(bucket ? { bucket_code: bucket } : {}),
  });

  const failed = queueQuery.status === 'error' || queueQuery.data?.status === 'ERROR';
  const rows = failed ? [] : queueQuery.data?.data?.rows ?? [];
  const summary = failed ? [] : queueQuery.data?.data?.summary ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Post-execution queue</CardTitle>
        <CardDescription>
          Runs that have executed and still need schedule consequences, claimant notices,
          reconciliation or rollback attention. Every bucket is derived by the backend from the
          authoritative records.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {failed && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            The post-execution queue could not be loaded. This is not an empty queue — please retry.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={bucket === null ? 'default' : 'outline'}
            onClick={() => setBucket(null)}
          >
            All
          </Button>
          {summary.map((s) => (
            <Button
              key={s.bucket_code}
              size="sm"
              variant={bucket === s.bucket_code ? 'default' : 'outline'}
              onClick={() => setBucket(s.bucket_code)}
            >
              {s.bucket_label} ({s.run_count})
            </Button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Next step</TableHead>
                <TableHead className="text-right">Applied / failed</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Applied change</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {queueQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Loading post-execution queue…
                  </TableCell>
                </TableRow>
              )}
              {!queueQuery.isLoading && rows.length === 0 && !failed && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No runs are awaiting post-execution work.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.run_id}>
                  <TableCell>
                    <div className="font-medium">{r.run_reference}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.run_name ?? '—'} · effective {r.target_effective_date}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={bucketVariant(r.bucket_code)}>{r.bucket_label}</Badge>
                    <div className="text-xs text-muted-foreground">
                      {r.status_label ?? r.status}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{nextStep(r)}</TableCell>
                  <TableCell className="text-right">
                    {r.applied_item_count} / {r.failed_item_count}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    <div>{r.schedule_outstanding_count} schedule</div>
                    <div>{r.communication_outstanding_count} notices</div>
                    {r.blocking_finding_count > 0 && (
                      <div className="text-destructive">
                        {r.blocking_finding_count} blocking finding(s)
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMinor(r.applied_delta_total_minor)}
                  </TableCell>
                  <TableCell className="text-right">
                    {onOpenRun && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenRun(r.run_id, r.workspace_section)}
                      >
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
