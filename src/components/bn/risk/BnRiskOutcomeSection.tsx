/**
 * BN Risk — governed outcome section (EPIC 5).
 *
 * Answers one question: has this assessment reached a governed conclusion, and
 * if not, what is still outstanding? Readiness, blockers, the outcome
 * catalogue and the recorded outcome all come from
 * `bn_risk_outcome_readiness_v1`. Nothing is derived here.
 *
 * The outcome is never inferred from a score, a band, a recommendation or an
 * applied control: an officer selects it explicitly. A recorded outcome is
 * immutable — a correction is shown as a superseding record and the previous
 * outcome remains visible with its author.
 */
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
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
  type BnRiskOutcomeReadinessV1,
} from '@/types/bn/risk/riskOutcome';
import { BnRiskOutcomeDialog } from './BnRiskOutcomeDialog';

interface Props {
  assessmentId: string;
  onChanged: () => void;
}

export const BnRiskOutcomeSection: React.FC<Props> = ({ assessmentId, onChanged }) => {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = React.useState<'RECORD' | 'CORRECT' | null>(null);

  const readiness = useQuery({
    queryKey: ['bn-risk-outcome-readiness', assessmentId],
    queryFn: async () => {
      const result = await riskOutcomeService.outcomeReadiness(assessmentId);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  /**
   * A completed outcome changes the assessment state, the closure position and
   * every operational queue. The backend owns the resulting state; the client
   * only re-reads it.
   */
  const refresh = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['bn-risk-outcome-readiness', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-closure-readiness', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-outcome-queue'] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-control-execution-queue'] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-queue'] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-person-safe-summary'] });
    onChanged();
  }, [assessmentId, onChanged, queryClient]);

  if (readiness.isLoading) return <Skeleton className="h-40 w-full" />;

  /**
   * Fail closed. A readiness query that could not be answered is never shown
   * as "no blockers", and no outcome action is offered.
   */
  if (readiness.isError || !readiness.data) {
    return (
      <Card data-testid="bn-risk-outcome-section" data-state="FAILED_TO_LOAD">
        <CardHeader><CardTitle>Outcome</CardTitle></CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Outcome readiness is unavailable</AlertTitle>
            <AlertDescription>
              No outcome can be recorded until this can be checked again. Nothing has changed,
              and this does not mean the assessment is ready.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const data: BnRiskOutcomeReadinessV1 = readiness.data;
  const current = data.current_outcome;
  const superseded = data.outcome_history.filter((h) => h.status !== 'CURRENT');
  const canRecord = data.available_actions.includes('RECORD_OUTCOME');
  const canCorrect = data.available_actions.includes('CORRECT_OUTCOME');

  return (
    <Card data-testid="bn-risk-outcome-section" data-state={data.state}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" /> Outcome
          </CardTitle>
          <CardDescription>
            What this assessment concluded, recorded explicitly by an officer. The outcome does
            not change any factor, evidence item, score, recommendation, approval or control
            already recorded.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRecord && (
            <Button size="sm" data-testid="bn-risk-outcome-record" onClick={() => setDialog('RECORD')}>
              Record outcome
            </Button>
          )}
          {canCorrect && (
            <Button
              size="sm"
              variant="outline"
              data-testid="bn-risk-outcome-correct"
              onClick={() => setDialog('CORRECT')}
            >
              Correct outcome
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {data.state === 'DENIED' && (
          <Alert data-testid="bn-risk-outcome-denied">
            <AlertTitle>Read only</AlertTitle>
            <AlertDescription>
              You can review this assessment but you cannot record a Risk outcome.
            </AlertDescription>
          </Alert>
        )}

        {data.state === 'NOT_READY' && (
          <p className="text-sm text-muted-foreground" data-testid="bn-risk-outcome-not-ready">
            The assessment has not reached the outcome stage.
          </p>
        )}

        {data.blockers.length > 0 && (
          <Alert variant="destructive" data-testid="bn-risk-outcome-blockers">
            <AlertTitle>An outcome cannot be recorded yet</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">{data.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </AlertDescription>
          </Alert>
        )}

        {data.warnings.map((w) => (
          <Alert key={w} data-testid="bn-risk-outcome-warning">
            <AlertDescription>{w}</AlertDescription>
          </Alert>
        ))}

        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Assessment state</p>
            <p data-testid="bn-risk-outcome-assessment-status">{data.assessment_status}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Control work</p>
            <p data-testid="bn-risk-outcome-control-position">
              {data.all_controls_executed
                ? 'All approved controls have been actioned'
                : 'An approved control is still outstanding'}
              {data.failed_executions > 0
                ? ` · ${data.failed_executions} unresolved failure(s)`
                : ''}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Referrals</p>
            <p data-testid="bn-risk-outcome-referral-position">
              {data.all_referrals_settled
                ? 'No referral is awaiting acceptance'
                : 'A referral is awaiting acceptance by the owning module'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Next action</p>
            <p data-testid="bn-risk-outcome-next-action">
              {canRecord ? 'Record the governed outcome'
                : canCorrect ? 'Review the recorded outcome, or record a correction'
                  : data.state === 'DENIED' ? 'No action is available to you'
                    : 'Resolve the outstanding work above'}
            </p>
          </div>
        </div>

        {current && (
          <div
            className="space-y-3 rounded-md border p-3"
            data-testid="bn-risk-outcome-summary"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{current.outcome_label}</Badge>
              <Badge variant="outline" data-testid="bn-risk-outcome-summary-finding">
                {findingClassificationLabel(current.finding_classification)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Recorded outcomes cannot be edited
              </span>
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground">Disposition</p>
                <p>{current.disposition_label ?? 'Not applicable'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Reason</p>
                <p>{current.reason_label ?? '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Recorded by</p>
                <p data-testid="bn-risk-outcome-recorded-by">
                  {current.recorded_by_name ?? '—'} ·{' '}
                  {formatAuditDate(current.recorded_at, false)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Unresolved control handling</p>
                <p>{current.unresolved_control_disposition ?? 'Not applicable'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">External reference</p>
                <p>{current.external_outcome_reference ?? '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Financial impact recorded elsewhere</p>
                <p>
                  {current.financial_impact_reference
                    ? `${current.financial_impact_module ?? 'Owning domain'} · ${current.financial_impact_reference}`
                    : 'None recorded'}
                </p>
              </div>
            </div>
            {data.restricted_detail_visible && current.justification && (
              <div className="text-sm">
                <p className="text-muted-foreground">Justification</p>
                <p data-testid="bn-risk-outcome-justification-text">{current.justification}</p>
              </div>
            )}
          </div>
        )}

        {superseded.length > 0 && (
          <div className="space-y-2" data-testid="bn-risk-outcome-history">
            <p className="text-sm font-medium">Previous outcomes — retained</p>
            {superseded.map((h) => (
              <div key={h.outcome_id} className="rounded-md border p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{h.outcome_label}</span>
                  <Badge variant="outline">
                    {h.status === 'SUPERSEDED' ? 'Superseded' : 'Earlier review phase'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {findingClassificationLabel(h.finding_classification)} · recorded by{' '}
                  {h.recorded_by_name ?? '—'} on {formatAuditDate(h.recorded_at, false)}
                  {h.correction_reason_label ? ` · corrected: ${h.correction_reason_label}` : ''}
                  {h.superseded_at
                    ? ` · superseded ${formatAuditDate(h.superseded_at, false)}`
                    : ''}
                </p>
              </div>
            ))}
          </div>
        )}

        {data.execution_summary.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <Table data-testid="bn-risk-outcome-control-summary">
              <TableHeader>
                <TableRow>
                  <TableHead>Approved control</TableHead>
                  <TableHead>Owning domain</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.execution_summary.map((c) => (
                  <TableRow key={`${c.recommendation_id}-${c.execution_id ?? 'none'}`}>
                    <TableCell>{c.control_label ?? c.control_code}</TableCell>
                    <TableCell>{c.target_module ?? 'Risk'}</TableCell>
                    <TableCell>
                      {c.execution_status_label ?? c.execution_status}
                    </TableCell>
                    <TableCell>{c.target_business_reference ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {dialog && (
        <BnRiskOutcomeDialog
          open={dialog !== null}
          onOpenChange={(o) => !o && setDialog(null)}
          assessmentId={assessmentId}
          mode={dialog}
          readiness={data}
          onCompleted={refresh}
        />
      )}
    </Card>
  );
};
