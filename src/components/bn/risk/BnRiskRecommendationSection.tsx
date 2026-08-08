/**
 * BN Risk — control recommendation section (EPIC 3).
 *
 * Drives entirely from `bn_risk_recommendation_readiness_v1` and
 * `bn_risk_recommendation_history_v1`. The section shows the assessment
 * position, both increasing and reducing factors, evidence and the current
 * score band, then lets the officer make an explicit human recommendation.
 * It never derives readiness, never maps a score to a control and never
 * executes anything.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { formatAuditDate } from '@/lib/dateFormat';
import { riskControlService } from '@/services/bn/risk/riskControlService';
import {
  controlExecutionNotice,
  type BnRiskRecommendationSectionState,
} from '@/types/bn/risk/riskControl';
import { BnRiskRecommendationDialog } from './BnRiskRecommendationDialog';

interface TargetOption {
  readonly type: string;
  readonly id: string | null;
  readonly reference: string | null;
  readonly label: string;
}

interface Props {
  assessmentId: string;
  /** Backend-published action availability (`bn_risk_assessment_actions_v1`). */
  isActionEnabled: (action: 'RECOMMEND_CONTROL' | 'WITHDRAW_RECOMMENDATION') => boolean;
  targetOptions: readonly TargetOption[];
  onChanged: () => void;
}

export const BnRiskRecommendationSection: React.FC<Props> = ({
  assessmentId, isActionEnabled, targetOptions, onChanged,
}) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const readiness = useQuery({
    queryKey: ['bn-risk-recommendation-readiness', assessmentId],
    queryFn: async () => {
      const result = await riskControlService.recommendationReadiness(assessmentId);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  const history = useQuery({
    queryKey: ['bn-risk-recommendation-history', assessmentId],
    queryFn: async () => {
      const result = await riskControlService.recommendationHistory(assessmentId);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  const refresh = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['bn-risk-recommendation-readiness', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-recommendation-history', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-control-approval-readiness', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-control-approval-queue'] });
    onChanged();
  }, [assessmentId, onChanged, queryClient]);

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      const result = await riskControlService.withdrawRecommendation({
        assessmentId,
        expectedRowVersion: readiness.data?.assessment_row_version ?? null,
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The recommendation could not be withdrawn.');
      }
      return result;
    },
    onSuccess: () => { setError(null); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  if (readiness.isLoading) return <Skeleton className="h-48 w-full" />;

  if (readiness.isError || !readiness.data) {
    return (
      <Card>
        <CardHeader><CardTitle>Control recommendation</CardTitle></CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Recommendation readiness is unavailable</AlertTitle>
            <AlertDescription>
              No recommendation can be made until this can be checked again. Nothing has changed.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const data = readiness.data;
  const current = history.data?.current ?? null;

  const state: BnRiskRecommendationSectionState = (() => {
    if (current?.status === 'PENDING_APPROVAL') return 'PENDING_APPROVAL';
    if (current?.status === 'APPROVED') return 'APPROVED';
    if (current?.status === 'REJECTED') return 'REJECTED';
    if (current?.status === 'RETURNED') return 'RETURNED';
    if (data.score.is_stale) return 'STALE';
    if (data.can_recommend) return 'READY';
    if (!current) return 'NO_RECOMMENDATION';
    return 'BLOCKED';
  })();

  const canRecommend = data.can_recommend && isActionEnabled('RECOMMEND_CONTROL');
  const increasing = data.supporting_factors.filter((f) => f.direction_code !== 'REDUCES_CONCERN');
  const reducing = data.supporting_factors.filter((f) => f.direction_code === 'REDUCES_CONCERN');

  return (
    <Card data-testid="bn-risk-recommendation-section" data-state={state}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> Control recommendation
          </CardTitle>
          <CardDescription>
            A human judgement recorded against the assessment evidence. The score informs
            this recommendation; it does not choose it.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          {state === 'PENDING_APPROVAL' && isActionEnabled('WITHDRAW_RECOMMENDATION') && (
            <Button
              size="sm"
              variant="outline"
              disabled={withdrawMutation.isPending}
              onClick={() => withdrawMutation.mutate()}
            >
              Withdraw
            </Button>
          )}
          <Button size="sm" disabled={!canRecommend} onClick={() => { setError(null); setOpen(true); }}>
            Recommend control
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        {state === 'PENDING_APPROVAL' && current && (
          <Alert>
            <AlertTitle>{controlExecutionNotice(current.status, current.execution_state)}</AlertTitle>
            <AlertDescription>
              {current.control_label} was recommended by {current.recommended_by_name ?? 'an officer'}
              {' '}on {formatAuditDate(current.recommended_at, false)} and is frozen while it awaits
              independent approval. To change it, withdraw it and submit a new recommendation.
            </AlertDescription>
          </Alert>
        )}

        {state === 'RETURNED' && (
          <Alert>
            <AlertTitle>Returned for review</AlertTitle>
            <AlertDescription>
              The previous recommendation is retained. Review the factors, evidence and score,
              recalculate if required, then submit a new recommendation.
            </AlertDescription>
          </Alert>
        )}

        {state === 'REJECTED' && (
          <Alert>
            <AlertTitle>Control not authorised</AlertTitle>
            <AlertDescription>
              The recommendation and the decision are retained in the history below.
            </AlertDescription>
          </Alert>
        )}

        {state === 'APPROVED' && current && (
          <Alert>
            <AlertTitle>{controlExecutionNotice(current.status, current.execution_state)}</AlertTitle>
            <AlertDescription>
              {current.control_label} was approved by {current.decided_by_name ?? 'an approver'}.
              Execution is handled by a later governed step and has not happened.
            </AlertDescription>
          </Alert>
        )}

        {data.blockers.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>A recommendation cannot be made yet</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">{data.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </AlertDescription>
          </Alert>
        )}

        {data.warnings.length > 0 && (
          <Alert>
            <AlertDescription>
              <ul className="list-disc pl-4">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Current score</p>
            <p>{data.score.score ?? '—'} · {data.score.band_label ?? 'No band'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Factors increasing concern</p>
            <p>{increasing.length}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Factors reducing concern</p>
            <p>{reducing.length}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">Increasing concern</p>
            {increasing.length === 0 && <p className="text-sm text-muted-foreground">None recorded.</p>}
            {increasing.map((f) => (
              <p key={f.factor_id} className="text-sm text-muted-foreground">
                {f.label ?? f.factor_reference}{f.summary ? ` — ${f.summary}` : ''}
              </p>
            ))}
          </div>
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">Reducing concern (mitigating)</p>
            {reducing.length === 0 && <p className="text-sm text-muted-foreground">None recorded.</p>}
            {reducing.map((f) => (
              <p key={f.factor_id} className="text-sm text-muted-foreground">
                {f.label ?? f.factor_reference}{f.summary ? ` — ${f.summary}` : ''}
              </p>
            ))}
          </div>
        </div>

        {(history.data?.cycles.length ?? 0) > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Recommendation history</p>
            {history.data?.cycles.map((cycle) => (
              <div key={cycle.recommendation.recommendation_id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    Recommendation {cycle.recommendation.cycle_no} · {cycle.recommendation.control_label}
                  </span>
                  <Badge variant={cycle.recommendation.status === 'APPROVED' ? 'default' : 'secondary'}>
                    {controlExecutionNotice(
                      cycle.recommendation.status, cycle.recommendation.execution_state,
                    )}
                  </Badge>
                </div>
                <p className="text-muted-foreground">
                  {cycle.recommendation.reason_label ?? '—'} · recommended by{' '}
                  {cycle.recommendation.recommended_by_name ?? '—'} on{' '}
                  {formatAuditDate(cycle.recommendation.recommended_at, false)} · scoring{' '}
                  {cycle.recommendation.rule_set_code ?? '—'} v
                  {cycle.recommendation.rule_set_version_no ?? '—'}
                </p>
                {cycle.recommendation.justification && (
                  <p className="mt-1">{cycle.recommendation.justification}</p>
                )}
                {cycle.decisions.map((d) => (
                  <p key={d.decision_id} className="mt-1 text-muted-foreground">
                    {d.decision === 'APPROVE' ? 'Control approved'
                      : d.decision === 'REJECT' ? 'Control rejected' : 'Returned for review'}
                    {' '}by {d.decided_by_name ?? '—'} on {formatAuditDate(d.decided_at, false)}
                    {d.reason_label ? ` — ${d.reason_label}` : ''}
                    {d.decision_notes ? ` — ${d.decision_notes}` : ''}
                  </p>
                ))}
                <Collapsible>
                  <CollapsibleTrigger className="mt-2 text-xs text-muted-foreground underline">
                    Technical details
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    <p>Recommendation ID: {cycle.recommendation.recommendation_id}</p>
                    <p>Score ID: {cycle.recommendation.score_id ?? '—'}</p>
                    <p>Assessment version: {cycle.recommendation.assessment_row_version}</p>
                    <p>Control code: {cycle.recommendation.control_code}</p>
                    <p>Target: {cycle.recommendation.target_id ?? '—'}</p>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <BnRiskRecommendationDialog
        open={open}
        onOpenChange={setOpen}
        assessmentId={assessmentId}
        readiness={data}
        targetOptions={targetOptions}
        onCompleted={refresh}
      />
    </Card>
  );
};
