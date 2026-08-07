/**
 * MEANS-TEST EPIC 10 — request an adjustment to a calculated assessment.
 *
 * Every choice on this dialog comes from the governed backend catalogue
 * (`bn_means_adjustment_reference_v1`) and from the backend calculation
 * lines. There is no free-text target, no free-text reason code and no
 * typed evidence identifier.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { AlertTriangle } from 'lucide-react';
import {
  MeansDateField,
  MeansGovernedSelect,
  MeansMoneyInput,
} from '@/components/bn/meansTests/controls/MeansControls';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import type { BnMeansOptionSet } from '@/types/bn/meansTests/meansFieldContract';
import {
  adjustmentReasonOptions,
  adjustmentTargetChoices,
  type BnMeansAdjustmentTargetKindOption,
  type BnMeansDecisionContext,
} from '@/types/bn/meansTests/meansDecision';

export interface BnMeansRequestAdjustmentSubmission {
  readonly reasonCode: string;
  readonly justification: string;
  readonly payload: Record<string, unknown>;
}

export interface BnMeansRequestAdjustmentDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly context: BnMeansDecisionContext;
  readonly busy?: boolean;
  /** Business error from the last failed attempt. Values are preserved. */
  readonly failure?: { code: string; message: string } | null;
  readonly onSubmit: (submission: BnMeansRequestAdjustmentSubmission) => void;
}

const INCLUSION_OPTIONS: BnMeansOptionSet = {
  state: 'SUCCESS',
  options: [
    { value: 'AMOUNT', label: 'Apply a corrected amount' },
    { value: 'EXCLUDE', label: 'Exclude this item from the calculation' },
  ],
};

export const BnMeansRequestAdjustmentDialog: React.FC<BnMeansRequestAdjustmentDialogProps> = ({
  open,
  onOpenChange,
  context,
  busy,
  failure,
  onSubmit,
}) => {
  const reference = context.reference;
  const currency = context.currency_code;

  const [targetKindCode, setTargetKindCode] = React.useState('');
  const [targetValue, setTargetValue] = React.useState('');
  const [treatment, setTreatment] = React.useState('AMOUNT');
  const [amount, setAmount] = React.useState('');
  const [dateValue, setDateValue] = React.useState('');
  const [reasonCode, setReasonCode] = React.useState('');
  const [justification, setJustification] = React.useState('');
  const [evidenceLinkId, setEvidenceLinkId] = React.useState('');
  const [validationError, setValidationError] = React.useState<string | null>(null);

  const targetKind: BnMeansAdjustmentTargetKindOption | null =
    reference.target_kinds.find((k) => k.target_kind === targetKindCode) ?? null;

  const targetKindOptions: BnMeansOptionSet = {
    state: reference.target_kinds.length > 0 ? 'SUCCESS' : 'FAILED',
    options: reference.target_kinds.map((k) => ({ value: k.target_kind, label: k.label })),
    reason: reference.target_kinds.length > 0 ? undefined : 'No adjustable target is permitted',
  };

  const choices = adjustmentTargetChoices(context, targetKind);
  const targetOptions: BnMeansOptionSet = {
    state: choices.length > 0 ? 'SUCCESS' : 'EMPTY',
    options: choices.map((c) => ({ value: c.value, label: c.label })),
  };
  const choice = choices.find((c) => c.value === targetValue) ?? null;

  const reasonOptions = adjustmentReasonOptions(reference, targetKindCode || null);
  const selectedReason = reference.adjustment_reasons.find((r) => r.reason_code === reasonCode) ?? null;
  const evidenceRequired = Boolean(targetKind?.evidence_required || selectedReason?.requires_evidence);

  const evidence = useQuery({
    queryKey: ['bn-means-evidence', context.assessment_id],
    queryFn: () => meansQueryService.evidence(context.assessment_id),
    enabled: open && evidenceRequired,
  });

  const evidenceLinks =
    evidence.data?.status === 'OK'
      ? (evidence.data.data?.links ?? []).filter(
          (l) => l.link_status === 'LINKED' && l.usability_status === 'USABLE',
        )
      : [];

  const evidenceOptions: BnMeansOptionSet = evidence.isLoading
    ? { state: 'LOADING', options: [] }
    : evidence.data && evidence.data.status !== 'OK'
      ? {
          state: evidence.data.status === 'DENIED' ? 'DENIED' : 'FAILED',
          options: [],
          reason: 'Linked evidence could not be loaded',
        }
      : {
          state: evidenceLinks.length > 0 ? 'SUCCESS' : 'EMPTY',
          options: evidenceLinks.map((l) => ({
            value: l.link_id,
            label: l.document_title ?? l.evidence_type,
            description: [l.document_type_code, l.document_date].filter(Boolean).join(' · ') || undefined,
          })),
        };
  const evidenceLink = evidenceLinks.find((l) => l.link_id === evidenceLinkId) ?? null;

  React.useEffect(() => {
    if (!open) return;
    setValidationError(null);
  }, [open]);

  const resetTarget = (kind: string) => {
    setTargetKindCode(kind);
    setTargetValue('');
    setAmount('');
    setDateValue('');
    setTreatment('AMOUNT');
    setReasonCode('');
  };

  const isDate = targetKind?.control === 'DATE';
  const excluding = targetKind?.control === 'MONEY_OR_EXCLUDE' && treatment === 'EXCLUDE';

  const submit = () => {
    if (!targetKind) return setValidationError('Choose what needs correcting.');
    if (!choice) return setValidationError('Choose the item to correct.');
    if (!reasonCode) return setValidationError('Choose a governed reason.');
    if ((selectedReason?.requires_justification ?? true) && justification.trim().length < 10) {
      return setValidationError('Provide a written justification of at least 10 characters.');
    }
    if (isDate && !dateValue) return setValidationError('Enter the corrected date.');
    if (!isDate && !excluding && !amount) return setValidationError('Enter the corrected amount.');
    if (evidenceRequired && !evidenceLink) {
      return setValidationError('Select the usable evidence that supports this correction.');
    }

    const proposed = isDate ? dateValue : excluding ? 'EXCLUDE' : amount;
    setValidationError(null);
    onSubmit({
      reasonCode,
      justification: justification.trim(),
      payload: {
        target_kind: targetKind.target_kind,
        target_id: choice.lineId,
        field_or_line_code: choice.fieldOrLineCode,
        original_value: choice.originalValue,
        proposed_value: proposed,
        currency_code: isDate || excluding ? undefined : currency,
        assessment_version_id: context.calculation?.assessment_version_id ?? undefined,
        evidence_id: evidenceLink?.evidence_id ?? undefined,
        evidence_reference: evidenceLink?.document_ref ?? undefined,
        structured_justification: justification.trim(),
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="means-request-adjustment-dialog">
        <DialogHeader>
          <DialogTitle>Request an adjustment</DialogTitle>
          <DialogDescription>
            Ask an independent officer to approve a correction to the current calculation.
            Nothing changes until the correction is approved and the backend recalculates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <MeansGovernedSelect
            id="means-adjustment-target-kind"
            label="What needs correcting?"
            required
            optionSet={targetKindOptions}
            value={targetKindCode}
            onChange={resetTarget}
          />

          {targetKind && (
            <MeansGovernedSelect
              id="means-adjustment-target"
              label="Item"
              description="Choices come from the current calculation."
              required
              optionSet={targetOptions}
              value={targetValue}
              onChange={setTargetValue}
            />
          )}

          {choice && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="means-adjustment-original">
              <span className="text-muted-foreground">Current value: </span>
              <span className="font-medium">{choice.originalValue ?? 'Not set'}</span>
            </div>
          )}

          {targetKind?.control === 'MONEY_OR_EXCLUDE' && (
            <MeansGovernedSelect
              id="means-adjustment-treatment"
              label="Correction"
              required
              optionSet={INCLUSION_OPTIONS}
              value={treatment}
              onChange={setTreatment}
            />
          )}

          {targetKind && !isDate && !excluding && (
            <MeansMoneyInput
              id="means-adjustment-amount"
              label="Corrected amount"
              required
              currency={currency}
              value={amount}
              onChange={(raw) => setAmount(raw)}
            />
          )}

          {isDate && (
            <MeansDateField
              id="means-adjustment-date"
              label="Corrected date"
              required
              value={dateValue}
              onChange={(v) => setDateValue(v)}
            />
          )}

          <MeansGovernedSelect
            id="means-adjustment-reason"
            label="Reason"
            description="Governed reasons only."
            required
            optionSet={reasonOptions}
            value={reasonCode}
            onChange={setReasonCode}
          />

          <div className="space-y-1.5">
            <Label htmlFor="means-adjustment-justification">Justification</Label>
            <Textarea
              id="means-adjustment-justification"
              data-testid="means-adjustment-justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Explain, in your own words, why this correction is required."
            />
          </div>

          {evidenceRequired && (
            <MeansGovernedSelect
              id="means-adjustment-evidence"
              label="Supporting evidence"
              description="Only evidence already linked and marked usable can be cited."
              required
              optionSet={evidenceOptions}
              value={evidenceLinkId}
              onChange={setEvidenceLinkId}
            />
          )}

          {validationError && (
            <Alert variant="destructive" data-testid="means-adjustment-validation">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}

          {failure && (
            <Alert variant="destructive" data-testid="means-adjustment-failure">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>The adjustment was not requested</AlertTitle>
              <AlertDescription>{failure.message}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy} data-testid="means-adjustment-submit">
            Request adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansRequestAdjustmentDialog;
