import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, CheckCircle2, RefreshCw, Route } from 'lucide-react';
import { useStageQueueReconciliation } from '@/hooks/bn/useStageQueueReconciliation';

interface Props {
  /** Summary only, for configuration validation screens. */
  compact?: boolean;
}

/**
 * Reports claims whose lifecycle stage disagrees with the queue that owns
 * them — the class of defect that let an award-setup claim sit in a payment
 * queue unnoticed.
 */
export function StageQueueHealthPanel({ compact = false }: Props) {
  const { data, isLoading, isFetching, refetch, error } = useStageQueueReconciliation();

  const mismatches = data?.mismatches ?? [];
  const healthy = !isLoading && !error && mismatches.length === 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Route className="h-4 w-4" />
          Stage vs Queue Health
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Reconciling claim stages against their queues…</p>
        ) : error ? (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <span>{(error as Error).message}</span>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2 text-sm">
              {healthy ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary" />
                  <span>
                    All {data?.checked ?? 0} open assignments sit in a queue that serves their stage
                    {data?.expectedHolds ? ` (${data.expectedHolds} deliberately parked).` : '.'}
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive" />
                  <span>
                    {mismatches.length} claim{mismatches.length === 1 ? '' : 's'} sit in a queue that does
                    not serve their stage. The workflow step for that stage names the wrong queue, or the
                    stage has no step at all.
                  </span>
                </>
              )}
            </div>

            {!compact && mismatches.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claim</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Owning queue</TableHead>
                    <TableHead>Cause</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mismatches.map((m) => (
                    <TableRow key={m.claimId}>
                      <TableCell className="font-mono text-xs">{m.claimNumber ?? m.claimId}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{m.status ?? '—'}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{m.stage ?? '—'}</TableCell>
                      <TableCell className="text-xs">{m.basketName ?? m.basketCode ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{m.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default StageQueueHealthPanel;
