/**
 * BN Risk — independent control approval queue (EPIC 3).
 *
 * Safe action labels only: the queue tells an approver that a decision is
 * required, not that a payment hold or a legal referral has been recommended.
 * Sensitive control detail is published by the backend only where the caller
 * holds the restricted Risk permission, and is otherwise absent. Opening an
 * item deep links straight to the assessment approval section.
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
import { riskControlService } from '@/services/bn/risk/riskControlService';

interface Props {
  /** Deep link into the assessment workspace, focused on approval. */
  onOpenApproval: (assessmentId: string) => void;
}

export const BnRiskControlApprovalQueue: React.FC<Props> = ({ onOpenApproval }) => {
  const [page, setPage] = React.useState(1);

  const queue = useQuery({
    queryKey: ['bn-risk-control-approval-queue', page],
    queryFn: async () => {
      const result = await riskControlService.approvalQueue({}, page, 20);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  if (queue.isLoading) return <Skeleton className="h-64 w-full" />;

  if (queue.isError || !queue.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>The approval queue could not be loaded</AlertTitle>
        <AlertDescription>Nothing has changed. Please retry.</AlertDescription>
      </Alert>
    );
  }

  const { rows, total, page_size: pageSize } = queue.data;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Card data-testid="bn-risk-control-approval-queue">
      <CardHeader>
        <CardTitle>Control decisions</CardTitle>
        <CardDescription>
          Recommendations awaiting an independent decision. You cannot decide a
          recommendation you made yourself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assessment</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Programme</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Recommended by</TableHead>
                <TableHead>Decision age</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Action required</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                    No recommendation is awaiting a decision.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.recommendation_id}>
                  <TableCell className="font-medium">{row.assessment_reference}</TableCell>
                  <TableCell>
                    {row.person_name ?? '—'}
                    {row.person_ssn_masked ? ` · ${row.person_ssn_masked}` : ''}
                  </TableCell>
                  <TableCell>{row.programme_context ?? '—'}</TableCell>
                  <TableCell>{formatAuditDate(row.recommended_at, false)}</TableCell>
                  <TableCell>{row.recommended_by_name ?? '—'}</TableCell>
                  <TableCell>{row.decision_age_days} day(s)</TableCell>
                  <TableCell>{row.assigned_team_code ?? 'Unassigned'}</TableCell>
                  <TableCell>
                    <Badge variant={row.is_own_recommendation ? 'outline' : 'secondary'}>
                      {row.is_own_recommendation
                        ? 'Awaiting another approver'
                        : row.action_label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline"
                      onClick={() => onOpenApproval(row.assessment_id)}>
                      Open decision
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
