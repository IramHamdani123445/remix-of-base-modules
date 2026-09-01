/**
 * BN Risk — exceptional reopening dialogue (EPIC 5).
 *
 * Reopening is an administrative exception, not part of the ordinary workflow.
 * It starts a new review phase; it does not undo the closure, does not erase
 * any prior decision, and does not release, cancel or reverse anything in
 * Payments, Legal, Investigation, Overpayments, Claims or Awards. Those remain
 * separate governed actions in their own domains.
 *
 * The backend chooses the destination state of the new phase — never React.
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
import type { BnRiskClosureReadiness } from '@/types/bn/risk/riskOutcome';
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

export const BnRiskReopenDialog: React.FC<Props> = ({
  open, onOpenChange, assessmentId, assessmentReference, readiness, onCompleted,
}) => {
  const { data: reference } = useRiskReferenceData();
  const [reasonCode, setReasonCode] = React.useState('');
  const [justification, setJustification] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState(false);

  React.useEffect(() => {
    if (open) { setError(null); setConflict(false); }
  }, [open]);

  const reasons = referenceItems(reference, 'REOPEN_REASON');
  const justificationValid = justification.trim().length >= 20;

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await riskOutcomeService.reopenAssessment({
        assessmentId,
        reopenReasonCode: reasonCode,
        justification: justification.trim(),
        expectedRowVersion: readiness.assessment_row_version,
      });
      if (result.status === 'FAILED') {
        if (result.errorCode === 'E_VERSION_CONFLICT') setConflict(true);
        throw new Error(result.errorMessage ?? 'The assessment was not reopened.');
      }
      return result;
    },
    onSuccess: () => { onOpenChange(false); onCompleted(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="bn-risk-reopen-dialog">
        <DialogHeader>
          <DialogTitle>Reopen Risk assessment</DialogTitle>
          <DialogDescription>
            {assessmentReference} — an exceptional, audited action.
          </DialogDescription>
        </DialogHeader>

        <Alert data-testid="bn-risk-reopen-warning">
          <AlertTitle>What reopening does, and does not do</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              <li>Reopening starts a new review phase.</li>
              <li>The previous closure remains part of the case history.</li>
              <li>
                External controls or referrals are not automatically reversed. Releasing a
                payment hold or withdrawing a Legal or Investigation referral remains a separate
                action in the owning domain.
              </li>
            </ul>
          </AlertDescription>
        </Alert>

        {readiness.closure && (
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Closed by</p>
              <p>
                {readiness.closure.closed_by_name ?? '—'} ·{' '}
                {formatAuditDate(readiness.closure.closed_at, false)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Closure reason</p>
              <p>{readiness.closure.closure_reason_label ?? '—'}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">Previous reopenings</p>
              <p data-testid="bn-risk-reopen-count">{readiness.reopen_count}</p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="bn-risk-reopen-reason">Reopen reason</Label>
          <Select value={reasonCode} onValueChange={setReasonCode}>
            <SelectTrigger id="bn-risk-reopen-reason" data-testid="bn-risk-reopen-reason">
              <SelectValue placeholder="Select the reason for reopening" />
            </SelectTrigger>
            <SelectContent>
              {reasons.map((r) => (
                <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bn-risk-reopen-justification">Justification</Label>
          <Textarea
            id="bn-risk-reopen-justification"
            data-testid="bn-risk-reopen-justification"
            rows={4}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="What new information or error justifies reopening this closed assessment?"
          />
          {!justificationValid && justification.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Provide at least 20 characters so the reason for the exception is on record.
            </p>
          )}
        </div>

        {conflict && (
          <Alert variant="destructive" data-testid="bn-risk-reopen-conflict">
            <AlertTitle>This assessment changed before it could be reopened</AlertTitle>
            <AlertDescription>
              Nothing has been reopened. Reload the assessment and try again if it is still
              appropriate. Your reason and justification are preserved above.
            </AlertDescription>
          </Alert>
        )}

        {error && !conflict && (
          <Alert variant="destructive">
            <AlertTitle>The assessment was not reopened</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <BnBusyButton loading={mutation.isPending}
            data-testid="bn-risk-reopen-submit"
            disabled={!reasonCode || !justificationValid || mutation.isPending
              || !readiness.can_reopen}
            onClick={() => { setError(null); setConflict(false); mutation.mutate(); }}
          >
            {mutation.isPending ? 'Reopening…' : 'Reopen Risk assessment'}
          </BnBusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
