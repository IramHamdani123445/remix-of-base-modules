/**
 * BN Risk — control recommendation dialog (EPIC 3).
 *
 * The officer explicitly chooses a control from the governed backend
 * catalogue. Nothing here preselects a control from the score, and nothing
 * here executes a control: the command records a recommendation that must be
 * independently approved before any later governed execution.
 */
import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { riskControlService } from '@/services/bn/risk/riskControlService';
import type {
  BnRiskControlType,
  BnRiskRecommendationReadiness,
} from '@/types/bn/risk/riskControl';

interface TargetOption {
  readonly type: string;
  readonly id: string | null;
  readonly reference: string | null;
  readonly label: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  readiness: BnRiskRecommendationReadiness;
  /** Known records the assessment is already attached to — no raw UUID entry. */
  targetOptions: readonly TargetOption[];
  onCompleted: () => void;
}

export const BnRiskRecommendationDialog: React.FC<Props> = ({
  open, onOpenChange, assessmentId, readiness, targetOptions, onCompleted,
}) => {
  const [controlCode, setControlCode] = React.useState('');
  const [reasonCode, setReasonCode] = React.useState('');
  const [justification, setJustification] = React.useState('');
  const [targetKey, setTargetKey] = React.useState('');
  const [effectiveFrom, setEffectiveFrom] = React.useState('');
  const [effectiveTo, setEffectiveTo] = React.useState('');
  const [scopeNote, setScopeNote] = React.useState('');
  const [factorIds, setFactorIds] = React.useState<string[]>([]);
  const [evidenceIds, setEvidenceIds] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const idempotencyKey = React.useRef<string>(crypto.randomUUID());

  React.useEffect(() => {
    if (open) idempotencyKey.current = crypto.randomUUID();
  }, [open]);

  const control: BnRiskControlType | undefined = readiness.control_options.find(
    (c) => c.control_code === controlCode,
  );

  const compatibleTargets = React.useMemo(
    () => targetOptions.filter((t) => control?.allowed_target_types.includes(t.type)),
    [control, targetOptions],
  );
  const target = compatibleTargets.find((t) => `${t.type}:${t.id ?? ''}` === targetKey);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await riskControlService.recommendControl({
        assessmentId,
        controlCode,
        reasonCode,
        justification: justification.trim() || null,
        targetType: target?.type ?? null,
        targetId: target?.id ?? null,
        targetReference: target?.reference ?? null,
        requestedEffectiveFrom: effectiveFrom || null,
        requestedEffectiveTo: effectiveTo || null,
        scopeNote: scopeNote.trim() || null,
        supportingFactorIds: factorIds,
        supportingEvidenceIds: evidenceIds,
        expectedRowVersion: readiness.assessment_row_version,
        idempotencyKey: idempotencyKey.current,
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The recommendation could not be recorded.');
      }
      return result;
    },
    onSuccess: () => {
      onOpenChange(false);
      setControlCode('');
      setReasonCode('');
      setJustification('');
      setTargetKey('');
      setEffectiveFrom('');
      setEffectiveTo('');
      setScopeNote('');
      setFactorIds([]);
      setEvidenceIds([]);
      setError(null);
      onCompleted();
    },
    onError: (e: Error) => setError(e.message),
  });

  const missingTarget = control?.requires_target === true && !target;
  const missingJustification =
    control?.requires_justification === true && justification.trim() === '';
  const missingPeriod = control?.requires_effective_period === true && effectiveFrom === '';
  const missingEvidence =
    control?.requires_supporting_evidence === true && evidenceIds.length === 0;
  const canSubmit =
    controlCode !== '' && reasonCode !== '' && !missingTarget && !missingJustification
    && !missingPeriod && !missingEvidence && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recommend a control</DialogTitle>
          <DialogDescription>
            The risk score informs this judgement; it does not choose it. Recommending a
            control does not apply it — an independent officer must approve it first.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

          <div className="space-y-2">
            <Label>Control</Label>
            <Select value={controlCode} onValueChange={(v) => { setControlCode(v); setTargetKey(''); }}>
              <SelectTrigger aria-label="Control"><SelectValue placeholder="Choose a control" /></SelectTrigger>
              <SelectContent>
                {readiness.control_options.map((c) => (
                  <SelectItem key={c.control_code} value={c.control_code}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {control && (
              <div className="rounded-md border p-3 text-sm">
                <p className="text-muted-foreground">{control.description}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {control.is_benefit_affecting && <Badge variant="destructive">Benefit affecting</Badge>}
                  {control.requires_independent_approval && <Badge variant="secondary">Independent approval required</Badge>}
                  {control.execution_owner && <Badge variant="outline">Executed by {control.execution_owner}</Badge>}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Recommendation reason</Label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger aria-label="Recommendation reason">
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {readiness.reason_options.map((r) => (
                  <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {control?.allowed_target_types.length ? (
            <div className="space-y-2">
              <Label>{control.requires_target ? 'Target record' : 'Target record (optional)'}</Label>
              <Select value={targetKey} onValueChange={setTargetKey}>
                <SelectTrigger aria-label="Target record">
                  <SelectValue placeholder="Choose a known record" />
                </SelectTrigger>
                <SelectContent>
                  {compatibleTargets.map((t) => (
                    <SelectItem key={`${t.type}:${t.id ?? ''}`} value={`${t.type}:${t.id ?? ''}`}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {compatibleTargets.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No compatible record is attached to this assessment.
                </p>
              )}
            </div>
          ) : null}

          {control?.requires_effective_period && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rc-from">Requested from</Label>
                <Input id="rc-from" type="date" value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rc-to">Requested until (optional)</Label>
                <Input id="rc-to" type="date" value={effectiveTo}
                  onChange={(e) => setEffectiveTo(e.target.value)} />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="rc-justification">
              Why is this control being recommended?
            </Label>
            <Textarea
              id="rc-justification"
              rows={4}
              placeholder="Explain the recommendation by reference to the evidence and factors."
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Supporting factors</Label>
            <div className="space-y-2 rounded-md border p-3">
              {readiness.supporting_factors.length === 0 && (
                <p className="text-sm text-muted-foreground">No active factor recorded.</p>
              )}
              {readiness.supporting_factors.map((f) => (
                <label key={f.factor_id} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={factorIds.includes(f.factor_id)}
                    onCheckedChange={() => toggle(factorIds, setFactorIds, f.factor_id)}
                  />
                  <span>
                    {f.label ?? f.factor_reference}
                    {' '}
                    <Badge variant={f.direction_code === 'REDUCES_CONCERN' ? 'secondary' : 'outline'}>
                      {f.direction_code === 'REDUCES_CONCERN' ? 'Reduces concern' : 'Increases concern'}
                    </Badge>
                    {f.summary && <span className="block text-muted-foreground">{f.summary}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Supporting evidence</Label>
            <div className="space-y-2 rounded-md border p-3">
              {readiness.supporting_evidence.length === 0 && (
                <p className="text-sm text-muted-foreground">No evidence is linked.</p>
              )}
              {readiness.supporting_evidence.map((e) => (
                <label key={e.evidence_link_id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={evidenceIds.includes(e.evidence_link_id)}
                    onCheckedChange={() => toggle(evidenceIds, setEvidenceIds, e.evidence_link_id)}
                  />
                  <span>{e.label ?? 'Evidence item'}{e.usability_code ? ` · ${e.usability_code}` : ''}</span>
                </label>
              ))}
            </div>
          </div>

          {control?.requires_target && (
            <div className="space-y-2">
              <Label htmlFor="rc-scope">Scope note (optional)</Label>
              <Textarea id="rc-scope" rows={2} value={scopeNote}
                onChange={(e) => setScopeNote(e.target.value)} />
            </div>
          )}

          {control?.is_benefit_affecting && (
            <Alert>
              <AlertTitle>This control is benefit affecting</AlertTitle>
              <AlertDescription>
                Recommending it changes nothing. It must be independently approved and then
                executed through the {control.execution_boundary ?? 'governed execution boundary'}.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Submitting…' : 'Submit for independent approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
