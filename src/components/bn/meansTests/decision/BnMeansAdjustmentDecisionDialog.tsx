/**
 * MEANS-TEST EPIC 10 — independent decision on a requested adjustment.
 *
 * The dialog never decides whether the actor may act: it renders the
 * backend's independence verdict and lets the backend refuse.
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
  adjustmentStateLabel,
  decisionReasonOptions,
  type BnMeansDecisionAdjustment,
  type BnMeansDecisionContext,
} from '@/types/bn/meansTests/meansDecision';

export interface BnMeansAdjustmentDecisionSubmission {
  readonly adjustmentId: string;
  readonly rowVersion: number;
  readonly decision: 'APPROVE' | 'REJECT';
  readonly reasonCode: string;
  readonly note: string;
}

export interface BnMeansAdjustmentDecisionDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly context: BnMeansDecisionContext;
  readonly adjustment: BnMeansDecisionAdjustment | null;
  readonly busy?: boolean;
  readonly failure?: { code: string; message: string } | null;
  readonly onSubmit: (submission: BnMeansAdjustmentDecisionSubmission) => void;
  /** Offered after a stale-version refusal; re-reads then re-opens. */
  readonly onRefresh?: () => void;
}

export const BnMeansAdjustmentDecisionDialog: React.FC<BnMeansAdjustmentDecisionDialogProps> = ({
  open,
  onOpenChange,
  context,
  adjustment,
  busy,
  failure,
  onSubmit,
  onRefresh,
}) => {
  const [decision, setDecision] = React.useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [reasonCode, setReasonCode] = React.useState('');
  const [note, setNote] = React.useState('');
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setValidationError(null);
  }, [open, adjustment?.adjustment_id]);

  if (!adjustment) return null;

  const reasons = context.reference.adjustment_decision_reasons;
  const reasonOptions = decisionReasonOptions(reasons, decision);
  const selected = reasons.find((r) => r.decision === decision && r.reason_code === reasonCode) ?? null;
  const independenceBlocked = adjustment.is_requester;
  const staleVersion = failure?.code === 'STALE_ADJUSTMENT_VERSION';

  const submit = () => {
    if (!reasonCode) return setValidationError('Choose a governed decision reason.');
    if ((selected?.requires_justification ?? decision === 'REJECT') && note.trim().length < 10) {
      return setValidationError('Provide a written justification of at least 10 characters.');
    }
    setValidationError(null);
    onSubmit({
      adjustmentId: adjustment.adjustment_id,
      rowVersion: adjustment.row_version,
      decision,
      reasonCode,
      note: note.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="means-adjustment-decision-dialog">
        <DialogHeader>
          <DialogTitle>Decide adjustment {adjustment.adjustment_reference ?? ''}</DialogTitle>
          <DialogDescription>
            Approving this correction causes the backend to recalculate the assessment and supersede
            the current calculation. Rejecting it leaves the current calculation standing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <dl className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Item</dt>
              <dd className="font-medium">{adjustment.target_label ?? adjustment.field_or_line_code ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Requested by</dt>
              <dd className="font-medium">{adjustment.requested_by_label ?? 'Unknown officer'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Current value</dt>
              <dd className="font-medium">{String(adjustment.original_value ?? 'Not set')}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Proposed value</dt>
              <dd className="font-medium">{String(adjustment.proposed_value ?? '—')}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Reason</dt>
              <dd className="font-medium">{adjustment.reason_label ?? adjustment.reason_code ?? '—'}</dd>
            </div>
            {adjustment.justification && (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Justification</dt>
                <dd>{adjustment.justification}</dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">{adjustmentStateLabel(adjustment.status)}</dd>
            </div>
          </dl>

          {independenceBlocked && (
            <Alert data-testid="means-adjustment-independence">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>An independent officer must decide this correction</AlertTitle>
              <AlertDescription>
                You requested this adjustment, so you cannot also decide it. The decision controls
                remain visible so you can see what will be asked of the checker.
              </AlertDescription>
            </Alert>
          )}

          <MeansDecisionRadioGroup
            id="means-adjustment-decision"
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
                { value: 'APPROVE', label: 'Approve the correction', description: 'The backend recalculates immediately.' },
                { value: 'REJECT', label: 'Reject the correction', description: 'The current calculation stands.' },
              ],
            }}
          />

          <MeansGovernedSelect
            id="means-adjustment-decision-reason"
            label="Decision reason"
            required
            optionSet={reasonOptions}
            value={reasonCode}
            onChange={setReasonCode}
          />

          <div className="space-y-1.5">
            <Label htmlFor="means-adjustment-decision-note">Decision note</Label>
            <Textarea
              id="means-adjustment-decision-note"
              data-testid="means-adjustment-decision-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Record why this decision was made."
            />
          </div>

          {validationError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}

          {failure && (
            <Alert variant="destructive" data-testid="means-adjustment-decision-failure">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>The decision was not recorded</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{failure.message}</p>
                {staleVersion && onRefresh && (
                  <Button size="sm" variant="outline" onClick={onRefresh} data-testid="means-adjustment-refresh">
                    Reload the latest version
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
          <Button onClick={submit} disabled={busy} data-testid="means-adjustment-decision-submit">
            Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansAdjustmentDecisionDialog;
