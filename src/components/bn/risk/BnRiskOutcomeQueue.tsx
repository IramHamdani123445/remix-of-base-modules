/**
 * BN Risk — outcome and closure operational queue (EPIC 5).
 *
 * Every row, bucket and count comes from `bn_risk_outcome_queue_v1`. Nothing
 * is aggregated in the browser, and a failed query is never rendered as an
 * empty queue with a zero count.
 *
 * Privacy: the ordinary queue never becomes a list of fraud outcomes. Outcome
 * and finding detail appear only when the backend publishes them for the
 * caller; otherwise the row shows a safe stage and action label.
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
import { riskOutcomeService } from '@/services/bn/risk/riskOutcomeService';
import {
  findingClassificationLabel,
  type BnRiskOutcomeQueueBucket,
} from '@/types/bn/risk/riskOutcome';

const BUCKETS: ReadonlyArray<{ code: BnRiskOutcomeQueueBucket | 'ALL'; label: string }> = [
  { code: 'ALL', label: 'All' },
  { code: 'READY_FOR_OUTCOME', label: 'Ready for outcome' },
  { code: 'OUTCOME_BLOCKED', label: 'Outcome blocked' },
  { code: 'READY_TO_CLOSE', label: 'Ready to close' },
  { code: 'CLOSED', label: 'Closed' },
  { code: 'REOPENED', label: 'Reopened' },
];

interface Props {
  /** Deep link into the assessment workspace, focused on outcome or closure. */
  onOpenAssessment: (assessmentId: string, section: 'outcome' | 'closure') => void;
}

export const BnRiskOutcomeQueue: React.FC<Props> = ({ onOpenAssessment }) => {
  const [bucket, setBucket] = React.useState<BnRiskOutcomeQueueBucket | 'ALL'>('ALL');
  const [page, setPage] = React.useState(1);

  const queue = useQuery({
    queryKey: ['bn-risk-outcome-queue', bucket, page],
    queryFn: async () => {
      const result = await riskOutcomeService.outcomeQueue(
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
      <Alert variant="destructive" data-testid="bn-risk-outcome-queue-error">
        <AlertTitle>The outcome queue could not be loaded</AlertTitle>
        <AlertDescription>
          Nothing has changed, and this does not mean there is no outstanding work. Please retry.
        </AlertDescription>
      </Alert>
    );
  }

  const { rows, total, page_size: pageSize, bucket_counts: counts } = queue.data;
  const restricted = queue.data.restricted_detail_visible;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const columnCount = restricted ? 10 : 8;

  return (
    <Card data-testid="bn-risk-outcome-queue">
      <CardHeader>
        <CardTitle>Outcomes &amp; closure</CardTitle>
        <CardDescription>
          Assessments that have reached the conclusion stage: awaiting an outcome, blocked by
          outstanding control work, ready to close, closed, or reopened for a new review phase.
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
                <TableHead>Current stage</TableHead>
                {restricted && <TableHead>Outcome</TableHead>}
                {restricted && <TableHead>Finding</TableHead>}
                <TableHead>Closure</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Action required</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columnCount} className="text-center text-sm text-muted-foreground">
                    No assessment is awaiting an outcome or closure.
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
                  <TableCell>
                    <Badge variant="secondary">{row.stage_label}</Badge>
                  </TableCell>
                  {restricted && <TableCell>{row.outcome_label ?? '—'}</TableCell>}
                  {restricted && (
                    <TableCell>
                      {row.finding_classification
                        ? findingClassificationLabel(row.finding_classification)
                        : '—'}
                    </TableCell>
                  )}
                  <TableCell>
                    {row.closed_at
                      ? `${formatAuditDate(row.closed_at, false)}${row.closed_by_name ? ` · ${row.closed_by_name}` : ''}`
                      : row.reopen_count > 0 ? `Reopened ${row.reopen_count} time(s)` : '—'}
                  </TableCell>
                  <TableCell>{row.assigned_owner_name ?? row.assigned_team_code ?? 'Unassigned'}</TableCell>
                  <TableCell>{row.age_days} day(s)</TableCell>
                  <TableCell>{row.action_required}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`bn-risk-outcome-queue-open-${row.assessment_id}`}
                      onClick={() => onOpenAssessment(
                        row.assessment_id,
                        row.bucket === 'READY_TO_CLOSE' || row.bucket === 'CLOSED'
                          ? 'closure'
                          : 'outcome',
                      )}
                    >
                      {row.bucket === 'READY_TO_CLOSE' || row.bucket === 'CLOSED'
                        ? 'Open closure'
                        : 'Open outcome'}
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
