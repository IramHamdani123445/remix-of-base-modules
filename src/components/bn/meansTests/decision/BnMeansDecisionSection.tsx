/**
 * MEANS-TEST EPIC 10 — the single Decision surface.
 *
 * One place where an officer sees the calculated outcome, requests a
 * correction, sees every correction and its independent decision, and
 * records the final decision. Adjustment and approval are no longer two
 * disconnected tabs.
 *
 * All readiness, independence and arithmetic come from the backend; this
 * component formats them and refuses nothing on its own.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, ShieldAlert, TriangleAlert } from 'lucide-react';
import { MeansStateNotice, MeansStatusChip } from '@/components/bn/meansTests/controls/MeansControls';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import { meansCommandService } from '@/services/bn/meansTests/meansCommandService';
import {
  adjustmentStateLabel,
  approvalStateLabel,
  buildDecisionTimeline,
  decisionResultLabel,
  presentationDifference,
  toDecisionAmount,
  type BnMeansDecisionAdjustment,
  type BnMeansDecisionContext,
} from '@/types/bn/meansTests/meansDecision';
import BnMeansRequestAdjustmentDialog, {
  type BnMeansRequestAdjustmentSubmission,
} from './BnMeansRequestAdjustmentDialog';
import BnMeansAdjustmentDecisionDialog, {
  type BnMeansAdjustmentDecisionSubmission,
} from './BnMeansAdjustmentDecisionDialog';
import BnMeansFinalDecisionDialog, {
  type BnMeansFinalDecisionSubmission,
} from './BnMeansFinalDecisionDialog';

export interface BnMeansDecisionSectionProps {
  readonly assessmentId: string;
}

type Failure = { code: string; message: string } | null;

export function formatMoney(value: number | string | null | undefined, currency: string): string {
  const n = toDecisionAmount(value);
  if (n === null) return '—';
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

const FAILURE_MESSAGES: Record<string, string> = {
  SELF_APPROVAL_DENIED: 'An independent officer must take this decision. You cannot decide work you requested.',
  MAKER_CHECKER_REQUIRED: 'An independent officer must take this decision.',
  STALE_ADJUSTMENT_VERSION: 'This adjustment changed while the dialog was open. Reload the latest version and decide again.',
  STALE_ROW_VERSION: 'This assessment changed while the dialog was open. Reload and try again.',
  CALCULATION_NOT_LATEST: 'The calculation was superseded while the dialog was open. Reload the current calculation.',
  CALCULATION_HASH_MISMATCH: 'The calculation was superseded while the dialog was open. Reload the current calculation.',
  CALCULATION_STALE: 'The assessment must be recalculated before it can be decided.',
  NO_CURRENT_CALCULATION: 'There is no current calculation to decide.',
  OPEN_ADJUSTMENT_EXISTS: 'An adjustment is already open on this assessment. It must be decided first.',
  DUPLICATE_OPEN_ADJUSTMENT: 'An identical adjustment is already open on this item.',
  ADJUSTMENT_ALREADY_DECIDED: 'This adjustment has already been decided.',
  VERIFICATION_INCOMPLETE: 'Verification is not complete, so no decision can be recorded.',
  PERMISSION_DENIED: 'You do not have permission to take this action.',
  ACTIONS_DISABLED: 'Means-Test actions are currently disabled for this environment.',
};

function toFailure(code: string | undefined, detail: string | undefined): Failure {
  if (!code) return null;
  return { code, message: FAILURE_MESSAGES[code] ?? detail ?? 'The action could not be completed.' };
}

export const BnMeansDecisionSection: React.FC<BnMeansDecisionSectionProps> = ({ assessmentId }) => {
  const queryClient = useQueryClient();
  const [requestOpen, setRequestOpen] = React.useState(false);
  const [decisionAdjustment, setDecisionAdjustment] = React.useState<BnMeansDecisionAdjustment | null>(null);
  const [finalOpen, setFinalOpen] = React.useState(false);
  const [requestFailure, setRequestFailure] = React.useState<Failure>(null);
  const [adjustmentFailure, setAdjustmentFailure] = React.useState<Failure>(null);
  const [finalFailure, setFinalFailure] = React.useState<Failure>(null);
  const [showTechnical, setShowTechnical] = React.useState(false);

  const contextQuery = useQuery({
    queryKey: ['bn-means-decision-context', assessmentId],
    queryFn: () => meansQueryService.decisionContext(assessmentId),
  });

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['bn-means-decision-context', assessmentId] });
    void queryClient.invalidateQueries({ queryKey: ['bn-means-assessment', assessmentId] });
    void queryClient.invalidateQueries({ queryKey: ['bn-means-calculation', assessmentId] });
    void queryClient.invalidateQueries({ queryKey: ['bn-means-decision-queue'] });
  }, [assessmentId, queryClient]);

  const requestMutation = useMutation({
    mutationFn: (s: BnMeansRequestAdjustmentSubmission) =>
      meansCommandService.execute({
        command: 'BN_MEANS_REQUEST_ADJUSTMENT',
        assessmentId,
        expectedRowVersion: contextQuery.data?.status === 'OK' ? contextQuery.data.data?.row_version : undefined,
        reasonCode: s.reasonCode,
        justification: s.justification,
        payload: s.payload,
      }),
    onSuccess: (result) => {
      if (result.status === 'FAILED') {
        setRequestFailure(toFailure(result.errorCode, result.errorDetail));
        return;
      }
      setRequestFailure(null);
      setRequestOpen(false);
      invalidate();
    },
  });

  const adjustmentDecisionMutation = useMutation({
    mutationFn: (s: BnMeansAdjustmentDecisionSubmission) =>
      meansCommandService.execute({
        command: 'BN_MEANS_APPROVE_ADJUSTMENT',
        assessmentId,
        reasonCode: s.reasonCode,
        justification: s.note,
        payload: {
          adjustment_id: s.adjustmentId,
          adjustment_row_version: s.rowVersion,
          decision: s.decision,
          decision_reason_code: s.reasonCode,
          decision_note: s.note,
        },
      }),
    onSuccess: (result) => {
      if (result.status === 'FAILED') {
        setAdjustmentFailure(toFailure(result.errorCode, result.errorDetail));
        return;
      }
      setAdjustmentFailure(null);
      setDecisionAdjustment(null);
      invalidate();
    },
  });

  const finalDecisionMutation = useMutation({
    mutationFn: (s: BnMeansFinalDecisionSubmission) =>
      meansCommandService.execute({
        command: s.decision === 'APPROVE' ? 'BN_MEANS_APPROVE' : 'BN_MEANS_REJECT',
        assessmentId,
        expectedRowVersion: s.rowVersion,
        reasonCode: s.reasonCode,
        justification: s.justification,
        payload: {
          calculation_id: s.calculationId,
          decision: s.decision,
          decision_reason_code: s.reasonCode,
          justification: s.justification,
        },
      }),
    onSuccess: (result) => {
      if (result.status === 'FAILED') {
        setFinalFailure(toFailure(result.errorCode, result.errorDetail));
        return;
      }
      setFinalFailure(null);
      setFinalOpen(false);
      invalidate();
    },
  });

  /* -------------------------------------------------------------- */

  if (contextQuery.isLoading) {
    return (
      <div className="space-y-3" data-testid="means-decision-loading">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const envelope = contextQuery.data;
  if (!envelope || envelope.status !== 'OK' || !envelope.data) {
    return (
      <MeansStateNotice
        state={envelope?.status === 'DENIED' ? 'DENIED' : 'FAILED'}
        reason={
          envelope?.status === 'DENIED'
            ? 'You do not have permission to view the decision record for this assessment.'
            : 'The decision record could not be loaded.'
        }
        testId="means-decision-unavailable"
      />
    );
  }

  const context: BnMeansDecisionContext = envelope.data;
  const currency = context.currency_code;
  const readiness = context.approval_readiness;
  const calc = context.calculation;
  const previous = context.previous_calculation;
  const timeline = buildDecisionTimeline(context);
  const openAdjustments = context.adjustments.filter(
    (a) => a.status === 'REQUESTED' || a.status === 'APPROVED_PENDING_APPLICATION',
  );
  const decided = context.status === 'APPROVED' || context.status === 'REJECTED';
  const canRequestAdjustment = Boolean(calc) && !decided;
  const incomeDelta = presentationDifference(calc?.assessable_income, previous?.assessable_income);

  return (
    <div className="space-y-4" data-testid="means-decision-section">
      {/* ---------------- outcome ---------------- */}
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Decision</CardTitle>
            <CardDescription data-testid="means-decision-result">
              {decisionResultLabel(context.status, Boolean(calc))}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!canRequestAdjustment}
              onClick={() => {
                setRequestFailure(null);
                setRequestOpen(true);
              }}
              data-testid="means-decision-request-adjustment"
            >
              Request adjustment
            </Button>
            <Button
              size="sm"
              disabled={decided}
              onClick={() => {
                setFinalFailure(null);
                setFinalOpen(true);
              }}
              data-testid="means-decision-final"
            >
              Record final decision
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {calc ? (
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Household size</dt>
                <dd className="text-sm font-medium">{calc.household_size ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Assessable income</dt>
                <dd className="text-sm font-medium" data-testid="means-decision-income">
                  {formatMoney(calc.assessable_income, currency)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Threshold</dt>
                <dd className="text-sm font-medium">{formatMoney(calc.threshold_amount, currency)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Excess over threshold</dt>
                <dd className="text-sm font-medium">{formatMoney(calc.excess_amount, currency)}</dd>
              </div>
            </dl>
          ) : (
            <MeansStateNotice
              state="EMPTY"
              reason="There is no current calculation for this assessment yet."
              testId="means-decision-no-calculation"
            />
          )}

          {previous && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="means-decision-comparison">
              <p className="font-medium">Effect of the approved adjustment</p>
              <p className="text-muted-foreground">
                Assessable income moved from {formatMoney(previous.assessable_income, currency)} to{' '}
                {formatMoney(calc?.assessable_income, currency)}
                {incomeDelta !== null && ` (${incomeDelta >= 0 ? '+' : ''}${formatMoney(incomeDelta, currency)})`}.
                Outcome moved from {previous.result ?? '—'} to {calc?.result ?? '—'}.
              </p>
            </div>
          )}

          {!readiness.ready && (
            <Alert data-testid="means-decision-readiness">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>{approvalStateLabel(readiness.state)}</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {(readiness.blockers ?? []).map((b) => (
                    <li key={b.code}>{b.message}</li>
                  ))}
                  {(readiness.blockers ?? []).length === 0 && (
                    <li>This assessment cannot be decided in its current state.</li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {openAdjustments.some((a) => a.status === 'APPROVED_PENDING_APPLICATION') && (
            <Alert variant="destructive" data-testid="means-decision-recalculation-pending">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>Recalculation outstanding</AlertTitle>
              <AlertDescription>
                An approved adjustment has not yet produced a new calculation. No decision can be
                recorded until the recalculation completes.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* ---------------- adjustment register ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Adjustment register</CardTitle>
          <CardDescription>
            Every correction requested on this assessment, with who requested it, who decided it and
            what it changed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {context.adjustments.length === 0 ? (
            <MeansStateNotice
              state="EMPTY"
              reason="No adjustment has been requested on this assessment."
              testId="means-decision-no-adjustments"
            />
          ) : (
            context.adjustments.map((a) => (
              <div
                key={a.adjustment_id}
                className="rounded-md border p-3 text-sm"
                data-testid={`means-adjustment-${a.adjustment_id}`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {a.target_label ?? a.field_or_line_code ?? 'Calculation item'}
                      </span>
                      <Badge variant="secondary">{a.adjustment_reference ?? 'Reference pending'}</Badge>
                      <MeansStatusChip
                        label={adjustmentStateLabel(a.status)}
                        tone={a.status === 'REJECTED' ? 'warning' : a.status === 'APPROVED' ? 'positive' : 'neutral'}
                      />
                    </div>
                    <p className="text-muted-foreground">
                      {String(a.original_value ?? 'Not set')} → {String(a.proposed_value ?? '—')} ·{' '}
                      {a.reason_label ?? a.reason_code ?? 'No reason recorded'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Requested by {a.requested_by_label ?? 'Unknown officer'} on {formatDate(a.requested_at)}
                      {a.decided_at &&
                        ` · Decided by ${a.decided_by_label ?? 'Unknown officer'} on ${formatDate(a.decided_at)}`}
                    </p>
                    {a.justification && <p className="text-xs">{a.justification}</p>}
                    {a.application_error && (
                      <p className="text-xs font-medium text-destructive" role="alert">
                        Recalculation failed: {a.application_error}
                      </p>
                    )}
                  </div>
                  {a.status === 'REQUESTED' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAdjustmentFailure(null);
                        setDecisionAdjustment(a);
                      }}
                      data-testid={`means-adjustment-decide-${a.adjustment_id}`}
                    >
                      Decide
                    </Button>
                  )}
                </div>
                {a.is_requester && a.status === 'REQUESTED' && (
                  <p className="mt-2 text-xs text-muted-foreground" data-testid="means-adjustment-own-request">
                    You requested this correction, so an independent officer must decide it.
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ---------------- decision history ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Decision history</CardTitle>
          <CardDescription>Plain-language record of every calculation and decision.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {timeline.length === 0 ? (
            <MeansStateNotice state="EMPTY" reason="Nothing has been decided yet." testId="means-decision-no-history" />
          ) : (
            <ol className="space-y-2" data-testid="means-decision-timeline">
              {timeline.map((e) => (
                <li key={e.id} className="rounded-md border px-3 py-2 text-sm">
                  <p className="font-medium">{e.event}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.actor ?? 'System'} · {formatDate(e.at)}
                    {e.reason ? ` · ${e.reason}` : ''}
                  </p>
                  {e.result && <p className="text-xs">{e.result}</p>}
                </li>
              ))}
            </ol>
          )}

          <Separator />

          <Collapsible open={showTechnical} onOpenChange={setShowTechnical}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" data-testid="means-decision-technical-toggle">
                <ChevronDown className="mr-1 h-4 w-4" />
                {showTechnical ? 'Hide technical detail' : 'Show technical detail'}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="space-y-1 font-mono text-xs" data-testid="means-decision-technical">
                <p>Assessment version: {context.row_version}</p>
                <p>Calculation id: {calc?.calculation_id ?? '—'}</p>
                <p>Calculation sequence: {calc?.sequence_no ?? '—'}</p>
                <p>Calculation hash: {calc?.calculation_hash ?? calc?.result_hash ?? '—'}</p>
                <p>Input hash: {calc?.input_hash ?? '—'}</p>
                <p>Policy version: {calc?.policy_version_id ?? '—'}</p>
                <p>Frozen assessment version: {calc?.assessment_version_id ?? '—'}</p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* ---------------- dialogs ---------------- */}
      {requestOpen && (
        <BnMeansRequestAdjustmentDialog
          open={requestOpen}
          onOpenChange={(o) => {
            setRequestOpen(o);
            if (!o) setRequestFailure(null);
          }}
          context={context}
          busy={requestMutation.isPending}
          failure={requestFailure}
          onSubmit={(s) => requestMutation.mutate(s)}
        />
      )}

      {decisionAdjustment && (
        <BnMeansAdjustmentDecisionDialog
          open={Boolean(decisionAdjustment)}
          onOpenChange={(o) => {
            if (!o) {
              setDecisionAdjustment(null);
              setAdjustmentFailure(null);
            }
          }}
          context={context}
          adjustment={
            context.adjustments.find((a) => a.adjustment_id === decisionAdjustment.adjustment_id) ??
            decisionAdjustment
          }
          busy={adjustmentDecisionMutation.isPending}
          failure={adjustmentFailure}
          onSubmit={(s) => adjustmentDecisionMutation.mutate(s)}
          onRefresh={() => {
            setAdjustmentFailure(null);
            void contextQuery.refetch();
          }}
        />
      )}

      {finalOpen && (
        <BnMeansFinalDecisionDialog
          open={finalOpen}
          onOpenChange={(o) => {
            setFinalOpen(o);
            if (!o) setFinalFailure(null);
          }}
          context={context}
          busy={finalDecisionMutation.isPending}
          failure={finalFailure}
          onSubmit={(s) => finalDecisionMutation.mutate(s)}
          onRefresh={() => {
            setFinalFailure(null);
            void contextQuery.refetch();
          }}
        />
      )}
    </div>
  );
};

export default BnMeansDecisionSection;
