/**
 * BN Risk — governed outcome recording dialogue (EPIC 5).
 *
 * The officer selects a governed outcome from the published catalogue and
 * supplies the reason the backend requires. The dialogue never invents an
 * outcome, never restates a score as a finding and never asserts a proven
 * fraud conclusion — a fraud outcome is always worded as a referral.
 *
 * A correction records a superseding outcome. Nothing recorded is edited.
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
import { Input } from '@/components/ui/input';
import { riskOutcomeService } from '@/services/bn/risk/riskOutcomeService';
import {
  findingClassificationLabel,
  type BnRiskOutcomeReadinessV1,
  type BnRiskOutcomeTypeOption,
} from '@/types/bn/risk/riskOutcome';
import { referenceItems, useRiskReferenceData } from './useRiskReference';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  mode: 'RECORD' | 'CORRECT';
  readiness: BnRiskOutcomeReadinessV1;
  onCompleted: () => void;
}

export const BnRiskOutcomeDialog: React.FC<Props> = ({
  open, onOpenChange, assessmentId, mode, readiness, onCompleted,
}) => {
  const { data: reference } = useRiskReferenceData();
  const [outcomeCode, setOutcomeCode] = React.useState('');
  const [reasonCode, setReasonCode] = React.useState('');
  const [dispositionCode, setDispositionCode] = React.useState('');
  const [justification, setJustification] = React.useState('');
  const [externalReference, setExternalReference] = React.useState('');
  const [externalSummary, setExternalSummary] = React.useState('');
  const [unresolvedDisposition, setUnresolvedDisposition] = React.useState('');
  const [correctionReason, setCorrectionReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setOutcomeCode('');
    setReasonCode('');
    setDispositionCode('');
    setJustification('');
    setExternalReference('');
    setExternalSummary('');
    setUnresolvedDisposition('');
    setCorrectionReason('');
    setError(null);
    setConflict(false);
  }, [open]);

  const selected: BnRiskOutcomeTypeOption | undefined = readiness.outcome_catalogue
    .find((o) => o.outcome_code === outcomeCode);

  const requiresUnresolved = readiness.requires_unresolved_control_disposition;

  const missing: string[] = [];
  if (!outcomeCode) missing.push('Select the outcome.');
  if (selected?.requires_reason && !reasonCode) missing.push('Select the reason.');
  if (selected?.requires_justification && justification.trim().length < 10) {
    missing.push('Provide a justification of at least 10 characters.');
  }
  if (selected?.requires_external_reference && !externalReference.trim()) {
    missing.push('Provide the external reference returned by the owning domain.');
  }
  if (requiresUnresolved && !unresolvedDisposition) {
    missing.push('State how the unresolved control is being handled.');
  }
  if (mode === 'CORRECT' && !correctionReason) missing.push('Select the correction reason.');

  const mutation = useMutation({
    mutationFn: async () => {
      const base = {
        assessmentId,
        outcomeCode,
        reasonCode: reasonCode || null,
        dispositionCode: dispositionCode || null,
        justification: justification.trim() || null,
        externalOutcomeReference: externalReference.trim() || null,
        externalOutcomeSummary: externalSummary.trim() || null,
        unresolvedControlDisposition: unresolvedDisposition || null,
        expectedRowVersion: readiness.assessment_row_version,
      };
      const result = mode === 'CORRECT'
        ? await riskOutcomeService.correctOutcome({
          ...base,
          correctionReasonCode: correctionReason,
          correctionJustification: justification.trim() || null,
        })
        : await riskOutcomeService.recordOutcome(base);
      if (result.status === 'FAILED') {
        if (result.errorCode === 'E_VERSION_CONFLICT') setConflict(true);
        throw new Error(result.errorMessage ?? 'The outcome was not recorded.');
      }
      return result;
    },
    onSuccess: () => { onOpenChange(false); onCompleted(); },
    onError: (e: Error) => setError(e.message),
  });

  const outcomeReasons = referenceItems(reference, 'OUTCOME_REASON');
  const dispositions = referenceItems(reference, 'OUTCOME_DISPOSITION');
  const correctionReasons = referenceItems(reference, 'OUTCOME_CORRECTION_REASON');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="bn-risk-outcome-dialog">
        <DialogHeader>
          <DialogTitle>
            {mode === 'CORRECT' ? 'Correct the recorded outcome' : 'Record the assessment outcome'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'CORRECT'
              ? 'A correction records a new, superseding outcome. The previous outcome and its author are retained in full.'
              : 'The outcome records what this assessment concluded. It does not change any factor, evidence item, score, recommendation, approval or control already recorded.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bn-risk-outcome-code">Outcome</Label>
            <Select value={outcomeCode} onValueChange={setOutcomeCode}>
              <SelectTrigger id="bn-risk-outcome-code" data-testid="bn-risk-outcome-code">
                <SelectValue placeholder="Select the governed outcome" />
              </SelectTrigger>
              <SelectContent>
                {readiness.outcome_catalogue.map((o) => (
                  <SelectItem key={o.outcome_code} value={o.outcome_code}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && (
              <p className="text-xs text-muted-foreground" data-testid="bn-risk-outcome-finding">
                Finding recorded: {findingClassificationLabel(selected.finding_classification)}
                {selected.description ? ` — ${selected.description}` : ''}
              </p>
            )}
          </div>

          {selected?.is_fraud_related && (
            <Alert data-testid="bn-risk-outcome-fraud-notice">
              <AlertTitle>This outcome records a referral, not a proven finding</AlertTitle>
              <AlertDescription>
                Recording this outcome states that the matter has been referred for consideration
                by the responsible authority. It does not assert that fraud occurred and it does
                not decide any legal or criminal question.
              </AlertDescription>
            </Alert>
          )}

          {(selected?.requires_reason || outcomeReasons.length > 0) && (
            <div className="space-y-2">
              <Label htmlFor="bn-risk-outcome-reason">
                Reason{selected?.requires_reason ? '' : ' (optional)'}
              </Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger id="bn-risk-outcome-reason" data-testid="bn-risk-outcome-reason">
                  <SelectValue placeholder="Select the reason" />
                </SelectTrigger>
                <SelectContent>
                  {outcomeReasons.map((r) => (
                    <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {dispositions.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="bn-risk-outcome-disposition">Case disposition (optional)</Label>
              <Select value={dispositionCode} onValueChange={setDispositionCode}>
                <SelectTrigger id="bn-risk-outcome-disposition">
                  <SelectValue placeholder="Select the disposition" />
                </SelectTrigger>
                <SelectContent>
                  {dispositions.map((d) => (
                    <SelectItem key={d.code} value={d.code}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {requiresUnresolved && (
            <div className="space-y-2">
              <Label htmlFor="bn-risk-outcome-unresolved">Unresolved control handling</Label>
              <Select value={unresolvedDisposition} onValueChange={setUnresolvedDisposition}>
                <SelectTrigger id="bn-risk-outcome-unresolved" data-testid="bn-risk-outcome-unresolved">
                  <SelectValue placeholder="State how the unresolved control is handled" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ABANDONED_WITH_REASON">Abandoned, recorded with reason</SelectItem>
                  <SelectItem value="HANDLED_BY_OWNING_DOMAIN">Continuing in the owning domain</SelectItem>
                  <SelectItem value="SUPERSEDED_BY_OUTCOME">Superseded by this outcome</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A control that failed or was rejected is never silently ignored. Risk records how
                it was handled; it does not reverse anything in the owning domain.
              </p>
            </div>
          )}

          {selected?.requires_external_reference && (
            <div className="space-y-2">
              <Label htmlFor="bn-risk-outcome-external">External reference</Label>
              <Input
                id="bn-risk-outcome-external"
                data-testid="bn-risk-outcome-external"
                value={externalReference}
                onChange={(e) => setExternalReference(e.target.value)}
                placeholder="Reference returned by the owning domain or authority"
              />
              <Textarea
                rows={2}
                value={externalSummary}
                onChange={(e) => setExternalSummary(e.target.value)}
                placeholder="What the owning domain reported (optional)"
              />
            </div>
          )}

          {mode === 'CORRECT' && (
            <div className="space-y-2">
              <Label htmlFor="bn-risk-outcome-correction-reason">Correction reason</Label>
              <Select value={correctionReason} onValueChange={setCorrectionReason}>
                <SelectTrigger
                  id="bn-risk-outcome-correction-reason"
                  data-testid="bn-risk-outcome-correction-reason"
                >
                  <SelectValue placeholder="Why is the outcome being corrected?" />
                </SelectTrigger>
                <SelectContent>
                  {correctionReasons.map((r) => (
                    <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="bn-risk-outcome-justification">
              Justification{selected?.requires_justification ? '' : ' (optional)'}
            </Label>
            <Textarea
              id="bn-risk-outcome-justification"
              data-testid="bn-risk-outcome-justification"
              rows={4}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Explain the conclusion in language the person could be shown."
            />
          </div>

          {missing.length > 0 && (
            <Alert data-testid="bn-risk-outcome-missing">
              <AlertTitle>Before this outcome can be recorded</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
              </AlertDescription>
            </Alert>
          )}

          {conflict && (
            <Alert variant="destructive" data-testid="bn-risk-outcome-conflict">
              <AlertTitle>This assessment changed while the outcome was being prepared</AlertTitle>
              <AlertDescription>
                Nothing has been recorded. Reload the assessment, review what changed, and record
                the outcome again.
              </AlertDescription>
            </Alert>
          )}

          {error && !conflict && (
            <Alert variant="destructive">
              <AlertTitle>The outcome was not recorded</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            data-testid="bn-risk-outcome-submit"
            disabled={missing.length > 0 || mutation.isPending}
            onClick={() => { setError(null); setConflict(false); mutation.mutate(); }}
          >
            {mutation.isPending
              ? 'Recording…'
              : mode === 'CORRECT' ? 'Record superseding outcome' : 'Record outcome'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
