/**
 * BN Means-Test MT7 — final approval and rejection surface.
 *
 * Every figure shown here is supplied by `bn_means_approval_context_v1`.
 * Nothing is recomputed in React.
 */
import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { formatWithCurrency } from '@/utils/formatCurrency';
import type { BnMeansAvailableAction } from '@/services/bn/meansTests/meansQueryService';
import {
  BN_MEANS_REASON_LABEL,
  meansStatusLabel,
  type BnMeansApprovalContext,
} from '@/types/bn/meansTests/meansAdjustments';

export interface BnMeansApprovalPanelProps {
  readonly context: BnMeansApprovalContext | null;
  readonly loadFailure: string | null;
  readonly approveAction: BnMeansAvailableAction | undefined;
  readonly rejectAction: BnMeansAvailableAction | undefined;
  readonly busy: boolean;
  readonly successToken: number;
  readonly onApprove: (payload: Record<string, unknown>) => void;
  readonly onReject: (payload: Record<string, unknown>) => void;
}

function reasonText(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return BN_MEANS_REASON_LABEL[reason] ?? reason;
}

export const BnMeansApprovalPanel: React.FC<BnMeansApprovalPanelProps> = ({
  context,
  loadFailure,
  approveAction,
  rejectAction,
  busy,
  successToken,
  onApprove,
  onReject,
}) => {
  const [reasonCode, setReasonCode] = React.useState('');
  const [justification, setJustification] = React.useState('');

  React.useEffect(() => {
    if (successToken > 0) {
      setReasonCode('');
      setJustification('');
    }
  }, [successToken]);

  if (loadFailure) {
    return (
      <Alert variant="destructive" data-testid="means-approval-unavailable">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Approval context unavailable</AlertTitle>
        <AlertDescription className="text-xs">{loadFailure}</AlertDescription>
      </Alert>
    );
  }

  if (!context) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="means-approval-empty">
        No approval context is available for this assessment.
      </p>
    );
  }

  const money = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : formatWithCurrency(Number(v), context.currency_code || 'XCD');

  const approved = context.status === 'APPROVED';
  const rejected = context.status === 'REJECTED';
  const canApprove = Boolean(approveAction?.allowed) && !busy;
  const canReject = Boolean(rejectAction?.allowed) && !busy;

  const rows: readonly [string, string][] = [
    ['Status', meansStatusLabel(context.status, Boolean(context.calculation_id))],
    ['Assessment version', context.assessment_version_no ? `v${context.assessment_version_no}` : '—'],
    ['Policy version', context.policy_version_id ?? '—'],
    ['Household size', context.household_size === null ? '—' : String(context.household_size)],
    ['Assessable income', money(context.assessable_income)],
    ['Assessable assets', money(context.assessable_assets)],
    ['Approved deductions', money(context.approved_deductions)],
    ['Threshold', money(context.threshold_amount)],
    ['Excess', money(context.excess_amount)],
    ['Result', context.result ?? '—'],
    ['Calculation fingerprint', context.calculation_hash ?? '—'],
    ['Input fingerprint', context.input_hash ?? '—'],
    ['Calculated at', context.calculated_at ?? '—'],
    ['Submitted by', context.maker_user_id ?? '—'],
    ['Valid from', context.valid_from ?? '—'],
    ['Valid until', context.valid_until ?? '—'],
    ['Reassessment due', context.reassessment_due ?? '—'],
  ];

  return (
    <div className="space-y-4" data-testid="means-approval-panel">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> Approval context
          </CardTitle>
          <CardDescription>
            Approval attaches to one calculation. It never re-runs the calculation engine and never
            activates entitlement — activation is decided by Eligibility.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map(([label, value]) => (
              <div key={label}>
                <p className="text-xs uppercase text-muted-foreground">{label}</p>
                <p className="text-sm break-all">{value}</p>
              </div>
            ))}
          </div>

          {context.supersedes_calculation_id && (
            <Alert data-testid="means-approval-supersedes">
              <AlertTitle>Recalculated after adjustment</AlertTitle>
              <AlertDescription className="text-xs">
                This calculation supersedes {context.supersedes_calculation_id}. Previous result{' '}
                {context.previous_result ?? '—'} with excess {money(context.previous_excess_amount)}.
              </AlertDescription>
            </Alert>
          )}

          {!context.verification_complete && (
            <Alert variant="destructive" data-testid="means-approval-verification-blocker">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Verification incomplete</AlertTitle>
              <AlertDescription className="text-xs">
                {context.verification_missing} missing and {context.verification_clarification} awaiting
                clarification.
              </AlertDescription>
            </Alert>
          )}

          {context.adjustments_pending_application > 0 && (
            <Alert variant="destructive" data-testid="means-approval-adjustment-blocker">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Approved adjustment not applied</AlertTitle>
              <AlertDescription className="text-xs">
                {BN_MEANS_REASON_LABEL.ADJUSTMENT_APPLICATION_PENDING}
              </AlertDescription>
            </Alert>
          )}

          {context.actor_is_maker && (
            <Alert data-testid="means-approval-self-warning">
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription className="text-xs">
                {BN_MEANS_REASON_LABEL.SELF_APPROVAL_DENIED}
              </AlertDescription>
            </Alert>
          )}

          {(approved || rejected) && (
            <Alert data-testid="means-approval-recorded">
              <AlertTitle>
                {approved ? 'Approved — not yet active' : 'Rejected — retained with full evidence'}
              </AlertTitle>
              <AlertDescription className="text-xs">
                Decided by {context.checker_user_id ?? '—'} at {context.decided_at ?? '—'}
                {context.decision_reason_code ? ` · ${context.decision_reason_code}` : ''}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decision</CardTitle>
          <CardDescription>
            An officer who did not submit or calculate the assessment must record the decision.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="means-decision-reason">Reason code</Label>
              <Input
                id="means-decision-reason"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="means-decision-justification">Structured justification</Label>
              <Textarea
                id="means-decision-justification"
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={!canApprove}
              data-testid="means-approve"
              onClick={() =>
                onApprove({
                  calculation_id: context.calculation_id,
                  calculation_hash: context.calculation_hash,
                  reason_code: reasonCode,
                  structured_justification: justification,
                  expected_row_version: context.row_version,
                })
              }
            >
              Approve assessment
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canReject}
              data-testid="means-reject"
              onClick={() =>
                onReject({
                  calculation_id: context.calculation_id,
                  calculation_hash: context.calculation_hash,
                  reason_code: reasonCode,
                  structured_justification: justification,
                  expected_row_version: context.row_version,
                })
              }
            >
              Reject assessment
            </Button>
          </div>

          {!approveAction?.allowed && approveAction?.reason && (
            <p className="text-xs text-muted-foreground" data-testid="means-approve-reason">
              {reasonText(approveAction.reason)}
            </p>
          )}
          {!rejectAction?.allowed && rejectAction?.reason && (
            <p className="text-xs text-muted-foreground" data-testid="means-reject-reason">
              {reasonText(rejectAction.reason)}
            </p>
          )}

          {context.decisions.length > 0 && (
            <div className="space-y-2" data-testid="means-approval-history">
              <p className="text-xs uppercase text-muted-foreground">Decision history</p>
              {context.decisions.map((d) => (
                <div key={d.approval_id} className="rounded-md border p-2 text-xs">
                  <Badge variant="secondary">{d.decision}</Badge>{' '}
                  <span className="break-all">
                    {d.decided_by ?? '—'} · {d.decided_at ?? '—'} · {d.decision_reason ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BnMeansApprovalPanel;
