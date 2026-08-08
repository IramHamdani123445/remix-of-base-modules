/**
 * BN Risk — closure and reopening section (EPIC 5).
 *
 * Driven entirely by `bn_risk_closure_readiness_v1`. Closure eligibility is
 * never inferred from `status === 'COMPLETED'`: the backend decides, and the
 * client renders. Reopening is presented as an administrative exception and is
 * only offered when the backend publishes it for this caller.
 */
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatAuditDate } from '@/lib/dateFormat';
import { riskOutcomeService } from '@/services/bn/risk/riskOutcomeService';
import {
  findingClassificationLabel,
  type BnRiskClosureReadiness,
} from '@/types/bn/risk/riskOutcome';
import { BnRiskClosureDialog } from './BnRiskClosureDialog';
import { BnRiskReopenDialog } from './BnRiskReopenDialog';

interface Props {
  assessmentId: string;
  assessmentReference: string;
  onChanged: () => void;
}

export const BnRiskClosureSection: React.FC<Props> = ({
  assessmentId, assessmentReference, onChanged,
}) => {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = React.useState<'CLOSE' | 'REOPEN' | null>(null);

  const readiness = useQuery({
    queryKey: ['bn-risk-closure-readiness', assessmentId],
    queryFn: async () => {
      const result = await riskOutcomeService.closureReadiness(assessmentId);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  const refresh = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['bn-risk-closure-readiness', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-outcome-readiness', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-outcome-queue'] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-queue'] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-person-safe-summary'] });
    onChanged();
  }, [assessmentId, onChanged, queryClient]);

  if (readiness.isLoading) return <Skeleton className="h-32 w-full" />;

  /** Fail closed — an unreadable readiness never becomes "ready to close". */
  if (readiness.isError || !readiness.data) {
    return (
      <Card data-testid="bn-risk-closure-section" data-state="FAILED_TO_LOAD">
        <CardHeader><CardTitle>Closure</CardTitle></CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Closure readiness is unavailable</AlertTitle>
            <AlertDescription>
              This assessment cannot be closed or reopened until this can be checked again.
              Nothing has changed.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const data: BnRiskClosureReadiness = readiness.data;
  const canClose = data.available_actions.includes('CLOSE');
  const canReopen = data.available_actions.includes('REOPEN');
  const closure = data.closure;

  return (
    <Card data-testid="bn-risk-closure-section" data-state={data.state}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-4 w-4" /> Closure
          </CardTitle>
          <CardDescription>
            Closing records that the Risk review is finished. The case history is retained in
            full and nothing is reversed in any owning domain.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {canClose && (
            <Button size="sm" data-testid="bn-risk-close" onClick={() => setDialog('CLOSE')}>
              Close Risk assessment
            </Button>
          )}
          {canReopen && (
            <Button
              size="sm"
              variant="outline"
              data-testid="bn-risk-reopen"
              onClick={() => setDialog('REOPEN')}
            >
              Reopen (exception)
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {data.state === 'DENIED' && (
          <Alert data-testid="bn-risk-closure-denied">
            <AlertTitle>Read only</AlertTitle>
            <AlertDescription>
              You can review this assessment but you cannot close it.
            </AlertDescription>
          </Alert>
        )}

        {data.state === 'ALREADY_CLOSED' && (
          <Alert data-testid="bn-risk-closed-posture">
            <AlertTitle>This assessment is closed</AlertTitle>
            <AlertDescription>
              It is shown as a historical record. Ordinary workflow actions are no longer
              available. Reopening is an exception and requires the{' '}
              {data.reopen_requires_capability} capability.
            </AlertDescription>
          </Alert>
        )}

        {data.blockers.length > 0 && data.state !== 'ALREADY_CLOSED' && (
          <Alert variant="destructive" data-testid="bn-risk-closure-blockers">
            <AlertTitle>This assessment cannot be closed yet</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">{data.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </AlertDescription>
          </Alert>
        )}

        {data.warnings.map((w) => (
          <Alert key={w} data-testid="bn-risk-closure-warning">
            <AlertDescription>{w}</AlertDescription>
          </Alert>
        ))}

        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Assessment state</p>
            <p data-testid="bn-risk-closure-status">{data.assessment_status}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Current outcome</p>
            <p data-testid="bn-risk-closure-outcome">
              {data.outcome ? data.outcome.outcome_label : 'No outcome recorded yet'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Finding</p>
            <p>
              {data.outcome
                ? findingClassificationLabel(data.outcome.finding_classification)
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Times reopened</p>
            <p data-testid="bn-risk-closure-reopen-count">{data.reopen_count}</p>
          </div>
        </div>

        {closure && (
          <div className="space-y-1 rounded-md border p-3 text-sm" data-testid="bn-risk-closure-record">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {closure.status === 'REOPENED' ? 'Closed, then reopened' : 'Closed'}
              </Badge>
              <span className="text-xs text-muted-foreground">Review phase {closure.phase_no}</span>
            </div>
            <p>
              Assessment closed by {closure.closed_by_name ?? '—'} on{' '}
              {formatAuditDate(closure.closed_at, false)}
              {closure.closure_reason_label ? ` · ${closure.closure_reason_label}` : ''}
            </p>
            {closure.closure_note && (
              <p className="text-muted-foreground">{closure.closure_note}</p>
            )}
            {closure.reopened_at && (
              <p data-testid="bn-risk-closure-reopen-record">
                Assessment reopened by {closure.reopened_by_name ?? '—'} on{' '}
                {formatAuditDate(closure.reopened_at, false)}
                {closure.reopen_reason_label ? ` · ${closure.reopen_reason_label}` : ''}
                {closure.reopen_destination_status
                  ? ` · resumed at ${closure.reopen_destination_status}`
                  : ''}
              </p>
            )}
          </div>
        )}
      </CardContent>

      {dialog === 'CLOSE' && (
        <BnRiskClosureDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          assessmentId={assessmentId}
          assessmentReference={assessmentReference}
          readiness={data}
          onCompleted={refresh}
        />
      )}

      {dialog === 'REOPEN' && (
        <BnRiskReopenDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          assessmentId={assessmentId}
          assessmentReference={assessmentReference}
          readiness={data}
          onCompleted={refresh}
        />
      )}
    </Card>
  );
};
