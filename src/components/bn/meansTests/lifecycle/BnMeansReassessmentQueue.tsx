/**
 * MEANS-TEST EPIC 12 — reassessment work queue.
 *
 * Buckets (expired, overdue, due soon, change reported, scheduled) are
 * computed by `bn_means_reassessment_queue_v1`. This screen only presents
 * them; it never derives due dates or urgency in the browser.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import type { BnMeansReassessmentBucket, BnMeansReassessmentQueue } from '@/types/bn/meansTests/meansLifecycle';
import { humaniseMeansCode } from '@/types/bn/meansTests/meansFieldContract';

const BUCKETS: readonly { code: BnMeansReassessmentBucket | 'ALL'; label: string }[] = [
  { code: 'ALL', label: 'All' },
  { code: 'EXPIRED', label: 'Expired' },
  { code: 'OVERDUE', label: 'Overdue' },
  { code: 'DUE_SOON', label: 'Due soon' },
  { code: 'CHANGE_REPORTED', label: 'Change reported' },
  { code: 'SCHEDULED', label: 'Scheduled' },
];

const BUCKET_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  EXPIRED: 'destructive',
  OVERDUE: 'destructive',
  DUE_SOON: 'default',
  CHANGE_REPORTED: 'default',
  SCHEDULED: 'secondary',
};

export const BnMeansReassessmentQueuePanel: React.FC<{ onOpen: (assessmentId: string) => void }> = ({ onOpen }) => {
  const [bucket, setBucket] = React.useState<string>('ALL');

  const queue = useQuery({
    queryKey: ['bn-means-reassessment-queue', bucket],
    queryFn: () => meansQueryService.reassessmentQueue(bucket === 'ALL' ? {} : { bucket: bucket as never }),
  });

  return (
    <Card data-testid="means-reassessment-queue">
      <CardHeader>
        <CardTitle className="text-base">Reassessment queue</CardTitle>
        <CardDescription>
          Active assessments due for review, expired, or affected by a reported change of circumstance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={bucket} onValueChange={setBucket}>
          <TabsList className="flex flex-wrap">
            {BUCKETS.map((b) => (
              <TabsTrigger key={b.code} value={b.code} data-testid={`means-reassessment-bucket-${b.code}`}>
                {b.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {queue.isLoading && <Skeleton className="h-40" />}

        {!queue.isLoading && queue.data?.status === 'DENIED' && (
          <Alert variant="destructive" data-testid="means-reassessment-denied">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Access denied</AlertTitle>
            <AlertDescription>You do not hold the reassessment permission.</AlertDescription>
          </Alert>
        )}

        {!queue.isLoading && queue.data?.status === 'FAILED' && (
          <Alert variant="destructive" data-testid="means-reassessment-failed">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Queue unavailable</AlertTitle>
            <AlertDescription>{queue.data.detail ?? 'The reassessment queue could not be read.'}</AlertDescription>
          </Alert>
        )}

        {!queue.isLoading && queue.data?.status === 'OK' && (
          <QueueTable data={queue.data.data as BnMeansReassessmentQueue | null} onOpen={onOpen} />
        )}
      </CardContent>
    </Card>
  );
};

const QueueTable: React.FC<{
  data: BnMeansReassessmentQueue | null;
  onOpen: (assessmentId: string) => void;
}> = ({ data, onOpen }) => {
  const rows = data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
        data-testid="means-reassessment-empty">
        Nothing is waiting for reassessment in this bucket.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Reference</TableHead>
          <TableHead>Programme</TableHead>
          <TableHead>Bucket</TableHead>
          <TableHead>Valid until</TableHead>
          <TableHead>Review due</TableHead>
          <TableHead className="text-right">Open changes</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.assessment_id} data-testid={`means-reassessment-row-${row.assessment_reference}`}>
            <TableCell className="font-medium">{row.assessment_reference}</TableCell>
            <TableCell>{humaniseMeansCode(row.benefit_programme)}</TableCell>
            <TableCell>
              <Badge variant={BUCKET_VARIANT[row.bucket] ?? 'secondary'}>{humaniseMeansCode(row.bucket)}</Badge>
            </TableCell>
            <TableCell>{row.valid_until ?? '—'}</TableCell>
            <TableCell>
              {row.reassessment_due ?? '—'}
              {row.days_to_reassessment !== null && (
                <span className="ml-1 text-xs text-muted-foreground">({row.days_to_reassessment} d)</span>
              )}
            </TableCell>
            <TableCell className="text-right">{row.open_material_changes}</TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="outline" onClick={() => onOpen(row.assessment_id)}>Open</Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export default BnMeansReassessmentQueuePanel;
