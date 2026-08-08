/**
 * BN Risk — independent control approval section (EPIC 3).
 *
 * Drives entirely from `bn_risk_control_approval_readiness_v1`. Maker-checker
 * is enforced by the backend; this surface only reflects it. Approving a
 * control authorises it for a later governed execution step — no payment,
 * award, claim, overpayment, profile restriction or referral is changed here.
 */
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
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
  type BnRiskApprovalSectionState,
  type BnRiskControlDecision,
} from '@/types/bn/risk/riskControl';
import { BnRiskControlDecisionDialog } from './BnRiskControlDecisionDialog';

interface Props {
  assessmentId: string;
  /** Context shown read-only to the approver. */
  assessmentReference: string;
  personName: string | null;
  isActionEnabled: (action: 'APPROVE_CONTROL' | 'REJECT_CONTROL' | 'RETURN_CONTROL') => boolean;
  onChanged: () => void;
}

export const BnRiskControlApprovalSection: React.FC<Props> = ({
  assessmentId, assessmentReference, personName, isActionEnabled, onChanged,
}) => {
  const queryClient = useQueryClient();
  const [decision, setDecision] = React.useState<BnRiskControlDecision | null>(null);

  const readiness = useQuery({
    queryKey: ['bn-risk-control-approval-readiness', assessmentId],
    queryFn: async () => {
      const result = await riskControlService.approvalReadiness(assessmentId);
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
    queryClient.invalidateQueries({ queryKey: ['bn-risk-control-approval-readiness', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-recommendation-readiness', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-recommendation-history', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-control-approval-queue'] });
    onChanged();
  }, [assessmentId, onChanged, queryClient]);

  if (readiness.isLoading) return <Skeleton className="h-40 w-full" />;

  if (readiness.isError || !readiness.data) {
    return (
      <Card data-testid="bn-risk-approval-section" data-state="FAILED">
        <CardHeader><CardTitle>Independent approval</CardTitle></CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Approval readiness is unavailable</AlertTitle>
            <AlertDescription>
              No decision can be recorded until this can be checked again. Nothing has changed.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const data = readiness.data;
  const state: BnRiskApprovalSectionState = data.state;
  const pending = history.data?.cycles.find(
    (c) => c.recommendation.recommendation_id === data.recommendation_id,
  )?.recommendation ?? null;
  const latest = history.data?.current ?? null;

  return (
    <Card data-testid="bn-risk-approval-section" data-state={state}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Independent approval
          </CardTitle>
          <CardDescription>
            A second officer decides whether the recommended control is authorised.
          </CardDescription>
        </div>
        {state !== 'NO_PENDING_DECISION' && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!(data.can_approve && isActionEnabled('APPROVE_CONTROL'))}
              onClick={() => setDecision('APPROVE')}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!(data.can_reject && isActionEnabled('REJECT_CONTROL'))}
              onClick={() => setDecision('REJECT')}
            >
              Reject
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!(data.can_return && isActionEnabled('RETURN_CONTROL'))}
              onClick={() => setDecision('RETURN_FOR_REVIEW')}
            >
              Return for review
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {state === 'NO_PENDING_DECISION' && (
          <p className="text-sm text-muted-foreground">
            There is no recommendation awaiting a decision.
            {latest && ` The last recommendation is ${controlExecutionNotice(latest.status, latest.execution_state).toLowerCase()}.`}
          </p>
        )}

        {state === 'SELF_APPROVAL_DENIED' && (
          <Alert variant="destructive">
            <AlertTitle>Independent approval required</AlertTitle>
            <AlertDescription>You cannot approve your own recommendation.</AlertDescription>
          </Alert>
        )}

        {state === 'STALE' && (
          <Alert variant="destructive">
            <AlertTitle>This recommendation is out of date</AlertTitle>
            <AlertDescription>
              Assessment information changed after this recommendation. Return to review and
              submit a new recommendation.
            </AlertDescription>
          </Alert>
        )}

        {data.warnings.map((w) => (
          <Alert key={w}><AlertDescription>{w}</AlertDescription></Alert>
        ))}

        {data.blockers.length > 0 && state !== 'SELF_APPROVAL_DENIED' && state !== 'STALE'
          && state !== 'NO_PENDING_DECISION' && (
          <Alert variant="destructive">
            <AlertTitle>A decision cannot be recorded yet</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">{data.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </AlertDescription>
          </Alert>
        )}

        {pending && (
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Assessment</p>
              <p>{assessmentReference}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Person</p>
              <p>{personName ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Score at recommendation</p>
              <p>{pending.score ?? '—'} · {pending.band_label ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Scoring configuration</p>
              <p>{pending.rule_set_code ?? '—'} v{pending.rule_set_version_no ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Recommended control</p>
              <p>
                {pending.control_label}
                {pending.is_benefit_affecting && (
                  <Badge className="ml-2" variant="destructive">Benefit affecting</Badge>
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Target</p>
              <p>{pending.target_reference ?? pending.target_type ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Recommendation reason</p>
              <p>{pending.reason_label ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Recommended by</p>
              <p>
                {pending.recommended_by_name ?? '—'} ·{' '}
                {formatAuditDate(pending.recommended_at, false)}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">Justification</p>
              <p>{pending.justification ?? '—'}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">Supporting references</p>
              <p>
                {pending.supporting_factor_ids.length} factor(s) ·{' '}
                {pending.supporting_evidence_ids.length} evidence item(s)
              </p>
            </div>
            <div className="sm:col-span-2">
              <Alert>
                <AlertTitle>Execution impact</AlertTitle>
                <AlertDescription>
                  Approval authorises the control for later governed execution.
                  This screen does not execute the benefit action.
                </AlertDescription>
              </Alert>
            </div>
            <div className="sm:col-span-2">
              <Collapsible>
                <CollapsibleTrigger className="text-xs text-muted-foreground underline">
                  Technical details
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  <p>Recommendation ID: {pending.recommendation_id}</p>
                  <p>Score ID: {pending.score_id ?? '—'}</p>
                  <p>Assessment version: {data.assessment_row_version}</p>
                  <p>Control code: {pending.control_code}</p>
                  <p>Target UUID: {pending.target_id ?? '—'}</p>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>
        )}
      </CardContent>

      <BnRiskControlDecisionDialog
        open={decision !== null}
        onOpenChange={(o) => !o && setDecision(null)}
        assessmentId={assessmentId}
        decision={decision}
        readiness={data}
        recommendation={pending}
        onCompleted={refresh}
      />
    </Card>
  );
};
