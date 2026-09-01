/**
 * BN Risk — assessment closure confirmation (EPIC 5).
 *
 * Closure records that the Risk review is finished. It is not a deletion: the
 * signals, factors, evidence, score, recommendation, approval, execution and
 * outcome all remain part of the permanent case history, and closing changes
 * nothing in any owning domain.
 */
import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatAuditDate } from '@/lib/dateFormat';
import { riskOutcomeService } from '@/services/bn/risk/riskOutcomeService';
import {
  findingClassificationLabel,
  type BnRiskClosureReadiness,
} from '@/types/bn/risk/riskOutcome';
import { referenceItems, useRiskReferenceData } from './useRiskReference';
import { BnBusyButton } from '@/components/bn/shared';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  assessmentReference: string;
  readiness: BnRiskClosureReadiness;
  onCompleted: () => void;
}

export const BnRiskClosureDialog: React.FC<Props> = ({
  open, onOpenChange, assessmentId, assessmentReference, readiness, onCompleted,
}) => {
  const { data: reference } = useRiskReferenceData();
  const [reasonCode, setReasonCode] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState(false);

  React.useEffect(() => {
    if (open) { setError(null); setConflict(false); }
  }, [open]);

  const reasons = referenceItems(reference, 'CLOSURE_REASON');

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await riskOutcomeService.closeAssessment({
        assessmentId,
        closureReasonCode: reasonCode,
        closureNote: note.trim() || null,
        expectedRowVersion: readiness.assessment_row_version,
      });
      if (result.status === 'FAILED') {
        if (result.errorCode === 'E_VERSION_CONFLICT') setConflict(true);
        throw new Error(result.errorMessage ?? 'The assessment was not closed.');
      }
      return result;
    },
    onSuccess: () => { onOpenChange(false); onCompleted(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="bn-risk-closure-dialog">
        <DialogHeader>
          <DialogTitle>Close Risk assessment</DialogTitle>
          <DialogDescription>
            Closing records that the Risk review is finished. The full case history is retained
            and nothing is reversed in any owning domain.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Assessment</p>
            <p data-testid="bn-risk-closure-dialog-reference">{assessmentReference}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Recorded outcome</p>
            <p data-testid="bn-risk-closure-dialog-outcome">
              {readiness.outcome?.outcome_label ?? '—'}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-muted-foreground">Finding</p>
            <p>
              {readiness.outcome
                ? findingClassificationLabel(readiness.outcome.finding_classification)
                : '—'}
              {readiness.outcome
                ? ` · recorded by ${readiness.outcome.recorded_by_name ?? '—'} on ${formatAuditDate(readiness.outcome.recorded_at, false)}`
                : ''}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-muted-foreground">Outstanding blockers</p>
            <p data-testid="bn-risk-closure-dialog-blockers">
              {readiness.blockers.length === 0 ? 'None' : readiness.blockers.join(' · ')}
            </p>
          </div>
        </div>

        {readiness.warnings.map((w) => (
          <Alert key={w}><AlertDescription>{w}</AlertDescription></Alert>
        ))}

        <div className="space-y-2">
          <Label htmlFor="bn-risk-closure-reason">Closure reason</Label>
          <Select value={reasonCode} onValueChange={setReasonCode}>
            <SelectTrigger id="bn-risk-closure-reason" data-testid="bn-risk-closure-reason">
              <SelectValue placeholder="Select the closure reason" />
            </SelectTrigger>
            <SelectContent>
              {reasons.map((r) => (
                <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bn-risk-closure-note">Closure note (optional)</Label>
          <Textarea
            id="bn-risk-closure-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {conflict && (
          <Alert variant="destructive" data-testid="bn-risk-closure-conflict">
            <AlertTitle>This assessment changed before it could be closed</AlertTitle>
            <AlertDescription>
              Nothing has been closed. Reload the assessment, review what changed, and close it
              again if it is still appropriate.
            </AlertDescription>
          </Alert>
        )}

        {error && !conflict && (
          <Alert variant="destructive">
            <AlertTitle>The assessment was not closed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <BnBusyButton loading={mutation.isPending}
            data-testid="bn-risk-closure-submit"
            disabled={!reasonCode || mutation.isPending || !readiness.can_close}
            onClick={() => { setError(null); setConflict(false); mutation.mutate(); }}
          >>
            {mutation.isPending ? 'Closing…' : 'Close Risk assessment'}
          </BnBusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
