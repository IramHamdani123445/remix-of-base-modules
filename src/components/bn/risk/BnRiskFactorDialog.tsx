/**
 * BN Risk — record or correct a governed risk factor
 * (BN_RISK_ADD_FACTOR / BN_RISK_OP_CORRECT_FACTOR).
 *
 * Factor types, directions, materiality and provenance all come from the
 * governed catalogue. The value control shown is decided by the factor
 * type's own value kind, so an officer can never record a value the
 * boundary would reject.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { riskAssessmentService } from '@/services/bn/risk/riskAssessmentService';
import type {
  BnRiskAssessmentSignalRow,
  BnRiskFactorRow,
  BnRiskFactorTypeOption,
} from '@/types/bn/risk/riskAssessment';
import { referenceItems, useRiskReferenceData } from './useRiskReference';

const NONE = '__NONE__';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  rowVersion: number;
  signals: readonly BnRiskAssessmentSignalRow[];
  /** Present when correcting an existing factor. */
  factor?: BnRiskFactorRow | null;
  onCompleted: () => void;
}

export const BnRiskFactorDialog: React.FC<Props> = ({
  open, onOpenChange, assessmentId, rowVersion, signals, factor, onCompleted,
}) => {
  const isCorrection = !!factor;
  const queryClient = useQueryClient();
  const { data: reference } = useRiskReferenceData();

  const [typeCode, setTypeCode] = React.useState('');
  const [direction, setDirection] = React.useState('');
  const [materiality, setMateriality] = React.useState('');
  const [provenance, setProvenance] = React.useState('');
  const [provenanceReference, setProvenanceReference] = React.useState('');
  const [signalId, setSignalId] = React.useState(NONE);
  const [subjectReference, setSubjectReference] = React.useState('');
  const [valueNumeric, setValueNumeric] = React.useState('');
  const [valueDate, setValueDate] = React.useState('');
  const [valueCode, setValueCode] = React.useState('');
  const [valueText, setValueText] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [correctionReason, setCorrectionReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const catalogue = useQuery({
    queryKey: ['bn-risk-factor-catalogue', assessmentId],
    queryFn: async () => {
      const result = await riskAssessmentService.factorCatalogue(assessmentId);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
    enabled: open,
  });

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setCorrectionReason('');
    setTypeCode(factor?.factor_type_code ?? '');
    setDirection(factor?.direction_code ?? '');
    setMateriality(factor?.materiality_code ?? '');
    setProvenance(factor?.provenance_code ?? '');
    setProvenanceReference(factor?.provenance_reference ?? '');
    setSignalId(factor?.signal_id ?? NONE);
    setSubjectReference(factor?.subject_reference ?? '');
    setValueNumeric(factor?.value_numeric ? String(Number(factor.value_numeric)) : '');
    setValueDate(factor?.value_date ?? '');
    setValueCode(factor?.value_code ?? '');
    setValueText(factor?.value_text ?? '');
    setReason(factor?.reason ?? '');
  }, [open, factor]);

  const selected: BnRiskFactorTypeOption | undefined =
    catalogue.data?.factor_types.find((t) => t.factor_type_code === typeCode);

  React.useEffect(() => {
    if (selected && !direction) setDirection(selected.default_direction_code);
  }, [selected, direction]);

  const valueDomainItems = selected?.value_domain
    ? referenceItems(reference, selected.value_domain as never)
    : [];

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        factor_type_code: typeCode,
        direction_code: direction || null,
        materiality_code: materiality || null,
        provenance_code: provenance,
        provenance_reference: provenanceReference.trim() || null,
        signal_id: signalId === NONE ? null : signalId,
        subject_reference: subjectReference.trim() || null,
        reason: reason.trim() || null,
      };
      if (selected?.value_kind === 'AMOUNT') payload.value_numeric = valueNumeric;
      if (selected?.value_kind === 'DATE') payload.value_date = valueDate;
      if (selected?.value_kind === 'TRISTATE' || selected?.value_kind === 'DECISION') {
        payload.value_code = valueCode;
      }
      if (selected?.value_kind === 'TEXT') payload.value_text = valueText.trim();
      if (isCorrection) {
        payload.factor_id = factor?.factor_id;
        payload.correction_reason = correctionReason.trim();
      }

      const result = await riskAssessmentService.execute({
        command: isCorrection ? 'BN_RISK_OP_CORRECT_FACTOR' : 'BN_RISK_ADD_FACTOR',
        assessmentId,
        expectedRowVersion: rowVersion,
        payload,
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The factor could not be recorded.');
      }
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-detail', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-actions', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-queue'] });
      if (result.status === 'DUPLICATE') {
        setError('An identical factor is already recorded on this assessment.');
        return;
      }
      onOpenChange(false);
      onCompleted();
    },
    onError: (e: Error) => setError(e.message),
  });

  const valueProvided =
    !selected ? false
      : selected.value_kind === 'AMOUNT' ? valueNumeric.trim() !== ''
        : selected.value_kind === 'DATE' ? valueDate !== ''
          : selected.value_kind === 'TRISTATE' || selected.value_kind === 'DECISION' ? !!valueCode
            : true;

  const provenanceReferenceOk =
    provenance === 'OFFICER_CONFIRMED' || provenanceReference.trim() !== '';

  const canSubmit =
    !!typeCode && !!provenance && provenanceReferenceOk && valueProvided
    && (!selected?.requires_reason || reason.trim() !== '')
    && (!isCorrection || correctionReason.trim() !== '')
    && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isCorrection ? 'Correct factor' : 'Record a factor'}</DialogTitle>
          <DialogDescription>
            A factor is a traceable observation used later in the review. Recording a
            factor does not score, decide or affect a benefit.
          </DialogDescription>
        </DialogHeader>

        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Factor type</Label>
            <Select
              value={typeCode}
              onValueChange={(v) => { setTypeCode(v); setDirection(''); }}
              disabled={isCorrection}
            >
              <SelectTrigger><SelectValue placeholder="Select a factor type" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {(catalogue.data?.factor_types ?? []).map((t) => (
                  <SelectItem key={t.factor_type_code} value={t.factor_type_code}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected?.description && (
              <p className="text-xs text-muted-foreground">{selected.description}</p>
            )}
          </div>

          {selected?.value_kind === 'AMOUNT' && (
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number" step="0.01" inputMode="decimal"
                value={valueNumeric} onChange={(e) => setValueNumeric(e.target.value)}
              />
            </div>
          )}
          {selected?.value_kind === 'DATE' && (
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={valueDate} onChange={(e) => setValueDate(e.target.value)} />
            </div>
          )}
          {selected?.value_kind === 'TRISTATE' && (
            <div className="space-y-2">
              <Label>Finding</Label>
              <Select value={valueCode} onValueChange={setValueCode}>
                <SelectTrigger><SelectValue placeholder="Select yes, no or unknown" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="YES">Yes</SelectItem>
                  <SelectItem value="NO">No</SelectItem>
                  <SelectItem value="UNKNOWN">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {selected?.value_kind === 'DECISION' && (
            <div className="space-y-2">
              <Label>Value</Label>
              <Select value={valueCode} onValueChange={setValueCode}>
                <SelectTrigger><SelectValue placeholder="Select a value" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {valueDomainItems.map((i) => (
                    <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {selected?.value_kind === 'TEXT' && (
            <div className="space-y-2">
              <Label>Observation</Label>
              <Textarea rows={2} value={valueText} onChange={(e) => setValueText(e.target.value)} />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Direction</Label>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {referenceItems(reference, 'FACTOR_DIRECTION').map((i) => (
                    <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Materiality</Label>
              <Select value={materiality} onValueChange={setMateriality}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {referenceItems(reference, 'FACTOR_MATERIALITY').map((i) => (
                    <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Where this came from</Label>
              <Select value={provenance} onValueChange={setProvenance}>
                <SelectTrigger><SelectValue placeholder="Select a source" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {referenceItems(reference, 'FACTOR_PROVENANCE').map((i) => (
                    <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                Source reference
                {provenance === 'OFFICER_CONFIRMED' ? ' (optional)' : ''}
              </Label>
              <Input
                value={provenanceReference}
                onChange={(e) => setProvenanceReference(e.target.value)}
                placeholder="Record or document reference"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Related signal (optional)</Label>
              <Select value={signalId} onValueChange={setSignalId}>
                <SelectTrigger><SelectValue placeholder="Not signal specific" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not signal specific</SelectItem>
                  {signals.map((s) => (
                    <SelectItem key={s.signal_id} value={s.signal_id}>
                      {s.signal_reference}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Subject reference (optional)</Label>
              <Input
                value={subjectReference}
                onChange={(e) => setSubjectReference(e.target.value)}
                placeholder="Period, account or employer reference"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Reason{selected?.requires_reason ? '' : ' (optional)'}</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>

          {isCorrection && (
            <div className="space-y-2">
              <Label>Why is this being corrected</Label>
              <Textarea
                rows={2}
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The original factor is kept and superseded — nothing is overwritten.
              </p>
            </div>
          )}

          {selected?.evidence_requirement_code === 'REQUIRED' && (
            <Alert>
              <AlertDescription>
                This factor needs usable supporting evidence before information gathering
                can be completed.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Saving…' : isCorrection ? 'Record correction' : 'Record factor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
