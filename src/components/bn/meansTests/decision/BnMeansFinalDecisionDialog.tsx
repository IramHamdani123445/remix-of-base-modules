/**
 * MEANS-TEST EPIC 10 — final independent decision on the assessment.
 *
 * The dialog restates exactly what is being approved (the current
 * calculation identity and figures) and refuses nothing itself: the
 * backend readiness verdict is shown, and the backend is authoritative.
 */
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { MeansDecisionRadioGroup, MeansGovernedSelect } from '@/components/bn/meansTests/controls/MeansControls';
import {
  approvalStateLabel,
  decisionReasonOptions,
  toDecisionAmount,
  type BnMeansDecisionContext,
} from '@/types/bn/meansTests/meansDecision';

export interface BnMeansFinalDecisionSubmission {
  readonly decision: 'APPROVE' | 'REJECT';
  readonly reasonCode: string;
  readonly justification: string;
  readonly calculationId: string | null;
  readonly rowVersion: number;
}

export interface BnMeansFinalDecisionDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly context: BnMeansDecisionContext;
  readonly busy?: boolean;
  readonly failure?: { code: string; message: string } | null;
  readonly onSubmit: (submission: BnMeansFinalDecisionSubmission) => void;
  readonly onRefresh?: () => void;
}

function money(value: number | string | null | undefined, currency: string): string {
  const n = toDecisionAmount(value);
  if (n === null) return '—';
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const BnMeansFinalDecisionDialog: React.FC<BnMeansFinalDecisionDialogProps> = ({
  open,
  onOpenChange,
  context,
  busy,
  failure,
  onSubmit,
  onRefresh,
}) => {
  const [decision, setDecision] = React.useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [reasonCode, setReasonCode] = React.useState('');
  const [justification, setJustification] = React.useState('');
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setValidationError(null);
  }, [open]);

  const readiness = context.approval_readiness;
  const reasons = context.reference.assessment_decision_reasons;
  const reasonOptions = decisionReasonOptions(reasons, decision);
  const selected = reasons.find((r) => r.decision === decision && r.reason_code === reasonCode) ?? null;
  const calc = context.calculation;
  const currency = context.currency_code;
  const stale =
    failure?.code === 'CALCULATION_NOT_LATEST' ||
    failure?.code === 'CALCULATION_HASH_MISMATCH' ||
    failure?.code === 'STALE_VERSION' ||
    failure?.code === 'CALCULATION_STALE';

  const submit = () => {
    if (!reasonCode) return setValidationError('Choose a governed decision reason.');
    if ((selected?.requires_justification ?? true) && justification.trim().length < 10) {
      return setValidationError('Provide a written justification of at least 10 characters.');
    }
    setValidationError(null);
    onSubmit({
      decision,
      reasonCode,
      justification: justification.trim(),
      calculationId: calc?.calculation_id ?? null,
      rowVersion: context.row_version,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="means-final-decision-dialog">
        <DialogHeader>
          <DialogTitle>Record the final decision</DialogTitle>
          <DialogDescription>
            Approval records the outcome of this Means-Test assessment. It does not activate any
            benefit, award or payment — activation is handled separately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <dl
            className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm sm:grid-cols-2"
            data-testid="means-final-decision-summary"
          >
            <div>
              <dt className="text-muted-foreground">Calculation version</dt>
              <dd className="font-medium">{calc?.sequence_no ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Outcome</dt>
              <dd className="font-medium">{calc?.result ?? 'No current calculation'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Assessable income</dt>
              <dd className="font-medium">{money(calc?.assessable_income, currency)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Threshold</dt>
              <dd className="font-medium">{money(calc?.threshold_amount, currency)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Calculation identity</dt>
              <dd className="break-all font-mono text-xs">
                {calc?.calculation_hash ?? calc?.result_hash ?? calc?.calculation_id ?? '—'}
              </dd>
            </div>
          </dl>

          {!readiness.ready && (
            <Alert data-testid="means-final-decision-readiness">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>{approvalStateLabel(readiness.state)}</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {(readiness.blockers ?? []).map((b) => (
                    <li key={b.code}>{b.message}</li>
                  ))}
                  {(readiness.blockers ?? []).length === 0 && <li>This assessment cannot be decided yet.</li>}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <MeansDecisionRadioGroup
            id="means-final-decision"
            label="Decision"
            required
            value={decision}
            onChange={(v) => {
              setDecision(v as 'APPROVE' | 'REJECT');
              setReasonCode('');
            }}
            optionSet={{
              state: 'SUCCESS',
              options: [
                { value: 'APPROVE', label: 'Approve the assessment', description: 'Outcome recorded; nothing is activated.' },
                { value: 'REJECT', label: 'Reject the assessment', description: 'The assessment is closed with its history retained.' },
              ],
            }}
          />

          <MeansGovernedSelect
            id="means-final-decision-reason"
            label="Decision reason"
            required
            optionSet={reasonOptions}
            value={reasonCode}
            onChange={setReasonCode}
          />

          <div className="space-y-1.5">
            <Label htmlFor="means-final-decision-justification">Justification</Label>
            <Textarea
              id="means-final-decision-justification"
              data-testid="means-final-decision-justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Record the basis for this decision."
            />
          </div>

          {validationError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}

          {failure && (
            <Alert variant="destructive" data-testid="means-final-decision-failure">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>The decision was not recorded</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{failure.message}</p>
                {stale && onRefresh && (
                  <Button size="sm" variant="outline" onClick={onRefresh} data-testid="means-final-decision-refresh">
                    Reload the current calculation
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy} data-testid="means-final-decision-submit">
            Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansFinalDecisionDialog;
